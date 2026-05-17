"use client";

import { useState, useTransition } from "react";
import { updateSafetyEnvelope } from "./actions";

type Envelope = { id: number; body: string; updated_at: string } | null;

export function SafetyEnvelopeForm({ envelope }: { envelope: Envelope }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const [, startTransition] = useTransition();

  if (!envelope) {
    return (
      <div className="surface p-4 border-l-4 border-red-700">
        <p className="text-sm">
          No safety envelope row found. Re-run the seed migration or insert one
          manually into <code>safety_envelope</code>.
        </p>
      </div>
    );
  }

  async function action(formData: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateSafetyEnvelope(formData);
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
        <div>
          <h2 className="heading text-lg">Safety envelope</h2>
          <p className="muted text-xs mt-0.5">
            Universal rules applied to every agent at runtime — wrapped around
            each persona + flow before the model sees the prompt. Edited here,
            once, by admins.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="muted text-xs">
            Updated {new Date(envelope.updated_at).toLocaleString()}
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
          <textarea
            name="body"
            defaultValue={envelope.body}
            required
            rows={20}
            className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="btn bg-maroon text-white px-4 py-2 text-sm"
              disabled={status === "saving"}
            >
              {status === "saving" ? "Saving…" : "Save envelope"}
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
