"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  installOralExamCard,
  uninstallOralExamCard,
} from "@/app/dashboard/actions";

export function InstallCardButton({
  canvasCourseId,
  canvasAssignmentId,
  installed,
  agentAssigned,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  installed: boolean;
  /** True when an agent template binding exists for this assignment.
   *  False blocks install entirely — every card must have an agent. */
  agentAssigned: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: "install" | "uninstall") {
    if (action === "uninstall") {
      if (
        !window.confirm(
          "Uninstall the card? The agent assignment will be removed too — cards and agents are paired.",
        )
      )
        return;
    }
    setError(null);
    startTransition(async () => {
      const fn = action === "install" ? installOralExamCard : uninstallOralExamCard;
      const r = await fn({ canvasCourseId, canvasAssignmentId });
      if (r.ok) {
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  if (installed) {
    return (
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-xs text-emerald-700 font-medium">Installed</span>
        <button
          onClick={() => run("uninstall")}
          disabled={pending}
          className="muted text-xs underline disabled:no-underline"
        >
          {pending ? "Removing…" : "Uninstall"}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    );
  }

  if (!agentAssigned) {
    return (
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <button
          type="button"
          disabled
          title="Pick an agent template first — every card needs an agent."
          className="inline-flex items-center gap-1.5 rounded font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed opacity-50 cursor-not-allowed"
        >
          Install card
        </button>
        <span className="muted text-xs italic">pick an agent first</span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <button
        onClick={() => run("install")}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Installing…" : "Install card"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
