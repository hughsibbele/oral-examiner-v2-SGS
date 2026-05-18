"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  estimateDurationMin,
  SOFT_MAX_DURATION_MIN,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";
import {
  EvaluationBlock,
  FlowBlock,
  PersonaBlock,
  QuestionSetBlock,
  SaveRow,
  useDirtyBody,
  type ActionResult,
  type BucketRow,
  type QSetRow,
  type QuestionRow,
} from "@/components/agent-editor";
import type { IntakeConfig } from "@/lib/intake/types";
import { deleteTemplate, setAssignmentAgent } from "../../../actions";
import {
  resetTemplateField,
  updateTemplateEvaluation,
  updateTemplateFlow,
  updateTemplateName,
  updateTemplatePersona,
} from "./actions";

/**
 * Standalone-template editor. Loaded by templateId (not assignment id); the
 * template carries its persona/flow/eval overrides + intake + question set
 * directly. A separate `bindings` slice shows which Canvas assignments
 * currently use this template.
 *
 * Templates may be preset-backed (clone-from-system) or blank-slate
 * (preset=null). In blank-slate mode every override value lives on the
 * template itself; the inherit indicators say "(no preset — type a value
 * to set this field)".
 */

export type TemplateEditorData = {
  template: {
    id: string;
    name: string;
    updated_at: string;
    persona_body: string | null;
    flow_body: string | null;
    follow_up_depth: FollowUpDepth | null;
    personalization_enabled: boolean | null;
    eval_prompt_body: string | null;
    rubric_body: string | null;
    live_voice_name: string | null;
    opening_text: string | null;
    closing_text: string | null;
    intake_config: IntakeConfig;
  };
  preset: {
    id: string;
    name: string;
    description: string | null;
    persona_body: string;
    flow_body: string;
    follow_up_depth: FollowUpDepth;
    personalization_enabled: boolean;
    eval_prompt_body: string | null;
    rubric_body: string | null;
    live_voice_name: string | null;
    opening_text: string | null;
    closing_text: string | null;
    intake_config: IntakeConfig;
  } | null;
  qset: QSetRow | null;
  buckets: BucketRow[];
  questionsByBucket: Record<string, QuestionRow[]>;
  bindings: {
    canvas_course_id: string;
    canvas_assignment_id: string;
    exam_token: string;
    assignment_name: string | null;
    course_name: string | null;
  }[];
};

type Status =
  | { kind: "idle" }
  | { kind: "saving"; tag: string }
  | { kind: "saved"; tag: string }
  | { kind: "error"; tag: string; msg: string };

export function TemplateEditor({ data }: { data: TemplateEditorData }) {
  const { template, preset, qset, buckets, questionsByBucket, bindings } = data;
  const ns = template.id;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useDirtyBody(bodyRef, template.updated_at);

  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function run(tag: string, action: () => Promise<ActionResult>) {
    setStatus({ kind: "saving", tag });
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setStatus({ kind: "saved", tag });
        setTimeout(() => {
          setStatus((s) =>
            s.kind === "saved" && s.tag === tag ? { kind: "idle" } : s,
          );
        }, 2000);
      } else {
        setStatus({ kind: "error", tag, msg: result.error });
      }
    });
  }

  const tagStatus = (tag: string): string | null => {
    if (status.kind === "saving" && status.tag === tag) return "saving";
    if (status.kind === "saved" && status.tag === tag) return "saved";
    if (status.kind === "error" && status.tag === tag) return status.msg;
    return null;
  };

  // Effective values: prefer template override, else fall back to the preset
  // (or empty / sensible default when blank-slate).
  const personaValues = {
    persona_body: template.persona_body ?? preset?.persona_body ?? "",
    live_voice_name: template.live_voice_name ?? preset?.live_voice_name ?? null,
    opening_text: template.opening_text ?? preset?.opening_text ?? null,
    closing_text: template.closing_text ?? preset?.closing_text ?? null,
  };
  const personaOverrideMask = {
    persona_body: template.persona_body !== null,
    live_voice_name: template.live_voice_name !== null,
    opening_text: template.opening_text !== null,
    closing_text: template.closing_text !== null,
  };

  const flowValues = {
    flow_body: template.flow_body ?? preset?.flow_body ?? "",
    follow_up_depth: (template.follow_up_depth ?? preset?.follow_up_depth ?? "medium") as FollowUpDepth,
    personalization_enabled:
      template.personalization_enabled ?? preset?.personalization_enabled ?? true,
  };
  const flowOverrideMask = {
    flow_body: template.flow_body !== null,
    follow_up_depth: template.follow_up_depth !== null,
    personalization_enabled: template.personalization_enabled !== null,
  };

  const evalValues = {
    eval_prompt_body:
      template.eval_prompt_body ?? preset?.eval_prompt_body ?? "",
    rubric_body: template.rubric_body ?? preset?.rubric_body ?? null,
  };
  const evalOverrideMask = {
    eval_prompt_body: template.eval_prompt_body !== null,
    rubric_body: template.rubric_body !== null,
  };

  const totalSelected = buckets.reduce((sum, b) => sum + b.select_count, 0);
  const summaryEstimateMin = estimateDurationMin(
    totalSelected,
    flowValues.follow_up_depth,
  );
  const summaryOverCap = summaryEstimateMin > SOFT_MAX_DURATION_MIN;

  const overrideCount =
    Object.values(personaOverrideMask).filter(Boolean).length +
    Object.values(flowOverrideMask).filter(Boolean).length +
    Object.values(evalOverrideMask).filter(Boolean).length;

  function onUnbind(canvasCourseId: string, canvasAssignmentId: string) {
    if (
      !window.confirm(
        "Detach this template and remove the Canvas card? Cards without an agent route students nowhere, so both get pulled.",
      )
    )
      return;
    run(`${ns}:unbind:${canvasAssignmentId}`, async () => {
      const r = await setAssignmentAgent({
        canvasCourseId,
        canvasAssignmentId,
        agent: null,
      });
      if (r.ok) router.refresh();
      return r;
    });
  }

  function onDelete() {
    if (
      !window.confirm(
        bindings.length > 0
          ? `Delete this template? It's currently used by ${bindings.length} assignment${bindings.length === 1 ? "" : "s"} — those Canvas cards will be removed too, and the assignments will need a new agent assigned before students can take the exam.`
          : "Delete this template?",
      )
    )
      return;
    run(`${ns}:delete`, async () => {
      const fd = new FormData();
      fd.set("id", template.id);
      const r = await deleteTemplate(fd);
      if (r.ok) router.push("/dashboard/agents");
      return r;
    });
  }

  return (
    <div ref={bodyRef} className="space-y-5">
      {/* Header summary */}
      <section className="surface p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm">
              {preset ? (
                <>
                  Based on <strong>{preset.name}</strong>
                  {preset.description && (
                    <span className="muted"> — {preset.description}</span>
                  )}
                </>
              ) : (
                <span className="muted">Blank-slate template</span>
              )}
            </p>
            <p className="muted text-xs mt-0.5">
              {totalSelected} question{totalSelected === 1 ? "" : "s"} per
              session ≈{" "}
              <span className={summaryOverCap ? "text-red-700 font-medium" : ""}>
                ~{summaryEstimateMin} min
              </span>{" "}
              · {flowValues.follow_up_depth} depth ·{" "}
              {overrideCount === 0
                ? "all fields inherit from preset"
                : `${overrideCount} field${overrideCount === 1 ? "" : "s"} overridden`}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-red-700 underline hover:no-underline"
          >
            Delete template
          </button>
        </div>
      </section>

      {/* Bound assignments */}
      {bindings.length > 0 && (
        <section className="surface p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="heading text-sm">Used by</h3>
            <span className="muted text-xs">
              Detach to free an assignment for a different template
            </span>
          </div>
          <ul className="divide-y divide-rule">
            {bindings.map((b) => (
              <li
                key={b.canvas_assignment_id}
                className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {b.assignment_name ?? `Assignment ${b.canvas_assignment_id}`}
                  </div>
                  <div className="muted text-xs">
                    {b.course_name ?? `Course ${b.canvas_course_id}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onUnbind(b.canvas_course_id, b.canvas_assignment_id)
                  }
                  className="text-xs muted underline hover:text-maroon"
                >
                  detach
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Template name */}
      <form
        action={(fd) => run(`${ns}:name`, () => updateTemplateName(fd))}
        data-track-dirty
        className="surface p-5 space-y-3"
      >
        <input type="hidden" name="id" value={template.id} />
        <div className="flex items-baseline justify-between">
          <h3 className="heading text-lg">Template name</h3>
          <span className="muted text-xs">
            How this template appears in the Agent hub.
          </span>
        </div>
        <input
          name="name"
          defaultValue={template.name}
          required
          className="w-full border border-rule rounded px-3 py-2 text-sm font-medium"
        />
        <SaveRow status={tagStatus(`${ns}:name`)} label="Save name" small />
      </form>

      {/* Persona */}
      <PersonaBlock
        rowId={template.id}
        mode="template"
        values={personaValues}
        presetFallback={
          preset
            ? {
                persona_body: preset.persona_body,
                live_voice_name: preset.live_voice_name,
                opening_text: preset.opening_text,
                closing_text: preset.closing_text,
              }
            : undefined
        }
        overrideMask={personaOverrideMask}
        ns={ns}
        saveAction={updateTemplatePersona}
        resetField={resetTemplateField}
        run={run}
        tagStatus={tagStatus}
      />

      {/* Intake — read-only stub until M2b.5b.4 */}
      <IntakeReadOnlyPanel templateIntake={template.intake_config} />

      {/* Flow */}
      <FlowBlock
        rowId={template.id}
        mode="template"
        values={flowValues}
        totalQuestions={totalSelected}
        presetFallback={
          preset
            ? {
                flow_body: preset.flow_body,
                follow_up_depth: preset.follow_up_depth,
                personalization_enabled: preset.personalization_enabled,
              }
            : undefined
        }
        overrideMask={flowOverrideMask}
        ns={ns}
        saveAction={updateTemplateFlow}
        resetField={resetTemplateField}
        run={run}
        tagStatus={tagStatus}
      />

      {/* Question set — read-only until M2b.5b.5/5b.6 */}
      {qset ? (
        <>
          <QuestionSetBlock
            ns={ns}
            qset={qset}
            buckets={buckets}
            questionsByBucket={questionsByBucket}
            depth={flowValues.follow_up_depth}
            readOnly
            run={run}
            tagStatus={tagStatus}
          />
          <p className="muted text-xs px-1">
            Question set is system-seeded — per-template question editing
            ships in M2b.5b.5 / M2b.5b.6 (picker + clone-to-mine + inline
            editor). For now, admins edit the defaults at{" "}
            <Link href="/admin/agents" className="text-maroon no-underline hover:underline">
              /admin/agents
            </Link>
            .
          </p>
        </>
      ) : (
        <div className="surface p-5">
          <p className="text-sm muted">
            No question set linked yet. Pick a system agent (or wait for
            M2b.5b.5) to attach a question bank.
          </p>
        </div>
      )}

      {/* Evaluation */}
      <EvaluationBlock
        rowId={template.id}
        mode="template"
        values={evalValues}
        presetFallback={
          preset
            ? {
                eval_prompt_body: preset.eval_prompt_body ?? "",
                rubric_body: preset.rubric_body,
              }
            : undefined
        }
        overrideMask={evalOverrideMask}
        ns={ns}
        saveAction={updateTemplateEvaluation}
        resetField={resetTemplateField}
        run={run}
        tagStatus={tagStatus}
      />
    </div>
  );
}

function IntakeReadOnlyPanel({
  templateIntake,
}: {
  templateIntake: IntakeConfig;
}) {
  const attachmentCount = templateIntake.attachments.length;
  return (
    <section className="surface p-5 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-lg">Intake</h3>
        <span className="muted text-xs">
          Context the agent receives before the exam
        </span>
      </div>
      <ul className="text-sm space-y-1">
        <li>
          {templateIntake.use_canvas_description ? "✓" : "○"} Canvas assignment
          description
        </li>
        <li>
          {templateIntake.use_canvas_submission ? "✓" : "○"} Student&rsquo;s
          Canvas submission
        </li>
        <li>
          {attachmentCount === 0
            ? "○ No reference attachments"
            : `✓ ${attachmentCount} reference attachment${attachmentCount === 1 ? "" : "s"}`}
        </li>
      </ul>
      <p className="muted text-xs">
        Per-template intake editing ships in M2b.5b.4.
      </p>
    </section>
  );
}
