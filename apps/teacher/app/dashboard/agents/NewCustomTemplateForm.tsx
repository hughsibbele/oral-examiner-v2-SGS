"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createTemplateForm } from "./actions";

/**
 * "+ New custom template" form: required name + dropdown source picker.
 * Name collision with any default is rejected server-side; we also hint
 * locally so teachers don't waste a round-trip.
 */
export function NewCustomTemplateForm({
  sources,
  defaultNames,
}: {
  sources: {
    kind: "preset" | "template" | "blank";
    id: string;
    label: string;
  }[];
  defaultNames: string[];
}) {
  // Encode kind+id as a single string for the select; split in the form
  // submit handler so server gets two clean fields. Blank sources have
  // empty id and are still valid.
  const [pick, setPick] = useState<string>(
    sources[0] ? `${sources[0].kind}:${sources[0].id}` : "",
  );
  const [kind, id] = pick.split(":") as [
    "preset" | "template" | "blank" | "",
    string | undefined,
  ];

  return (
    <form action={createTemplateForm} className="space-y-4">
      <input type="hidden" name="source_kind" value={kind ?? ""} />
      <input type="hidden" name="source_id" value={id ?? ""} />

      <div>
        <label className="block text-xs muted mb-1">Template name</label>
        <input
          name="name"
          required
          minLength={1}
          placeholder="e.g. Final paper · close reading"
          className="w-full border border-light-blue rounded px-3 py-2 text-sm"
        />
        <p className="muted text-[10px] mt-1">
          Must differ from any default name:{" "}
          {defaultNames.map((n) => `"${n}"`).join(", ")}
        </p>
      </div>

      <div>
        <label className="block text-xs muted mb-1">Clone from</label>
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="w-full border border-light-blue rounded px-3 py-2 text-sm"
          disabled={sources.length === 0}
        >
          {sources.map((s) => (
            <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm disabled:opacity-50"
    >
      {pending ? "Cloning…" : "Create custom template"}
    </button>
  );
}
