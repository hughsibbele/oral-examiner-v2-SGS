"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshCourses } from "./actions";

export function RefreshCoursesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function onClick() {
    setStatus(null);
    startTransition(async () => {
      const r = await refreshCourses();
      if (r.ok) {
        setStatus(
          `Synced ${r.count} active-term course${r.count === 1 ? "" : "s"}` +
            (r.filtered && r.filtered > 0
              ? ` (skipped ${r.filtered} out-of-term).`
              : "."),
        );
        router.refresh();
      } else {
        setStatus(`Error: ${r.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={onClick} disabled={pending} className="btn">
        {pending ? "Syncing…" : "Refresh courses from Canvas"}
      </button>
      {status && <span className="muted text-xs">{status}</span>}
    </div>
  );
}
