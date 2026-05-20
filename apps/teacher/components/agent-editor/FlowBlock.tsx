"use client";

import { useRef, useState } from "react";
import {
  estimateDurationMin,
  MINUTES_PER_QUESTION,
  SOFT_MAX_DURATION_MIN,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";
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
 * Flow block — follow-up depth + personalization + prose flow body.
 *
 * Duration is computed (question_count × minutes-per-question[depth]); the
 * estimate banner is the dependency from QuestionSetBlock above.
 *
 * In template mode, the depth + personalization defaults are sourced from
 * either the override (non-null) or the preset; both are passed in. The
 * prose flow_body has its own override; null = inherit.
 */
export type FlowValues = {
  flow_body: string;
  follow_up_depth: FollowUpDepth;
  personalization_enabled: boolean;
};

export type FlowOverrideMask = {
  flow_body: boolean;
  follow_up_depth: boolean;
  personalization_enabled: boolean;
};

export function FlowBlock(props: {
  rowId: string;
  /** "Effective" values to display (override if set, else preset fallback). */
  values: FlowValues;
  mode: EditorMode;
  /** Total questions selected per session (sum of bucket select_count). */
  totalQuestions: number;
  /** In template mode, the preset row's values + which fields are
   *  currently overridden. Ignored in system mode. */
  presetFallback?: FlowValues;
  /** Which fields are currently overriding the preset (template mode only).
   *  Drives the inherit indicators below each field. */
  overrideMask?: FlowOverrideMask;
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
    totalQuestions,
    presetFallback,
    overrideMask,
    resetField,
    ns,
    freshnessKey,
    saveAction,
    run,
    tagStatus,
  } = props;

  // Live estimate: depth state is local so the estimate updates as the
  // teacher picks a different depth, before they save.
  const [depth, setDepth] = useState<FollowUpDepth>(values.follow_up_depth);
  const estimateMin = estimateDurationMin(totalQuestions, depth);
  const overCap = estimateMin > SOFT_MAX_DURATION_MIN;
  const proseMentionsMinutes = /\b\d+\s*(?:min|minutes|mins?)\b/i.test(
    values.flow_body,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const save = useFormSaveCallback({
    formRef,
    tag: `${ns}:flow`,
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
        <h3 className="heading text-lg">Flow</h3>
        <span className="muted text-xs">
          Examination structure + tempo knobs
        </span>
      </div>

      {/* Computed duration estimate (driven by question count × depth) */}
      <div
        className={`rounded border p-3 text-sm ${
          overCap
            ? "border-red-300 bg-red-50 text-red-900"
            : "border-rule bg-white"
        }`}
      >
        <div className="font-medium">
          Estimated session: ~{estimateMin} min{" "}
          <span className="font-normal muted">
            ({totalQuestions} question{totalQuestions === 1 ? "" : "s"} × ~
            {MINUTES_PER_QUESTION[depth]} min, depth = {depth})
          </span>
        </div>
        {overCap && (
          <p className="text-xs mt-1">
            Over the {SOFT_MAX_DURATION_MIN}-min soft cap. Reduce a bucket&apos;s
            Select N or lower the follow-up depth — oral exams over 20 min
            burn students out and runtime cost.
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 items-start">
        <Field
          label="Follow-up depth"
          hint="How aggressively the agent probes vague answers. Also drives the duration estimate above."
        >
          <select
            name="follow_up_depth"
            defaultValue={values.follow_up_depth}
            onChange={(e) => setDepth(e.target.value as FollowUpDepth)}
            className="w-full border border-rule rounded px-3 py-2 text-sm"
          >
            <option value="light">Light — accept first answer</option>
            <option value="medium">Medium — probe key claims once</option>
            <option value="deep">Deep — 2–3 levels on important claims</option>
          </select>
          {mode === "template" && (
            <InheritIndicator
              field="follow_up_depth"
              isOverriding={Boolean(overrideMask?.follow_up_depth)}
              presetLabel={presetFallback?.follow_up_depth ?? "medium"}
              rowId={rowId}
              ns={ns}
              resetField={resetField}
              run={run}
              tagStatus={tagStatus}
            />
          )}
        </Field>

        <Field
          label="Personalization"
          hint="Uses student name + assignment context in greetings/transitions."
        >
          {mode === "system" ? (
            <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
              <input
                type="checkbox"
                name="personalization_enabled"
                defaultChecked={values.personalization_enabled}
              />
              <span>Enabled</span>
            </label>
          ) : (
            // M2b.5b.11.b: tri-state in template mode so a teacher can pin
            // either explicit value or fall back to the preset without
            // clicking the reset-to-default button.
            <select
              name="personalization_enabled"
              defaultValue={
                overrideMask?.personalization_enabled
                  ? values.personalization_enabled
                    ? "on"
                    : "off"
                  : "inherit"
              }
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            >
              <option value="inherit">
                Inherit from preset (
                {presetFallback?.personalization_enabled
                  ? "enabled"
                  : "disabled"}
                )
              </option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          )}
          {mode === "template" && (
            <InheritIndicator
              field="personalization_enabled"
              isOverriding={Boolean(overrideMask?.personalization_enabled)}
              presetLabel={
                presetFallback?.personalization_enabled ? "enabled" : "disabled"
              }
              rowId={rowId}
              ns={ns}
              resetField={resetField}
              run={run}
              tagStatus={tagStatus}
            />
          )}
        </Field>
      </div>

      <Field
        label="Flow body"
        hint="Examination structure, phase pacing, follow-up types. The agent reads questions from QUESTIONS TO ASK in the order the server hands over. The estimate above is injected as a parameters block ahead of this prose at runtime — don't restate specific times in the prose or they'll contradict."
      >
        <textarea
          name="flow_body"
          defaultValue={values.flow_body}
          required={mode === "system"}
          rows={18}
          placeholder={
            mode === "template"
              ? "(leave empty to inherit from the preset's flow body)"
              : undefined
          }
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
        {mode === "template" && (
          <InheritIndicator
            field="flow_body"
            isOverriding={Boolean(overrideMask?.flow_body)}
            presetLabel={
              presetFallback?.flow_body
                ? truncate(presetFallback.flow_body, 80)
                : "(preset has no flow body)"
            }
            rowId={rowId}
            ns={ns}
            resetField={resetField}
            run={run}
            tagStatus={tagStatus}
          />
        )}
      </Field>
      {proseMentionsMinutes && (
        <p className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-300 rounded p-2">
          Heads up: the prose mentions specific minutes (e.g. &ldquo;15 min&rdquo;).
          The runtime composer already injects the computed duration above — if
          the numbers disagree the agent will read both. Consider removing
          specific times from the prose, or keep them only as relative
          guidance (&ldquo;briefly&rdquo; / &ldquo;at length&rdquo;).
        </p>
      )}

      {/* Auto-save: status surfaces in the page-level AutoSaveStatusPill. */}
    </form>
  );
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
