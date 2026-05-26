"use client";

import { useRef } from "react";
import {
  Field,
  InheritIndicator,
  useAutoSaveForm,
  useFormSaveCallback,
} from "./Primitives";
import {
  type EditorMode,
  type LiveVoice,
  type RunAction,
  type ServerFormAction,
  type TagStatus,
  LIVE_VOICES,
} from "./types";

/**
 * Persona block — character, voice, opening/closing.
 *
 * Used by:
 *   - /admin/agents       (mode="system",   editing personality_presets row)
 *   - /assignments/[aid]/edit (mode="template", editing exam_templates row)
 *
 * In system mode the form edits name + description + persona_body +
 * live_voice_name + opening/closing. In template mode, name + description
 * aren't shown here (the template carries its own name displayed at the top
 * of the edit page); each editable field gets an InheritIndicator showing
 * the preset fallback value with a per-field reset affordance.
 */
export type PersonaValues = {
  /** Required in system mode (= personality_presets.name). Unused in template mode. */
  name?: string;
  description?: string | null;
  /** Effective body — what to show in the textarea. May be the preset's
   *  fallback if template mode is inheriting. */
  persona_body: string;
  live_voice_name: string | null;
  opening_text: string | null;
  closing_text: string | null;
};

export type PersonaOverrideMask = {
  persona_body: boolean;
  live_voice_name: boolean;
  opening_text: boolean;
  closing_text: boolean;
};

export function PersonaBlock(props: {
  /** Row id passed as form field `id` to saveAction. */
  rowId: string;
  values: PersonaValues;
  mode: EditorMode;
  /** Template mode only: preset fallback values for inherit indicators. */
  presetFallback?: PersonaValues;
  /** Template mode only: which fields are currently overriding the preset. */
  overrideMask?: PersonaOverrideMask;
  /** Template mode only: per-field reset action. FormData carries `id` + `field`. */
  resetField?: ServerFormAction;
  ns: string;
  /** Row's updated_at — resets the auto-save debounce when a fresh
   *  server payload replaces defaultValues. */
  freshnessKey: string;
  saveAction: ServerFormAction;
  run: RunAction;
  tagStatus: TagStatus;
}) {
  const {
    rowId,
    values,
    mode,
    presetFallback,
    overrideMask,
    resetField,
    ns,
    freshnessKey,
    saveAction,
    run,
    tagStatus,
  } = props;

  const formRef = useRef<HTMLFormElement>(null);
  const save = useFormSaveCallback({
    formRef,
    tag: `${ns}:persona`,
    run,
    action: saveAction,
  });
  useAutoSaveForm({ formRef, save, freshnessKey });

  return (
    <form
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      data-track-dirty
      className="bg-white border border-stone-200 rounded p-5 space-y-4"
    >
      <input type="hidden" name="id" value={rowId} />
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium text-ink text-lg">Persona</h3>
        <span className="text-stone-500 text-xs">Voice, style, boundaries</span>
      </div>

      {mode === "system" ? (
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Name">
            <input
              name="name"
              defaultValue={values.name ?? ""}
              required
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm font-medium"
            />
          </Field>
          <Field label="Description">
            <input
              name="description"
              defaultValue={values.description ?? ""}
              className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Live voice">
            <VoiceSelect defaultValue={values.live_voice_name ?? ""} />
          </Field>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Live voice">
            <VoiceSelect defaultValue={values.live_voice_name ?? ""} />
            <InheritIndicator
              field="live_voice_name"
              isOverriding={Boolean(overrideMask?.live_voice_name)}
              presetLabel={presetFallback?.live_voice_name ?? "(default voice)"}
              rowId={rowId}
              ns={ns}
              resetField={resetField}
              run={run}
              tagStatus={tagStatus}
            />
          </Field>
        </div>
      )}

      <Field
        label="Persona body"
        hint="Persona paragraph + voice rules + boundaries. The runtime prompt assembler wraps this in the safety envelope."
      >
        <textarea
          name="persona_body"
          defaultValue={values.persona_body}
          required={mode === "system"}
          rows={20}
          placeholder={
            mode === "template"
              ? "(leave empty to inherit from the preset's persona body)"
              : undefined
          }
          className="w-full border border-stone-300 rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
        {mode === "template" && (
          <InheritIndicator
            field="persona_body"
            isOverriding={Boolean(overrideMask?.persona_body)}
            presetLabel={
              presetFallback?.persona_body
                ? truncate(presetFallback.persona_body)
                : "(preset has no persona body)"
            }
            rowId={rowId}
            ns={ns}
            resetField={resetField}
            run={run}
            tagStatus={tagStatus}
          />
        )}
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field
          label="Opening line"
          hint="Deterministic first words. Leave empty to let the flow's PHASE 1 govern."
        >
          <textarea
            name="opening_text"
            defaultValue={values.opening_text ?? ""}
            rows={3}
            placeholder='e.g. "Good afternoon, dear student. I am ChekhovBot, here to discuss your essay…"'
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          />
          {mode === "template" && (
            <InheritIndicator
              field="opening_text"
              isOverriding={Boolean(overrideMask?.opening_text)}
              presetLabel={presetFallback?.opening_text ?? "(no preset opening)"}
              rowId={rowId}
              ns={ns}
              resetField={resetField}
              run={run}
              tagStatus={tagStatus}
            />
          )}
        </Field>
        <Field
          label="Closing line"
          hint="Deterministic last words. Leave empty to let the flow's wrap govern."
        >
          <textarea
            name="closing_text"
            defaultValue={values.closing_text ?? ""}
            rows={3}
            placeholder='e.g. "Thank you. Until next we meet by the cherry orchard…"'
            className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
          />
          {mode === "template" && (
            <InheritIndicator
              field="closing_text"
              isOverriding={Boolean(overrideMask?.closing_text)}
              presetLabel={presetFallback?.closing_text ?? "(no preset closing)"}
              rowId={rowId}
              ns={ns}
              resetField={resetField}
              run={run}
              tagStatus={tagStatus}
            />
          )}
        </Field>
      </div>

      {/* Auto-save: status surfaces in the page-level AutoSaveStatusPill.
          tagStatus is still threaded to InheritIndicator (reset status)
          but no per-form SaveRow lives here. */}
    </form>
  );
}

function VoiceSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select
      name="live_voice_name"
      defaultValue={defaultValue}
      className="w-full border border-stone-300 rounded px-3 py-2 text-sm"
    >
      <option value="">(default — inherit / first available)</option>
      {LIVE_VOICES.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export { LIVE_VOICES };
export type { LiveVoice };
