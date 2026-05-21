"use client";

// M2b.5d.2 — student-facing live exam UI. Port of TryItOut with:
//   - no model picker / no thinking toggle / no minute-pill (single-purpose UI)
//   - mm:ss timer + status pill + prominent End exam button
//   - wake lock + visibilitychange re-acquire so the screen stays on
//   - on setupComplete: flip exam_sessions.state → in_progress
//   - periodic transcript flush every ~10s (crash-recovery insurance)
//   - End exam → endExamSession server action → redirect
//
// Audio capture for upload + Inngest event firing land in M2b.5d.3.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import {
  endExamSession,
  flushTranscript,
  markInProgress,
  type TranscriptEntry,
} from "@/lib/exam/student-actions";

type Conversation =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "stopping" }
  | { kind: "error"; msg: string }
  | { kind: "ended"; reason: string };

type VadState = "listening" | "recording" | "trailing" | "responding";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// VAD tuning lifted from TryItOut. Same asymmetric pattern: patient before
// speech (student is thinking), snappy after (they've finished their turn).
const RMS_THRESHOLD = 0.012;
const SPEECH_ONSET_MS = 150;
const TRAILING_MS = 1500;

const TRANSCRIPT_FLUSH_INTERVAL_MS = 10_000;

export function StudentLiveSession({
  examSessionId,
  agentName,
}: {
  examSessionId: string;
  agentName: string;
}) {
  const [status, setStatus] = useState<Conversation>({ kind: "idle" });
  const [vad, setVad] = useState<VadState>("listening");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Resource refs
  const sessionRef = useRef<Session | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const inputWorkletRef = useRef<AudioWorkletNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const recorderDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>("");
  const playbackHeadRef = useRef<number>(0);
  const currentUserTextRef = useRef<string>("");
  const currentModelTextRef = useRef<string>("");
  const sessionStartedAtRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inProgressMarkedRef = useRef<boolean>(false);

  const vadRef = useRef<VadState>("listening");
  const speechOnsetAtRef = useRef<number | null>(null);
  const lastLoudFrameAtRef = useRef<number | null>(null);

  const setVadState = useCallback((next: VadState) => {
    vadRef.current = next;
    setVad(next);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // Wake-lock isn't critical. Firefox doesn't support it; on iOS the
      // screen may dim. The exam keeps working either way.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      /* ignore */
    }
  }, []);

  const cleanup = useCallback(() => {
    try {
      sessionRef.current?.close();
    } catch {
      /* noop */
    }
    sessionRef.current = null;
    inputWorkletRef.current?.disconnect();
    inputWorkletRef.current = null;
    inputStreamRef.current?.getTracks().forEach((t) => t.stop());
    inputStreamRef.current = null;
    inputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    mediaRecorderRef.current = null;
    recorderDestRef.current = null;
    outputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current = null;
    playbackHeadRef.current = 0;
    currentUserTextRef.current = "";
    currentModelTextRef.current = "";
    vadRef.current = "listening";
    speechOnsetAtRef.current = null;
    lastLoudFrameAtRef.current = null;

    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    void releaseWakeLock();
  }, [releaseWakeLock]);

  // When the server refuses a flush because the roster is missing (Phase 0
  // fail-closed), stop the session immediately so we don't accumulate more
  // unscrubbed entries in the client's in-memory buffer. The student sees a
  // "tell your teacher" error; the row stays in_progress until the teacher
  // resets it (or the Phase 3 sweep ages it out).
  const ROSTER_MISSING_MSG =
    "We can't save your transcript right now — please tell your teacher. Your exam has not been recorded.";

  const flushTranscriptBuffer = useCallback(async () => {
    if (transcriptRef.current.length === 0) return;
    try {
      const result = await flushTranscript(
        examSessionId,
        transcriptRef.current,
      );
      if ("error" in result && result.error === "roster_missing") {
        cleanup();
        setStatus({ kind: "error", msg: ROSTER_MISSING_MSG });
      }
    } catch {
      // Best-effort — a network / RSC failure mid-session shouldn't crash
      // the exam. Next interval retries.
    }
  }, [examSessionId, cleanup]);

  // Unmount cleanup. We intentionally do NOT auto-end the exam on unmount
  // (a navigation away or accidental refresh shouldn't auto-complete the
  // row) — that's the End exam button's explicit job.
  useEffect(() => () => cleanup(), [cleanup]);

  // Re-acquire the wake lock when the user returns to the tab — the spec
  // releases it on visibility change. Mirrors HH's recorder pattern.
  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        status.kind === "live"
      ) {
        void acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [status.kind, acquireWakeLock]);

  async function start() {
    if (
      !(
        status.kind === "idle" ||
        status.kind === "ended" ||
        status.kind === "error"
      )
    ) {
      return;
    }
    setStatus({ kind: "starting" });
    setTranscript([]);
    transcriptRef.current = [];
    setElapsedSec(0);
    setVadState("listening");

    let token: string;
    let model: string;
    try {
      const res = await fetch("/api/exam/auth-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examSessionId }),
      });
      const data = (await res.json()) as {
        token?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok || !data.token || !data.model) {
        throw new Error(data.error ?? `Token mint failed (${res.status})`);
      }
      token = data.token;
      model = data.model;
    } catch (err) {
      cleanup();
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Token request failed",
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: INPUT_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      cleanup();
      setStatus({
        kind: "error",
        msg:
          err instanceof Error
            ? `Mic permission denied: ${err.message}`
            : "Mic permission denied.",
      });
      return;
    }
    inputStreamRef.current = stream;

    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" },
    });
    let session: Session;
    try {
      session = await ai.live.connect({
        model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => {},
          onmessage: (msg) => handleServerMessage(msg),
          onerror: (err) => {
            setStatus({
              kind: "error",
              msg: err.message ?? "Live session error",
            });
            cleanup();
          },
          onclose: (ev) => {
            setStatus((s) =>
              s.kind === "error"
                ? s
                : { kind: "ended", reason: ev.reason || "closed" },
            );
            cleanup();
          },
        },
      });
      sessionRef.current = session;
    } catch (err) {
      cleanup();
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Live connect failed",
      });
      return;
    }

    try {
      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      inputCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-audio-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-processor");
      inputWorkletRef.current = worklet;
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
        handleMicFrame(e.data, session);
      };
      source.connect(worklet);

      // Mixing context: agent playback PLUS a recorder destination that
      // captures both the agent and a resampled copy of the mic. The
      // existing 16kHz input context above stays — it's the Gemini upstream.
      // This 24kHz context is the speaker + recorder side.
      const outCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      outputCtxRef.current = outCtx;
      playbackHeadRef.current = outCtx.currentTime;

      const recorderDest = outCtx.createMediaStreamDestination();
      recorderDestRef.current = recorderDest;

      // Mic tap: a second MediaStreamSource on the same getUserMedia stream,
      // routed to the recorder dest only (NOT to ctx.destination — would
      // echo through speakers). Web Audio auto-resamples to outCtx's rate.
      const micTap = outCtx.createMediaStreamSource(stream);
      const micGain = outCtx.createGain();
      micGain.gain.value = 1.0;
      micTap.connect(micGain);
      micGain.connect(recorderDest);

      const mime = pickRecorderMimeType();
      if (mime && typeof MediaRecorder !== "undefined") {
        recorderMimeRef.current = mime;
        recordedChunksRef.current = [];
        const recorder = new MediaRecorder(recorderDest.stream, {
          mimeType: mime,
        });
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recordedChunksRef.current.push(ev.data);
          }
        };
        mediaRecorderRef.current = recorder;
        // Timeslice 5s so a mid-session crash still leaves recoverable
        // chunks in memory. We POST the assembled blob on End-exam — the
        // chunks are buffered, not streamed to the server. (Streaming
        // upload during the call is a future optimization.)
        recorder.start(5000);
      } else {
        // No supported MIME — proceed without recording. Audio capture is
        // important but not blocking; transcript + eval still work.
        recorderMimeRef.current = "";
      }
    } catch (err) {
      cleanup();
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Audio init failed",
      });
      return;
    }

    // Hidden cue so the agent speaks first — Live API doesn't auto-greet
    // and we want the conversation to open with the agent's OPENING text.
    try {
      session.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: "(The student has joined the session and is listening. Begin now, exactly as your OPENING and flow direct.)",
              },
            ],
          },
        ],
        turnComplete: true,
      });
    } catch {
      /* session may have already closed */
    }

    // Flip state='started' → 'in_progress' so a tab-refresh or crash from
    // here on routes through the "disconnected" screen rather than letting
    // the student re-enter and burn a second token.
    //
    // Phase 2: await + log on error instead of fire-and-forget. We don't
    // kill the session on failure — the student is already mid-conversation
    // with the agent and the Phase 2 reservation gate (`live_minutes_used =
    // 0` in /api/exam/auth-token) prevents a refresh from minting a second
    // token even if the state stays at 'started'. The failure is a
    // diagnostic signal, not a UX-blocking event.
    if (!inProgressMarkedRef.current) {
      inProgressMarkedRef.current = true;
      const markResult = await markInProgress(examSessionId);
      if ("error" in markResult) {
        console.warn(
          `[StudentLiveSession] markInProgress failed session=${examSessionId} err=${markResult.error}`,
        );
      }
    }

    void acquireWakeLock();
    // eslint-disable-next-line react-hooks/purity
    sessionStartedAtRef.current = Date.now();

    flushTimerRef.current = setInterval(() => {
      void flushTranscriptBuffer();
    }, TRANSCRIPT_FLUSH_INTERVAL_MS);
    elapsedTimerRef.current = setInterval(() => {
      const startedAt = sessionStartedAtRef.current;
      if (startedAt == null) return;
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    setVadState("responding");
    setStatus({ kind: "live" });
  }

  function handleMicFrame(float32: Float32Array, session: Session) {
    const rms = computeRms(float32);
    const isLoud = rms > RMS_THRESHOLD;
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    const current = vadRef.current;

    if (current === "recording" || current === "trailing") {
      sendAudio(session, float32);
    }

    if (current === "listening") {
      if (isLoud) {
        if (speechOnsetAtRef.current === null)
          speechOnsetAtRef.current = now;
        if (now - (speechOnsetAtRef.current ?? now) >= SPEECH_ONSET_MS) {
          try {
            session.sendRealtimeInput({ activityStart: {} });
          } catch {
            /* session may be closing */
          }
          lastLoudFrameAtRef.current = now;
          setVadState("recording");
          sendAudio(session, float32);
        }
      } else {
        speechOnsetAtRef.current = null;
      }
      return;
    }

    if (current === "recording") {
      if (isLoud) {
        lastLoudFrameAtRef.current = now;
      } else {
        setVadState("trailing");
      }
      return;
    }

    if (current === "trailing") {
      if (isLoud) {
        lastLoudFrameAtRef.current = now;
        setVadState("recording");
      } else if (
        now - (lastLoudFrameAtRef.current ?? now) >=
        TRAILING_MS
      ) {
        try {
          session.sendRealtimeInput({ activityEnd: {} });
        } catch {
          /* session may be closing */
        }
        speechOnsetAtRef.current = null;
        lastLoudFrameAtRef.current = null;
        setVadState("responding");
      }
      return;
    }

    // responding — ignore mic
  }

  function sendAudio(session: Session, float32: Float32Array) {
    const pcm16 = float32ToInt16(float32);
    const b64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
    try {
      session.sendRealtimeInput({
        audio: {
          data: b64,
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      });
    } catch {
      /* session may be closing */
    }
  }

  function handleServerMessage(msg: LiveServerMessage) {
    const content = msg.serverContent;
    if (!content) return;

    const parts = content.modelTurn?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) playPcmChunk(data);
    }

    const inputT = content.inputTranscription?.text;
    if (typeof inputT === "string" && inputT.length > 0) {
      currentUserTextRef.current += inputT;
    }
    const outputT = content.outputTranscription?.text;
    if (typeof outputT === "string" && outputT.length > 0) {
      currentModelTextRef.current += outputT;
    }

    if (content.turnComplete) {
      const userText = currentUserTextRef.current.trim();
      const modelText = currentModelTextRef.current.trim();
      currentUserTextRef.current = "";
      currentModelTextRef.current = "";
      const additions: TranscriptEntry[] = [];
      const ts = new Date().toISOString();
      if (userText) additions.push({ role: "user", text: userText, timestamp: ts });
      if (modelText) additions.push({ role: "model", text: modelText, timestamp: ts });
      if (additions.length > 0) {
        transcriptRef.current = [...transcriptRef.current, ...additions];
        setTranscript(transcriptRef.current);
      }
      setVadState("listening");
    }
  }

  function playPcmChunk(base64Pcm: string) {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const pcm = base64ToInt16(base64Pcm);
    const float32 = int16ToFloat32(pcm);
    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Speakers — student hears the agent.
    source.connect(ctx.destination);
    // Recording — capture the agent into the mixed stream alongside the
    // mic tap. A single AudioBufferSourceNode can fan out to multiple
    // destinations.
    const recorderDest = recorderDestRef.current;
    if (recorderDest) {
      source.connect(recorderDest);
    }
    const startAt = Math.max(playbackHeadRef.current, ctx.currentTime);
    source.start(startAt);
    playbackHeadRef.current = startAt + buffer.duration;
  }

  async function endExam() {
    if (status.kind !== "live" && status.kind !== "starting") {
      return;
    }
    setStatus({ kind: "stopping" });

    // Phase 2: clear the 10s flush interval synchronously, BEFORE awaiting
    // the recorder assembly. Otherwise a flush firing during the recorder
    // stop-and-assemble window can race the final endExamSession write
    // (server-side state fence catches it as a no-op, but no point even
    // racing — clear here.)
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const startedAt = sessionStartedAtRef.current;
    const durationSec =
      // eslint-disable-next-line react-hooks/purity
      startedAt != null ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
    const finalTranscript = transcriptRef.current;

    // Stop the recorder and wait for the final dataavailable + stop events
    // so we get a single assembled blob. Then close the Live session so
    // nothing more lands in the transcript / mix.
    const blob = await stopRecorderAndAssembleBlob();
    cleanup();

    let audioPath: string | null = null;
    if (blob && blob.size > 0) {
      try {
        const fd = new FormData();
        fd.append("examSessionId", examSessionId);
        fd.append("audio", blob, `${examSessionId}.${pickExtFromMime(blob.type)}`);
        const res = await fetch("/api/exam/upload-audio", {
          method: "POST",
          body: fd,
        });
        if (res.ok) {
          const json = (await res.json()) as { audioPath?: string };
          audioPath = json.audioPath ?? null;
        }
        // Non-OK: leave audioPath null. endExamSession still flips the
        // row to completed — losing audio shouldn't strand the row.
      } catch {
        /* swallow; same fallback */
      }
    }

    // Throws (via Next's redirect()) on success. If the Promise resolves
    // at all, endExamSession refused — surface the error to the student.
    // roster_missing is the Phase 0 fail-closed signal that no transcript
    // was written (PII safety wins over UX).
    const result = await endExamSession(
      examSessionId,
      finalTranscript,
      durationSec,
      audioPath,
    );
    if (result.error === "roster_missing") {
      setStatus({ kind: "error", msg: ROSTER_MISSING_MSG });
    } else {
      setStatus({
        kind: "error",
        msg: `Couldn't end the exam: ${result.error}`,
      });
    }
  }

  /**
   * Stop the MediaRecorder and resolve with a single assembled blob once
   * the final `dataavailable` + `stop` events have fired. Returns null
   * if there's no recorder (browser without supported MIME) or no chunks.
   */
  function stopRecorderAndAssembleBlob(): Promise<Blob | null> {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(buildBlobFromChunks());
    }
    return new Promise<Blob | null>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve(buildBlobFromChunks());
        },
        { once: true },
      );
      try {
        recorder.stop();
      } catch {
        resolve(buildBlobFromChunks());
      }
    });
  }

  function buildBlobFromChunks(): Blob | null {
    const chunks = recordedChunksRef.current;
    if (!chunks || chunks.length === 0) return null;
    const mime = recorderMimeRef.current || chunks[0]?.type || "audio/webm";
    return new Blob(chunks, { type: mime });
  }

  return (
    <section className="surface p-0 overflow-hidden">
      <header className="px-4 py-3 border-b border-rule flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading text-lg">Oral defense with {agentName}</h2>
          <p className="muted text-xs">
            Speak naturally. The agent waits for you — pause as long as you
            need to think.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "live" && (
            <>
              <ElapsedPill seconds={elapsedSec} />
              <VadPill vad={vad} />
            </>
          )}
          <ConvoPill status={status} />
        </div>
      </header>

      <div className="bg-paper px-4 py-4 min-h-[320px] max-h-[60vh] overflow-y-auto space-y-3">
        {status.kind === "idle" && (
          <p className="muted text-sm text-center py-12">
            Click <strong>Start exam</strong> below, grant microphone
            permission, and your examiner will greet you.
          </p>
        )}
        {status.kind === "starting" && (
          <p className="muted text-sm text-center py-12">Connecting…</p>
        )}
        {status.kind === "live" && transcript.length === 0 && (
          <p className="muted text-sm text-center py-12">
            Connected. Wait for {agentName} to greet you — then speak
            naturally.
          </p>
        )}
        {transcript.map((line, i) => (
          <Bubble
            key={i}
            role={line.role}
            text={line.text}
            agentName={agentName}
          />
        ))}
      </div>

      <footer className="px-4 py-4 border-t border-rule flex items-center justify-between gap-3 flex-wrap">
        {status.kind === "idle" || status.kind === "error" ? (
          <button
            type="button"
            onClick={start}
            className="btn bg-maroon text-white px-5 py-3 text-sm font-medium"
          >
            {status.kind === "error" ? "Try again" : "Start exam"}
          </button>
        ) : (
          <button
            type="button"
            onClick={endExam}
            disabled={
              status.kind === "starting" || status.kind === "stopping"
            }
            className="btn bg-maroon text-white px-5 py-3 text-sm font-medium disabled:opacity-50"
          >
            {status.kind === "stopping" ? "Ending…" : "End exam"}
          </button>
        )}
        <p className="muted text-xs flex-1 text-right min-w-[200px]">
          Your conversation is being recorded and transcribed. Your teacher
          will see the transcript.
        </p>
      </footer>

      {status.kind === "error" && (
        <div className="px-4 py-3 bg-red-50 text-sm text-red-800 border-t border-red-200">
          {status.msg}
        </div>
      )}
    </section>
  );
}

function ElapsedPill({ seconds }: { seconds: number }) {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return (
    <span className="text-xs px-2 py-1 rounded bg-paper text-ink/70 font-mono">
      {mm}:{ss}
    </span>
  );
}

function VadPill({ vad }: { vad: VadState }) {
  const map: Record<VadState, { label: string; cls: string }> = {
    listening: { label: "Listening", cls: "bg-paper text-ink/70" },
    recording: {
      label: "● You're speaking",
      cls: "bg-green-100 text-green-900",
    },
    trailing: { label: "(pause…)", cls: "bg-amber-100 text-amber-900" },
    responding: {
      label: "Examiner speaking",
      cls: "bg-blue-100 text-blue-900",
    },
  };
  const m = map[vad];
  return <span className={`text-xs px-2 py-1 rounded ${m.cls}`}>{m.label}</span>;
}

function ConvoPill({ status }: { status: Conversation }) {
  const map: Record<Conversation["kind"], { label: string; cls: string }> = {
    idle: { label: "Not started", cls: "bg-paper text-ink/70" },
    starting: { label: "Connecting…", cls: "bg-amber-100 text-amber-900" },
    live: { label: "● Live", cls: "bg-green-100 text-green-900" },
    stopping: { label: "Ending…", cls: "bg-amber-100 text-amber-900" },
    error: { label: "Error", cls: "bg-red-100 text-red-900" },
    ended: { label: "Ended", cls: "bg-paper text-ink/70" },
  };
  const m = map[status.kind];
  return <span className={`text-xs px-2 py-1 rounded ${m.cls}`}>{m.label}</span>;
}

function Bubble({
  role,
  text,
  agentName,
}: {
  role: "user" | "model";
  text: string;
  agentName: string;
}) {
  const isAgent = role === "model";
  return (
    <div className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isAgent ? "bg-white border border-rule" : "bg-maroon text-white"
        }`}
      >
        <div className={`text-xs mb-1 ${isAgent ? "muted" : "text-white/80"}`}>
          {isAgent ? agentName : "You"}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----------------------------------------------------------------

/**
 * Prefer MP4 → ogg/opus → webm for the recorded exam audio. Matches HH's
 * pattern: Gemini's Files API accepts wav / mp3 / aiff / aac / ogg / flac /
 * m4a but NOT webm. iOS Safari requires mp4. Falling back to webm is a
 * last resort and the eval pipeline will surface a friendlier error than
 * a Files API rejection if it lands.
 */
function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function pickExtFromMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  return "bin";
}

function computeRms(float32: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
  return Math.sqrt(sumSq / float32.length);
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}
