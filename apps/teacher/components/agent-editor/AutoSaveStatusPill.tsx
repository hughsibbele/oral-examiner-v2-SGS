"use client";

import { useEffect, useState } from "react";

/**
 * Sticky bottom-right pill that surfaces the editor's current auto-save
 * state. Mirrors the shared `Status` union maintained by AgentsEditor /
 * TemplateEditor:
 *   { kind: "idle" }
 *   { kind: "saving"; tag }
 *   { kind: "saved";  tag }
 *   { kind: "error";  tag; msg }
 *
 * Reads the kind only — tags are irrelevant to the user, so we don't
 * surface "which field saved." On error, the message is shown verbatim
 * (server actions return user-friendly strings already).
 *
 * The "Saved · just now / 12s ago" relative timer rolls forward on a
 * 5-second interval and resets each time a save completes.
 */
export type AutoSaveStatus =
  | { kind: "idle" }
  | { kind: "saving"; tag: string }
  | { kind: "saved"; tag: string; at: number }
  | { kind: "error"; tag: string; msg: string };

export function AutoSaveStatusPill({ status }: { status: AutoSaveStatus }) {
  // Track the last time we entered the "saved" state so the relative
  // timer keeps ticking after the parent flips back to "idle" (which
  // happens after 2s in the existing machinery). Set-state-during-
  // render with previous-value tracking is the React-recommended
  // pattern here (mirrors useDirtyBody's freshnessKey handling). The
  // timestamp comes from the status itself (parent stamps it at save
  // completion) so this hook stays pure — Date.now() in render would
  // trip the react-hooks/purity lint.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [seenKind, setSeenKind] = useState(status.kind);
  if (seenKind !== status.kind) {
    setSeenKind(status.kind);
    if (status.kind === "saved") setLastSavedAt(status.at);
  }

  const [relative, setRelative] = useState("just now");
  useEffect(() => {
    if (lastSavedAt === null) return;
    function tick() {
      const elapsed = Math.floor((Date.now() - lastSavedAt!) / 1000);
      if (elapsed < 5) setRelative("just now");
      else if (elapsed < 60) setRelative(`${elapsed}s ago`);
      else if (elapsed < 3600) setRelative(`${Math.floor(elapsed / 60)}m ago`);
      else setRelative(`${Math.floor(elapsed / 3600)}h ago`);
    }
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  if (status.kind === "saving") {
    return (
      <Pill cls="bg-white text-ink border-stone-200">
        <Spinner /> Saving…
      </Pill>
    );
  }
  if (status.kind === "error") {
    return (
      <Pill cls="bg-red-50 text-red-800 border-red-300">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-600" />
        Save failed — {status.msg}
      </Pill>
    );
  }
  // idle or saved: show "Saved · X ago" if anything has ever saved this
  // session; otherwise render nothing (a never-touched editor doesn't
  // need a pill).
  if (lastSavedAt === null) return null;
  return (
    <Pill cls="bg-green-50 text-green-800 border-green-300">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-600" />
      Saved · {relative}
    </Pill>
  );
}

function Pill({
  cls,
  children,
}: {
  cls: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-50 border rounded-full px-4 py-2 text-sm font-medium shadow-md flex items-center gap-2.5 ${cls}`}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 border-2 border-current border-r-transparent rounded-full animate-spin"
      aria-hidden
    />
  );
}
