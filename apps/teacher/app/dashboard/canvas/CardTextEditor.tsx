"use client";

import { useState, useTransition } from "react";
import type { ExamCardText } from "@oral-examiner/canvas";
import { CardPreview } from "../courses/[id]/assignments/[aid]/CardPreview";
import { resetMyCardOverride, updateMyCardOverrides } from "./actions";

type CardOverrides = {
  card_kicker: string | null;
  card_title: string | null;
  card_body: string | null;
  card_cta_label: string | null;
  card_footnote: string | null;
};

/**
 * Card-text customization surface — teacher-facing. Five fields, each with
 * an inheriting placeholder + per-field "reset to admin default" button.
 * Live preview renders the current draft (uncommitted edits show in the
 * preview immediately) so the teacher sees the effect before saving.
 */
export function CardTextEditor({
  defaults,
  overrides,
  appBaseUrl,
  previewAssignmentId,
}: {
  defaults: ExamCardText;
  overrides: CardOverrides;
  appBaseUrl: string;
  /** Stand-in id used in the preview's CTA href. Doesn't have to map to a
   *  real assignment — just shapes the link. */
  previewAssignmentId: string;
}) {
  const [kicker, setKicker] = useState(overrides.card_kicker ?? "");
  const [title, setTitle] = useState(overrides.card_title ?? "");
  const [body, setBody] = useState(overrides.card_body ?? "");
  const [ctaLabel, setCtaLabel] = useState(overrides.card_cta_label ?? "");
  const [footnote, setFootnote] = useState(overrides.card_footnote ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const effective: ExamCardText = {
    kicker: kicker.trim() || defaults.kicker,
    title: title.trim() || defaults.title,
    body: body.trim() || defaults.body,
    ctaLabel: ctaLabel.trim() || defaults.ctaLabel,
    footnote: footnote.trim() || defaults.footnote,
  };

  function handleSave(fd: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateMyCardOverrides(fd);
      if (result.ok) {
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  function handleReset(field: keyof CardOverrides, setter: (s: string) => void) {
    setStatus("saving");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("field", field);
      const result = await resetMyCardOverride(fd);
      if (result.ok) {
        setter("");
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  return (
    <section className="bg-white border border-light-blue rounded p-5 space-y-4">
      <div>
        <h2 className="font-medium">Canvas card text</h2>
        <p className="muted text-xs mt-1">
          The wording inside the branded card students see in Canvas. Leave a
          field blank to inherit the school-wide default. Changes apply to{" "}
          <strong>future installs</strong> — already-installed cards keep the
          old text until you re-install (or uninstall + install).
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr] gap-5">
        <form action={handleSave} className="space-y-4">
          <Field
            label="Kicker (ALL CAPS line at top)"
            field="card_kicker"
            value={kicker}
            setValue={setKicker}
            placeholder={defaults.kicker}
            onReset={() => handleReset("card_kicker", setKicker)}
          />
          <Field
            label="Title"
            field="card_title"
            value={title}
            setValue={setTitle}
            placeholder={defaults.title}
            onReset={() => handleReset("card_title", setTitle)}
          />
          <Field
            label="Body paragraph"
            field="card_body"
            value={body}
            setValue={setBody}
            placeholder={defaults.body}
            onReset={() => handleReset("card_body", setBody)}
            multiline
          />
          <Field
            label="Button label"
            field="card_cta_label"
            value={ctaLabel}
            setValue={setCtaLabel}
            placeholder={defaults.ctaLabel}
            onReset={() => handleReset("card_cta_label", setCtaLabel)}
          />
          <Field
            label="Footnote (italic line under the button)"
            field="card_footnote"
            value={footnote}
            setValue={setFootnote}
            placeholder={defaults.footnote}
            onReset={() => handleReset("card_footnote", setFootnote)}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm"
            >
              {status === "saving" ? "Saving…" : "Save card text"}
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
            canvasAssignmentId={previewAssignmentId}
            text={effective}
          />
          <p className="muted text-xs mt-2">
            Live preview reflects your draft. The button doesn&apos;t go
            anywhere in this preview.
          </p>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  field,
  value,
  setValue,
  placeholder,
  onReset,
  multiline,
}: {
  label: string;
  field: string;
  value: string;
  setValue: (s: string) => void;
  placeholder: string;
  onReset: () => void;
  multiline?: boolean;
}) {
  const overriding = value.trim() !== "";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="block text-sm font-medium mb-1">{label}</label>
        {overriding && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-maroon hover:underline"
          >
            reset to default
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          name={field}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder={placeholder}
          className="w-full border border-light-blue rounded px-3 py-2 text-sm leading-snug"
        />
      ) : (
        <input
          type="text"
          name={field}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-light-blue rounded px-3 py-2 text-sm"
        />
      )}
      <p className="muted text-xs mt-1">
        {overriding ? (
          <>
            ● overriding the default. Empty saves re-inherit.
          </>
        ) : (
          <>inherits the school-wide default shown as placeholder above</>
        )}
      </p>
    </div>
  );
}
