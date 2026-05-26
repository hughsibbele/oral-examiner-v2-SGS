"use client";

import { useState, useTransition } from "react";
import type { ExamCardText } from "@oral-examiner/canvas";
import { CardPreview } from "../../dashboard/courses/[id]/assignments/[aid]/CardPreview";
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
  appBaseUrl: string;
};

/**
 * Admin-only editor for the five system-default card text strings. Lives
 * as an always-open box on /admin/agents (not collapsed) so admins can see
 * the live preview as they type — matches the teacher's
 * /dashboard/canvas CardTextEditor pattern.
 *
 * Unlike the teacher version, every field is required + non-empty here —
 * the singleton row's columns are NOT NULL with sane seeded defaults, and
 * the resolver chain falls back to these values for any teacher who
 * hasn't overridden the field.
 */
export function CardTextDefaultsEditor({ initial, updatedAt, appBaseUrl }: Props) {
  const [kicker, setKicker] = useState(initial.kicker);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [ctaLabel, setCtaLabel] = useState(initial.cta_label);
  const [footnote, setFootnote] = useState(initial.footnote);
  const [status, setStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const effective: ExamCardText = {
    kicker: kicker.trim() || initial.kicker,
    title: title.trim() || initial.title,
    body: body.trim() || initial.body,
    ctaLabel: ctaLabel.trim() || initial.cta_label,
    footnote: footnote.trim() || initial.footnote,
  };

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
    <section className="bg-white border border-stone-200 rounded p-5 space-y-4">
      <div>
        <h2 className="font-medium">Canvas card text — system defaults</h2>
        <p className="text-stone-500 text-xs mt-1">
          What teachers see as the placeholder fallback per field. Each
          teacher can override any subset on their own{" "}
          <code>/dashboard/canvas</code> page; changes here apply to anyone
          who hasn&apos;t overridden the field. Updated{" "}
          {new Date(updatedAt).toLocaleDateString()}.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr] gap-5">
        <form action={handleSubmit} className="space-y-4">
          <Row
            label="Kicker (ALL CAPS line at top)"
            name="kicker"
            value={kicker}
            setValue={setKicker}
          />
          <Row
            label="Title"
            name="title"
            value={title}
            setValue={setTitle}
          />
          <Row
            label="Body paragraph"
            name="body"
            value={body}
            setValue={setBody}
            multiline
          />
          <Row
            label="Button label"
            name="cta_label"
            value={ctaLabel}
            setValue={setCtaLabel}
          />
          <Row
            label="Footnote (italic line under the button)"
            name="footnote"
            value={footnote}
            setValue={setFootnote}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm"
            >
              {status === "saving" ? "Saving…" : "Save defaults"}
            </button>
            {status === "saved" && (
              <span className="text-xs text-green-700">Saved.</span>
            )}
            {status && status !== "saved" && status !== "saving" && (
              <span className="text-xs text-red-700">Error: {status}</span>
            )}
          </div>
        </form>

        <div className="lg:sticky lg:top-4 self-start">
          <CardPreview
            appBaseUrl={appBaseUrl}
            canvasAssignmentId="preview-1234"
            text={effective}
          />
          <p className="text-stone-500 text-xs mt-2">
            Live preview reflects your draft. The button doesn&apos;t go
            anywhere in this preview.
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  name,
  value,
  setValue,
  multiline,
}: {
  label: string;
  name: string;
  value: string;
  setValue: (s: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          rows={4}
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm leading-snug"
        />
      ) : (
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
