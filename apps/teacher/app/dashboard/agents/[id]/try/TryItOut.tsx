"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

type TranscriptLine = { role: "user" | "model"; text: string };

type Conversation =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "stopping" }
  | { kind: "error"; msg: string }
  | { kind: "ended"; reason: string };

// Client-side voice activity state machine, asymmetric:
//   listening  — agent finished, no student speech yet (unlimited wait)
//   recording  — student is speaking; sending audio + already sent activityStart
//   trailing   — silence after speech; commit after TRAILING_MS or back to recording
//   responding — sent activityEnd; waiting for the model to speak back
type VadState = "listening" | "recording" | "trailing" | "responding";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Manual VAD tuning. Conservative defaults; raise RMS_THRESHOLD if a quiet
// room is mistakenly registering as speech, lower if students with quiet
// voices aren't being detected.
const RMS_THRESHOLD = 0.012;           // ~-38 dBFS; speech vs. quiet room
const SPEECH_ONSET_MS = 150;            // need this much continuous loudness to count as speech start
const TRAILING_MS = 1500;               // silence after speech → end of student turn

export function TryItOut({
  systemPrompt,
  agentName,
  voiceName,
  evalPromptBody,
  rubricBody,
  summaryPromptBody,
}: {
  systemPrompt: string;
  agentName: string;
  voiceName: string | null;
  evalPromptBody?: string | null;
  rubricBody?: string | null;
  summaryPromptBody?: string;
}) {
  const [status, setStatus] = useState<Conversation>({ kind: "idle" });
  const [vad, setVad] = useState<VadState>("listening");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [reservedMinutes, setReservedMinutes] = useState<number | null>(null);
  const [adminBypass, setAdminBypass] = useState(false);
  const [refundedMinutes, setRefundedMinutes] = useState<number | null>(null);

  // Resource refs we need to clean up.
  const sessionRef = useRef<Session | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const inputWorkletRef = useRef<AudioWorkletNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const playbackHeadRef = useRef<number>(0);
  const currentUserTextRef = useRef<string>("");
  const currentModelTextRef = useRef<string>("");
  // Wall-clock start of the live session — used to compute actualSeconds
  // for the refund-on-close call. Null when no session is in flight or
  // refund has already been posted (post-once guarantee). Lives in a ref
  // because cleanup() runs from multiple paths (stop button, error,
  // unmount, server-close) and we want exactly one refund per session.
  const sessionStartedAtRef = useRef<number | null>(null);

  // VAD state lives in refs because the worklet callback fires faster than
  // React can re-render — we only setVad on transitions for the UI.
  const vadRef = useRef<VadState>("listening");
  const speechOnsetAtRef = useRef<number | null>(null);
  const lastLoudFrameAtRef = useRef<number | null>(null);

  const setVadState = useCallback((next: VadState) => {
    vadRef.current = next;
    setVad(next);
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
    outputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current = null;
    playbackHeadRef.current = 0;
    currentUserTextRef.current = "";
    currentModelTextRef.current = "";
    vadRef.current = "listening";
    speechOnsetAtRef.current = null;
    lastLoudFrameAtRef.current = null;

    // Refund-on-close (M2b.5b.10). Fire-and-forget — if the request fails
    // (offline, server down), the teacher's daily count just doesn't get
    // credited back; same outcome as the pre-refund behavior. Capture
    // start-time, then clear the ref so duplicate cleanup calls (stop +
    // server close, unmount + stop) don't double-refund.
    const startedAt = sessionStartedAtRef.current;
    sessionStartedAtRef.current = null;
    if (startedAt != null) {
      const actualSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
      fetch("/api/try-out/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualSeconds }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { refundedMinutes?: number } | null) => {
          if (data && typeof data.refundedMinutes === "number") {
            setRefundedMinutes(data.refundedMinutes);
          }
        })
        .catch(() => {
          /* refund best-effort; ignore */
        });
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  async function start() {
    if (!(status.kind === "idle" || status.kind === "ended" || status.kind === "error")) {
      return;
    }
    setStatus({ kind: "starting" });
    setTranscript([]);
    setVadState("listening");

    let token: string;
    let model: string;
    try {
      const res = await fetch("/api/try-out/auth-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, voiceName }),
      });
      const data = (await res.json()) as {
        token?: string;
        model?: string;
        reservedMinutes?: number | null;
        capMinutes?: number | null;
        adminBypass?: boolean;
        error?: string;
      };
      if (!res.ok || !data.token || !data.model) {
        throw new Error(data.error ?? `Token mint failed (${res.status})`);
      }
      token = data.token;
      model = data.model;
      setReservedMinutes(data.reservedMinutes ?? null);
      setAdminBypass(!!data.adminBypass);
    } catch (err) {
      cleanup();
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Token request failed" });
      return;
    }

    // Mic permission early; fail fast if denied.
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
        msg: err instanceof Error ? `Mic permission denied: ${err.message}` : "Mic permission denied.",
      });
      return;
    }
    inputStreamRef.current = stream;

    // Open the Live session with the ephemeral token. Model is pinned in the
    // token's liveConnectConstraints, but the SDK still requires it as a
    // string here — pass it through from the auth-token response.
    // apiVersion: "v1alpha" is REQUIRED for ephemeral auth tokens + preview
    // Live models. Without it the SDK falls back to v1main (GA), which
    // doesn't know about preview models — symptom: "model not found for API
    // version v1main, or is not supported for bidiGenera".
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
            setStatus({ kind: "error", msg: err.message ?? "Live session error" });
            cleanup();
          },
          onclose: (ev) => {
            setStatus((s) =>
              s.kind === "error" ? s : { kind: "ended", reason: ev.reason || "closed" },
            );
            cleanup();
          },
        },
      });
      sessionRef.current = session;
    } catch (err) {
      cleanup();
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Live connect failed" });
      return;
    }

    // Input pipeline: mic → AudioContext @ 16kHz → worklet → main thread
    // VAD + send → session.sendRealtimeInput
    try {
      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      inputCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-audio-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-processor");
      inputWorkletRef.current = worklet;
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const float32 = e.data;
        handleMicFrame(float32, session);
      };
      source.connect(worklet);
      // Don't connect worklet to destination — no mic echo.

      // Output context for playing model's audio at 24kHz.
      outputCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      playbackHeadRef.current = outputCtxRef.current.currentTime;
    } catch (err) {
      cleanup();
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Audio init failed" });
      return;
    }

    // Kick the agent to speak first. Live API doesn't auto-greet on connect;
    // the model only responds to a user turn. We send a short hidden cue so
    // the agent opens immediately with whatever its OPENING / flow PHASE 1
    // dictates. The cue itself doesn't appear in the visible transcript
    // (we only render inputAudioTranscription, which only fires for audio
    // turns, never for text).
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

    // Agent is about to speak — transition VAD into "responding" so the
    // status pill shows "Agent speaking" while it starts up, then handleServer
    // Message's turnComplete will flip back to "listening".
    setVadState("responding");
    // eslint-disable-next-line react-hooks/purity
    sessionStartedAtRef.current = Date.now();
    setRefundedMinutes(null);
    setStatus({ kind: "live" });
  }

  // Per-frame mic handler — runs the manual VAD state machine + streams audio
  // to Gemini between activityStart and activityEnd. Only invoked from the
  // worklet message callback (never during render), so impurity is fine.
  function handleMicFrame(float32: Float32Array, session: Session) {
    const rms = computeRms(float32);
    const isLoud = rms > RMS_THRESHOLD;
    // eslint-disable-next-line react-hooks/purity
    const now = performance.now();
    const current = vadRef.current;

    // Always send audio frames while we're considered "active" (between
    // activityStart and activityEnd). Manual VAD with disabled:true means
    // Gemini ignores audio outside that window.
    if (current === "recording" || current === "trailing") {
      sendAudio(session, float32);
    }

    if (current === "listening") {
      if (isLoud) {
        if (speechOnsetAtRef.current === null) speechOnsetAtRef.current = now;
        if (now - (speechOnsetAtRef.current ?? now) >= SPEECH_ONSET_MS) {
          // Commit: student has started speaking.
          try {
            session.sendRealtimeInput({ activityStart: {} });
          } catch {
            /* session may be closing */
          }
          lastLoudFrameAtRef.current = now;
          setVadState("recording");
          // Send THIS frame too, since we just transitioned.
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
      } else if (now - (lastLoudFrameAtRef.current ?? now) >= TRAILING_MS) {
        // Commit: student is done. Send activityEnd; wait for model response.
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

    // current === "responding": ignore mic until model finishes its turn.
    // Note: if the student barges in (starts speaking over the agent), we
    // currently ignore it. Could detect + restart by sending another
    // activityStart, but for v1 keep it simple.
  }

  function sendAudio(session: Session, float32: Float32Array) {
    const pcm16 = float32ToInt16(float32);
    const b64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
    try {
      // v1alpha API: typed `audio` field. The old `media` field is
      // deprecated and the server rejects with "realtime_input.media_chunks
      // is deprecated. Use audio, video, or text instead."
      session.sendRealtimeInput({
        audio: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
      });
    } catch {
      /* session may be closing */
    }
  }

  function handleServerMessage(msg: LiveServerMessage) {
    const content = msg.serverContent;
    if (!content) return;

    // Audio chunks — queue for playback.
    const parts = content.modelTurn?.parts ?? [];
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (data) {
        playPcmChunk(data);
      }
    }

    // Live transcripts. Accumulate per-turn, flush when the turn completes.
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
      setTranscript((prev) => {
        const next = [...prev];
        if (userText) next.push({ role: "user", text: userText });
        if (modelText) next.push({ role: "model", text: modelText });
        return next;
      });
      // Model done — back to listening for the next student turn.
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
    source.connect(ctx.destination);
    const startAt = Math.max(playbackHeadRef.current, ctx.currentTime);
    source.start(startAt);
    playbackHeadRef.current = startAt + buffer.duration;
  }

  function stop() {
    setStatus({ kind: "stopping" });
    cleanup();
    setStatus({ kind: "ended", reason: "stopped by user" });
  }

  const canStart = status.kind === "idle" || status.kind === "ended" || status.kind === "error";

  return (
    <section className="bg-white border border-stone-200 rounded p-0 overflow-hidden">
      <header className="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-medium text-ink text-lg">Talk to {agentName}</h2>
          <p className="text-stone-500 text-xs">
            Real Gemini Live audio.{" "}
            {voiceName ? (
              <>
                Voice: <code>{voiceName}</code>.
              </>
            ) : (
              "Default voice."
            )}{" "}
            {adminBypass
              ? "Admin — no daily cap."
              : reservedMinutes != null && (
                  <>
                    Reserved {reservedMinutes} min from your daily cap.
                    {refundedMinutes != null && refundedMinutes > 0 && (
                      <>
                        {" "}
                        <span className="text-green-700">
                          Refunded {refundedMinutes} min after close.
                        </span>
                      </>
                    )}
                  </>
                )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "live" && <VadPill vad={vad} />}
          <ConvoPill status={status} />
          {canStart ? (
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm"
            >
              {status.kind === "ended" || status.kind === "error" ? "Start again" : "Start talking"}
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              disabled={status.kind === "starting" || status.kind === "stopping"}
              className="inline-flex items-center gap-1.5 rounded font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm disabled:opacity-50"
            >
              {status.kind === "stopping" ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
      </header>

      <div className="bg-paper px-4 py-4 min-h-[260px] max-h-[60vh] overflow-y-auto space-y-3">
        {transcript.length === 0 && status.kind === "live" && (
          <p className="text-stone-500 text-sm text-center py-12">
            Connected. Wait for the agent to greet you — then speak naturally.
            Pause as long as you need to think; the agent won&apos;t interrupt.
          </p>
        )}
        {transcript.length === 0 && status.kind !== "live" && (
          <p className="text-stone-500 text-sm text-center py-12">
            Click <strong>Start talking</strong>, grant mic permission, and the agent
            will greet you.
          </p>
        )}
        {transcript.map((line, i) => (
          <Bubble key={i} role={line.role} text={line.text} agentName={agentName} />
        ))}
      </div>

      {status.kind === "error" && (
        <div className="px-4 py-3 bg-red-50 text-sm text-red-800 border-t border-red-200">
          {status.msg}
        </div>
      )}
      {status.kind === "ended" && (
        <div className="px-4 py-3 text-stone-500 text-xs border-t border-stone-200">
          Session ended ({status.reason}). Click <strong>Start again</strong> to retry
          {adminBypass
            ? "."
            : " (uses another reservation against your daily cap)."}
        </div>
      )}
      {status.kind === "ended" && transcript.length > 0 && summaryPromptBody && (
        <EvalPreviewPanel
          transcript={transcript}
          evalPromptBody={evalPromptBody ?? null}
          rubricBody={rubricBody ?? null}
          summaryPromptBody={summaryPromptBody}
        />
      )}
    </section>
  );
}

function VadPill({ vad }: { vad: VadState }) {
  const map: Record<VadState, { label: string; cls: string }> = {
    listening: { label: "Listening", cls: "bg-paper text-ink/70" },
    recording: { label: "● Recording you", cls: "bg-green-100 text-green-900" },
    trailing: { label: "(brief pause…)", cls: "bg-amber-100 text-amber-900" },
    responding: { label: "Agent speaking", cls: "bg-blue-100 text-blue-900" },
  };
  const m = map[vad];
  return <span className={`text-xs px-2 py-1 rounded ${m.cls}`}>{m.label}</span>;
}

function ConvoPill({ status }: { status: Conversation }) {
  const map: Record<Conversation["kind"], { label: string; cls: string }> = {
    idle: { label: "Idle", cls: "bg-paper text-ink/70" },
    starting: { label: "Connecting…", cls: "bg-amber-100 text-amber-900" },
    live: { label: "● Live", cls: "bg-green-100 text-green-900" },
    stopping: { label: "Stopping…", cls: "bg-amber-100 text-amber-900" },
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
          isAgent ? "bg-white border border-stone-200" : "bg-maroon text-white"
        }`}
      >
        <div className={`text-xs mb-1 ${isAgent ? "text-stone-500" : "text-white/80"}`}>
          {isAgent ? agentName : "You (as student)"}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{text}</div>
      </div>
    </div>
  );
}

// ---- helpers ----------------------------------------------------------------

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

function EvalPreviewPanel({
  transcript,
  evalPromptBody,
  rubricBody,
  summaryPromptBody,
}: {
  transcript: TranscriptLine[];
  evalPromptBody: string | null;
  rubricBody: string | null;
  summaryPromptBody: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; evalText: string | null; studentSummary: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function run() {
    setState({ kind: "loading" });
    const { generateEvalPreview } = await import("./generate-eval-preview");
    const result = await generateEvalPreview({
      transcript,
      evalPromptBody,
      rubricBody,
      summaryPromptBody,
    });
    if (result.ok) {
      setState({
        kind: "done",
        evalText: result.evalText,
        studentSummary: result.studentSummary,
      });
    } else {
      setState({ kind: "error", message: result.error });
    }
  }

  return (
    <section className="border-t border-stone-200 px-4 py-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Preview eval + summary</h3>
        {state.kind === "idle" && (
          <button
            type="button"
            onClick={run}
            className="rounded border border-maroon px-3 py-1 text-xs font-medium text-maroon hover:bg-maroon hover:text-white transition-colors"
          >
            Generate
          </button>
        )}
        {state.kind === "loading" && (
          <span className="text-xs text-stone-500 animate-pulse">Running Gemini eval…</span>
        )}
      </div>
      {state.kind === "done" && (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium mb-1">Student summary</p>
            <pre className="text-xs whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded p-3 leading-relaxed max-h-40 overflow-y-auto">
              {state.studentSummary}
            </pre>
          </div>
          {state.evalText && (
            <div>
              <p className="text-xs font-medium mb-1">Evaluation</p>
              <pre className="text-xs whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded p-3 leading-relaxed max-h-60 overflow-y-auto">
                {state.evalText}
              </pre>
            </div>
          )}
          {!state.evalText && (
            <p className="text-xs text-stone-500">
              No evaluation generated — this agent is ungraded (no eval prompt).
            </p>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <p className="text-xs text-red-700">{state.message}</p>
      )}
    </section>
  );
}
