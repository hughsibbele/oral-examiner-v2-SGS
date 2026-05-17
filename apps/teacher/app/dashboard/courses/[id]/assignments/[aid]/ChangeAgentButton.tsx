"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeAgentForTemplate } from "@/app/dashboard/actions";

export function ChangeAgentButton({
  canvasCourseId,
  canvasAssignmentId,
  presetId,
  presetName,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  presetId: string;
  presetName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await changeAgentForTemplate({
        canvasCourseId,
        canvasAssignmentId,
        presetId,
      });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <div className="flex items-baseline gap-2">
      <button onClick={onClick} disabled={pending} className="btn btn-sm">
        {pending ? "Switching…" : `Switch to ${presetName}`}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
