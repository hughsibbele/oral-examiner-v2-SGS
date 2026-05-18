"use client";

import { useState, useTransition } from "react";
import { updateCardTextDefaults } from "./actions";

type Props = {
  initial: {
    kicker: string;
    title: string;
    body: string;
    cta_label: string;
    footnote: string;
  };
  updatedAt: string;
};

/**
 * Admin-only editor for the five system-default card text strings. Mirrors
 * the CollapsibleEditor pattern next to the safety envelope; uses a
 * minimal flat form because the fields are short and the page already has
 * lots of <details> noise.
 */
export function CardTextDefaultsEditor({ initial, updatedAt }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleSubmit(fd: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateCardTextDefaults(fd);
      if (result.ok) {
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  return (
    <details className="surface">
      <summary className="cursor-pointer p-4 select-none">
        <span className="font-medium">Canvas card text — system defaults</span>
        <span className="muted text-xs ml-3">
          What teachers see as the placeholder fallback per field. Updated{" "}
          {new Date(updatedAt).toLocaleDateString()}.
        </span>
      </summary>
      <form action={handleSubmit} className="px-4 pb-4 space-y-3">
        <Row label="Kicker" name="kicker" defaultValue={initial.kicker} />
        <Row label="Title" name="title" defaultValue={initial.title} />
        <Row label="Body paragraph" name="body" defaultValue={initial.body} multiline />
        <Row label="Button label" name="cta_label" defaultValue={initial.cta_label} />
        <Row label="Footnote" name="footnote" defaultValue={initial.footnote} />
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            className="btn bg-maroon text-white px-4 py-2 text-sm"
          >
            {status === "saving" ? "Saving…" : "Save defaults"}
          </button>
          {status === "saved" && (
            <span className="text-xs text-green-700">Saved.</span>
          )}
          {status && status !== "saved" && status !== "saving" && (
            <span className="text-xs text-red-700">Error: {status}</span>
          )}
          <span className="muted text-xs ml-auto">
            Per-teacher overrides live on each teacher&apos;s{" "}
            <code>/dashboard/canvas</code> page.
          </span>
        </div>
      </form>
    </details>
  );
}

function Row({
  label,
  name,
  defaultValue,
  multiline,
}: {
  label: string;
  name: string;
  defaultValue: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {multiline ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          required
          rows={4}
          className="w-full border border-rule rounded px-3 py-2 text-sm leading-snug"
        />
      ) : (
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          required
          className="w-full border border-rule rounded px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
