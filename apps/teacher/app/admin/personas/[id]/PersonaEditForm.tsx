"use client";

import { useState, useTransition } from "react";
import { updatePersona } from "../actions";

type Preset = {
  id: string;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
};

export function PersonaEditForm({ preset }: { preset: Preset }) {
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function action(formData: FormData) {
    setStatus({ kind: "saving" });
    startTransition(async () => {
      const result = await updatePersona(formData);
      if (result.ok) {
        setStatus({ kind: "saved" });
        setTimeout(() => setStatus({ kind: "idle" }), 2500);
      } else {
        setStatus({ kind: "error", msg: result.error });
      }
    });
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={preset.id} />

      <Field label="Name" hint="Shown in template editor preset picker">
        <input
          name="name"
          defaultValue={preset.name}
          required
          className="w-full border border-rule rounded px-3 py-2 text-sm font-medium"
        />
      </Field>

      <Field label="Description" hint="One-line summary of when to use this persona">
        <input
          name="description"
          defaultValue={preset.description ?? ""}
          className="w-full border border-rule rounded px-3 py-2 text-sm"
        />
      </Field>

      <Field
        label="Persona body"
        hint="Persona, voice rules, boundaries. Plain prose — the runtime prompt assembler wraps this in the safety envelope."
      >
        <textarea
          name="persona_body"
          defaultValue={preset.persona_body}
          required
          rows={24}
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
      </Field>

      <Field
        label="Flow body"
        hint="Examination structure, phase timings, follow-up types. The agent reads the question list from QUESTIONS TO ASK in the order the server hands it over."
      >
        <textarea
          name="flow_body"
          defaultValue={preset.flow_body}
          required
          rows={20}
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
      </Field>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="btn bg-maroon text-white px-4 py-2 disabled:opacity-50"
        >
          {status.kind === "saving" ? "Saving…" : "Save changes"}
        </button>
        {status.kind === "saved" && (
          <span className="text-sm text-green-700">Saved.</span>
        )}
        {status.kind === "error" && (
          <span className="text-sm text-red-700">Error: {status.msg}</span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {hint && <p className="muted text-xs mb-2">{hint}</p>}
      {children}
    </div>
  );
}
