"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshAssignments } from "@/app/dashboard/actions";

export function RefreshAssignmentsButton({
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
      const r = await refreshAssignments(canvasCourseId);
      if (r.ok) {
        setStatus(`Synced ${r.count} published assignment${r.count === 1 ? "" : "s"}.`);
        router.refresh();
      } else {
        setStatus(`Error: ${r.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={onClick} disabled={pending} className="btn">
        {pending ? "Syncing…" : "Refresh from Canvas"}
      </button>
      {status && <span className="muted text-xs">{status}</span>}
    </div>
  );
}
