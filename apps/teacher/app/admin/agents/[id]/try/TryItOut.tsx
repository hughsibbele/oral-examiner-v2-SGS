"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "model"; text: string };

export function TryItOut({
  systemPrompt,
  agentName,
}: {
  systemPrompt: string;
  agentName: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);

    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setPending(true);

    try {
      const res = await fetch("/api/admin/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, messages: next }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessages([...next, { role: "model", text: data.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setPending(false);
    }
  }

  async function startConversation() {
    // Kick off by asking the agent to begin. Empty user-turn isn't allowed by
    // most chat APIs, so seed with a brief prompt that mirrors how the agent
    // would actually start (Gemini Live opens the conversation on connect).
    if (messages.length > 0 || pending) return;
    setPending(true);
    setError(null);
    const seed: Msg[] = [
      { role: "user", text: "[The student just joined. Greet them and begin the examination according to your flow.]" },
    ];
    setMessages(seed);
    try {
      const res = await fetch("/api/admin/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, messages: seed }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMessages([...seed, { role: "model", text: data.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
    setError(null);
  }

  return (
    <section className="surface p-0 overflow-hidden">
      <header className="px-4 py-3 border-b border-rule flex items-center justify-between">
        <div>
          <h2 className="heading text-lg">Chat with {agentName}</h2>
          <p className="muted text-xs">
            You play the student. Refresh the page for a fresh random question set.
          </p>
        </div>
        <div className="flex gap-2">
          {messages.length === 0 ? (
            <button
              type="button"
              onClick={startConversation}
              disabled={pending}
              className="btn bg-maroon text-white px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {pending ? "Starting…" : "Start conversation"}
            </button>
          ) : (
            <button type="button" onClick={reset} className="btn px-3 py-1.5 text-sm">
              Reset
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="bg-paper px-4 py-4 space-y-3 min-h-[300px] max-h-[60vh] overflow-y-auto"
      >
        {messages.length === 0 && !pending && (
          <p className="muted text-sm text-center py-12">
            Click <strong>Start conversation</strong> above to have the agent open.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} agentName={agentName} />
        ))}
        {pending && (
          <MessageBubble role="model" text="…" agentName={agentName} muted />
        )}
        {error && (
          <div className="text-sm text-red-700 border border-red-200 rounded p-2">
            Error: {error}
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="border-t border-rule px-4 py-3 flex gap-2 items-end"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            messages.length === 0
              ? "Start the conversation first ↑"
              : "Your reply… (Enter to send, Shift+Enter for newline)"
          }
          rows={2}
          disabled={pending || messages.length === 0}
          className="flex-1 border border-rule rounded px-3 py-2 text-sm resize-y min-h-[2.5rem] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || messages.length === 0 || !input.trim()}
          className="btn bg-maroon text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function MessageBubble({
  role,
  text,
  agentName,
  muted,
}: {
  role: "user" | "model";
  text: string;
  agentName: string;
  muted?: boolean;
}) {
  const isAgent = role === "model";
  const label = isAgent ? agentName : "You (as student)";
  return (
    <div className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isAgent
            ? "bg-white border border-rule"
            : "bg-maroon text-white"
        } ${muted ? "opacity-50" : ""}`}
      >
        <div
          className={`text-xs mb-1 ${
            isAgent ? "muted" : "text-white/80"
          }`}
        >
          {label}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{text}</div>
      </div>
    </div>
  );
}
