"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";

type Status = "idle" | "saving" | "saved" | { error: string };

/**
 * Collapsible card for editing a single text body via a server action.
 * Reused for the safety envelope and the system-wide prompts (student_summary,
 * transcription) at the top of /admin/agents.
 */
export function CollapsibleEditor({
  title,
  subtitle,
  body,
  updatedAt,
  saveAction,
  hiddenId,
  textareaRows = 16,
}: {
  title: string;
  subtitle: string;
  body: string;
  updatedAt: string;
  saveAction: (formData: FormData) => Promise<ActionResult>;
  hiddenId?: string | number;
  textareaRows?: number;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();

  async function action(formData: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await saveAction(formData);
      if (result.ok) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus({ error: result.error });
      }
    });
  }

  return (
    <section className="surface p-4 border-l-4 border-maroon">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="heading text-lg">{title}</h3>
          <p className="muted text-xs mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="muted text-xs">
            {new Date(updatedAt).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="btn px-3 py-1 text-xs"
          >
            {open ? "Collapse" : "Edit"}
          </button>
        </div>
      </header>

      {open && (
        <form action={action} className="mt-4 space-y-3">
          {hiddenId !== undefined && (
            <input type="hidden" name="id" value={String(hiddenId)} />
          )}
          <textarea
            name="body"
            defaultValue={body}
            required
            rows={textareaRows}
            className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="btn bg-maroon text-white px-4 py-2 text-sm"
              disabled={status === "saving"}
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
            {status === "saved" && (
              <span className="text-sm text-green-700">Saved.</span>
            )}
            {typeof status === "object" && "error" in status && (
              <span className="text-sm text-red-700">Error: {status.error}</span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
