"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCanvasToken } from "./actions";

export function CanvasTokenForm({
  hasExisting,
  initialHost,
}: {
  hasExisting: boolean;
  initialHost: string;
}) {
  const router = useRouter();
  const [host, setHost] = useState(initialHost);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(null);
    startTransition(async () => {
      const result = await saveCanvasToken({ host, token });
      if (result.ok) {
        setStatus({
          ok: true,
          message: `Connected as ${result.canvasUserName} (Canvas ID ${result.canvasUserId}).`,
        });
        setToken("");
        router.refresh();
      } else {
        setStatus({ ok: false, message: result.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="surface p-5 space-y-4">
      <h2 className="heading text-lg">
        {hasExisting ? "Update Canvas token" : "Connect Canvas"}
      </h2>

      <div className="space-y-1">
        <label htmlFor="canvas-host" className="text-sm font-medium block">
          Canvas host
        </label>
        <input
          id="canvas-host"
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="episcopalhighschool.instructure.com"
          required
          className="w-full px-3 py-1.5 border border-rule rounded text-sm"
        />
        <p className="muted text-xs">
          The hostname only — no <code>https://</code>, no path.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="canvas-token" className="text-sm font-medium block">
          Canvas API token
        </label>
        <input
          id="canvas-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasExisting ? "(unchanged unless you paste a new one)" : ""}
          required={!hasExisting}
          className="w-full px-3 py-1.5 border border-rule rounded text-sm font-mono"
        />
      </div>

      {status && (
        <div
          className={
            status.ok
              ? "text-sm text-dark-blue"
              : "text-sm text-maroon"
          }
        >
          {status.ok ? "✓ " : "✗ "}
          {status.message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || (!hasExisting && (!host || !token))}
          className="btn btn-primary"
        >
          {pending ? "Verifying…" : hasExisting ? "Update connection" : "Connect"}
        </button>
        {hasExisting && (
          <span className="muted text-xs">
            Pasting a new token replaces the existing one.
          </span>
        )}
      </div>
    </form>
  );
}
