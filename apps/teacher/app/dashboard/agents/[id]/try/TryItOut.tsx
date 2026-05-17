"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

type TranscriptLine = { role: "user" | "model"; text: string };

type Status =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "stopping" }
  | { kind: "error"; msg: string }
  | { kind: "ended"; reason: string };

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

export function TryItOut({
  systemPrompt,
  agentName,
  voiceName,
}: {
  systemPrompt: string;
  agentName: string;
  voiceName: string | null;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [reservedMinutes, setReservedMinutes] = useState<number | null>(null);

  // Refs for resources we need to clean up.
  const sessionRef = useRef<Session | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const inputWorkletRef = useRef<AudioWorkletNode | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const playbackHeadRef = useRef<number>(0); // next start time for queued chunks
  const currentUserTextRef = useRef<string>("");
  const currentModelTextRef = useRef<string>("");

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
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  async function start() {
    if (status.kind !== "idle" && !("kind" in status && (status.kind === "ended" || status.kind === "error"))) {
      return;
    }
    setStatus({ kind: "starting" });
    setTranscript([]);

    let token: string;
    try {
      const res = await fetch("/api/try-out/auth-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, voiceName }),
      });
      const data = (await res.json()) as {
        token?: string;
        reservedMinutes?: number;
        capMinutes?: number;
        error?: string;
      };
      if (!res.ok || !data.token) {
        throw new Error(data.error ?? `Token mint failed (${res.status})`);
      }
      token = data.token;
      setReservedMinutes(data.reservedMinutes ?? null);
    } catch (err) {
      cleanup();
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Token request failed" });
      return;
    }

    // Get mic permission early so we fail fast if the user denies.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: INPUT_SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
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

    // Open the Live session with the ephemeral token.
    const ai = new GoogleGenAI({ apiKey: token, apiVersion: "v1alpha" });
    let session: Session;
    try {
      session = await ai.live.connect({
        model: "", // pinned via liveConnectConstraints in the token
        config: {
          responseModalities: [Modality.AUDIO],
        },
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
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : "Live connect failed",
      });
      return;
    }

    // Set up the input audio pipeline: mic → AudioContext @ 16kHz → worklet
    // → PCM16 base64 → session.sendRealtimeInput
    try {
      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      inputCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-audio-worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-processor");
      inputWorkletRef.current = worklet;
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const float32 = e.data;
        const pcm16 = float32ToInt16(float32);
        const b64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
        try {
          session.sendRealtimeInput({
            media: { data: b64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
          });
        } catch {
          /* session may be closing */
        }
      };
      source.connect(worklet);
      // Don't connect worklet to destination — we don't want mic echo.

      // Output context for playing the model's audio at 24kHz.
      outputCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      playbackHeadRef.current = outputCtxRef.current.currentTime;
    } catch (err) {
      cleanup();
      setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Audio init failed" });
      return;
    }

    setStatus({ kind: "live" });
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

    // Live transcripts. Both input and output streams arrive incrementally;
    // we accumulate per-turn and flush when the turn completes.
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
    <section className="surface p-0 overflow-hidden">
      <header className="px-4 py-3 border-b border-rule flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading text-lg">Talk to {agentName}</h2>
          <p className="muted text-xs">
            Real Gemini Live audio. You speak; the agent speaks back.{" "}
            {voiceName ? (
              <>
                Voice: <code>{voiceName}</code>.
              </>
            ) : (
              "Default voice."
            )}{" "}
            {reservedMinutes != null && (
              <>Reserved {reservedMinutes} min from your daily dry-run cap.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          {canStart ? (
            <button
              type="button"
              onClick={start}
              className="btn bg-maroon text-white px-4 py-2 text-sm"
            >
              {status.kind === "ended" || status.kind === "error" ? "Start again" : "Start talking"}
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              disabled={status.kind === "starting" || status.kind === "stopping"}
              className="btn px-4 py-2 text-sm disabled:opacity-50"
            >
              {status.kind === "stopping" ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
      </header>

      <div className="bg-paper px-4 py-4 min-h-[260px] max-h-[60vh] overflow-y-auto space-y-3">
        {transcript.length === 0 && status.kind === "live" && (
          <p className="muted text-sm text-center py-12">
            Listening… start speaking. Transcript appears here as you talk.
          </p>
        )}
        {transcript.length === 0 && status.kind !== "live" && (
          <p className="muted text-sm text-center py-12">
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
        <div className="px-4 py-3 muted text-xs border-t border-rule">
          Session ended ({status.reason}). Click <strong>Start again</strong> to retry
          (uses another reservation against your daily cap).
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status["kind"], { label: string; cls: string }> = {
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
          isAgent ? "bg-white border border-rule" : "bg-maroon text-white"
        }`}
      >
        <div className={`text-xs mb-1 ${isAgent ? "muted" : "text-white/80"}`}>
          {isAgent ? agentName : "You (as student)"}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{text}</div>
      </div>
    </div>
  );
}

// ---- PCM <-> base64 helpers --------------------------------------------------

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
