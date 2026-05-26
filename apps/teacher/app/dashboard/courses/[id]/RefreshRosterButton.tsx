"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshRoster } from "@/app/dashboard/actions";

export function RefreshRosterButton({
  canvasCourseId,
}: {
  canvasCourseId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function onClick() {
    setStatus(null);
    startTransition(async () => {
      const r = await refreshRoster(canvasCourseId);
      if (r.ok) {
        const skipNote =
          r.skipped && r.skipped > 0
            ? ` (skipped ${r.skipped} without an email)`
            : "";
        setStatus(
          `Synced ${r.students} student${r.students === 1 ? "" : "s"}${skipNote}.`,
        );
        router.refresh();
      } else {
        setStatus(`Error: ${r.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={onClick} disabled={pending} className="inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed">
        {pending ? "Syncing…" : "Refresh roster from Canvas"}
      </button>
      {status && <span className="text-stone-500 text-xs">{status}</span>}
    </div>
  );
}
