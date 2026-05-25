"use client";

import { useFormStatus } from "react-dom";

/**
 * Pending-aware refresh button — ported from AI Documenter's pattern.
 * `useFormStatus` reads the parent <form>'s submission state so the click
 * feels instant; the SyncIndicator next to it mirrors the same pending
 * state so "Synced X ago" doesn't sit stale during the refresh.
 */
export function RefreshButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex items-center gap-1.5 rounded border border-light-blue bg-white px-3 py-1.5 text-xs text-ink transition-colors hover:border-maroon hover:text-maroon disabled:cursor-not-allowed disabled:opacity-60"
      title="Pull the latest courses + active-term assignments from Canvas"
    >
      {pending && <Spinner />}
      {pending ? "Refreshing…" : "Refresh from Canvas"}
    </button>
  );
}

export function SyncIndicator({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const { pending } = useFormStatus();
  return (
    <span
      className="muted text-xs italic"
      title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}
    >
      {pending
        ? "Pulling from Canvas…"
        : lastSyncedAt
          ? `Synced ${formatRelativeTime(lastSyncedAt)}`
          : "Not synced yet"}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeDasharray="42 18"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
