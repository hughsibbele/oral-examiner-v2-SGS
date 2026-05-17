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
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  installed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: "install" | "uninstall") {
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
        <span className="text-xs text-success">Installed</span>
        <button
          onClick={() => run("uninstall")}
          disabled={pending}
          className="muted text-xs underline disabled:no-underline"
        >
          {pending ? "Removing…" : "Uninstall"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <button
        onClick={() => run("install")}
        disabled={pending}
        className="btn btn-sm"
      >
        {pending ? "Installing…" : "Install card"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
