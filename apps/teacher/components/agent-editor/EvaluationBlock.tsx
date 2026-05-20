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
  type RunAction,
  type ServerFormAction,
  type TagStatus,
} from "./types";

/**
 * Evaluation block — post-session eval prompt + optional rubric.
 *
 * Used by both /admin/agents and /assignments/[aid]/edit. In template mode,
 * each field gets an inherit indicator + per-field reset. The runtime never
 * sees eval / rubric — they run after the session finishes.
 */
export type EvaluationValues = {
  eval_prompt_body: string;
  rubric_body: string | null;
};

export type EvaluationOverrideMask = {
  eval_prompt_body: boolean;
  rubric_body: boolean;
};

export function EvaluationBlock(props: {
  rowId: string;
  values: EvaluationValues;
  mode: EditorMode;
  presetFallback?: EvaluationValues;
  overrideMask?: EvaluationOverrideMask;
  resetField?: ServerFormAction;
  ns: string;
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

  // In system mode, "ungraded" is computed from the preset's rubric. In
  // template mode, ungraded is the effective value (override OR preset).
  const isUngraded = !values.rubric_body;

  const formRef = useRef<HTMLFormElement>(null);
  const save = useFormSaveCallback({
    formRef,
    tag: `${ns}:eval`,
    run,
    action: saveAction,
  });
  useAutoSaveForm({ formRef, save, freshnessKey });

  return (
    <form
      ref={formRef}
      onSubmit={(e) => e.preventDefault()}
      data-track-dirty
      className="surface p-5 space-y-4"
    >
      <input type="hidden" name="id" value={rowId} />
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-lg">Evaluation</h3>
        <span className="muted text-xs">
          {isUngraded
            ? "Ungraded — feedback only"
            : "Graded — produces score + grade adjustment"}
        </span>
      </div>

      <Field
        label="Evaluation prompt"
        hint="Post-session: runs over the transcript (and rubric, if any) to produce teacher-facing analysis."
      >
        <textarea
          name="eval_prompt_body"
          defaultValue={values.eval_prompt_body}
          required={mode === "system"}
          rows={10}
          placeholder={
            mode === "template"
              ? "(leave empty to inherit from the preset's eval prompt)"
              : undefined
          }
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
        {mode === "template" && (
          <InheritIndicator
            field="eval_prompt_body"
            isOverriding={Boolean(overrideMask?.eval_prompt_body)}
            presetLabel={
              presetFallback?.eval_prompt_body
                ? truncate(presetFallback.eval_prompt_body)
                : "(preset has no eval prompt)"
            }
            rowId={rowId}
            ns={ns}
            resetField={resetField}
            run={run}
            tagStatus={tagStatus}
          />
        )}
      </Field>

      <Field
        label="Rubric"
        hint="Leave empty to make this agent ungraded (eval prompt produces feedback only, no scores)."
      >
        <textarea
          name="rubric_body"
          defaultValue={values.rubric_body ?? ""}
          rows={18}
          placeholder="(empty = ungraded)"
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
        {mode === "template" && (
          <InheritIndicator
            field="rubric_body"
            isOverriding={Boolean(overrideMask?.rubric_body)}
            presetLabel={
              presetFallback?.rubric_body
                ? truncate(presetFallback.rubric_body)
                : "(preset is ungraded)"
            }
            rowId={rowId}
            ns={ns}
            resetField={resetField}
            run={run}
            tagStatus={tagStatus}
          />
        )}
      </Field>

      {/* Auto-save: status surfaces in the page-level AutoSaveStatusPill. */}
    </form>
  );
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
