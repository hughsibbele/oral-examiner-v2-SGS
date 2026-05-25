"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  type ActionResult,
  addIntakeAttachmentFromDrive,
  addIntakeAttachmentFromPaste,
  addIntakeAttachmentFromUpload,
  createBucket,
  createQuestion,
  deleteBucket,
  deleteQuestion,
  moveBucket,
  removeIntakeAttachment,
  updateBucket,
  updateEvaluation,
  updateFlow,
  updateIntakeToggles,
  updatePersona,
  updateQuestion,
  updateQuestionSet,
} from "./actions";
import type { IntakeConfig } from "@/lib/intake/types";
import {
  estimateDurationMin,
  SOFT_MAX_DURATION_MIN,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";
import {
  AutoSaveStatusPill,
  EvaluationBlock,
  FlowBlock,
  IntakeBlock,
  PersonaBlock,
  QuestionSetBlock,
  useDirtyBody,
  type AutoSaveStatus,
  type BucketRow,
  type IntakeActions,
  type QSetRow,
  type QuestionRow,
} from "@/components/agent-editor";

const ADMIN_INTAKE_ACTIONS: IntakeActions = {
  updateToggles: updateIntakeToggles,
  addFromDrive: addIntakeAttachmentFromDrive,
  addFromUpload: addIntakeAttachmentFromUpload,
  addFromPaste: addIntakeAttachmentFromPaste,
  removeAttachment: removeIntakeAttachment,
  // Admin mode: persona's intake_config IS the default; no reset affordance.
  resetIntake: undefined,
};

type Persona = {
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
  updated_at: string;
};

export type AgentData = {
  persona: Persona;
  intakeConfig: IntakeConfig;
  qset: QSetRow | null;
  buckets: BucketRow[];
  questionsByBucket: Record<string, QuestionRow[]>;
};

type Status = AutoSaveStatus;

export function AgentsEditor({
  agents,
  intakeCapBytes,
}: {
  agents: AgentData[];
  intakeCapBytes: number;
}) {
  // Shared status state — each form tag is unique across the page (prefixed
  // by persona id), so two agents being edited concurrently don't collide.
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function run(tag: string, action: () => Promise<ActionResult>) {
    setStatus({ kind: "saving", tag });
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setStatus({ kind: "saved", tag, at: Date.now() });
        setTimeout(() => {
          setStatus((s) => (s.kind === "saved" && s.tag === tag ? { kind: "idle" } : s));
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

  return (
    <div className="space-y-12">
      {agents.map((a) => (
        <AgentCard
          key={a.persona.id}
          agent={a}
          intakeCapBytes={intakeCapBytes}
          run={run}
          tagStatus={tagStatus}
        />
      ))}
      <AutoSaveStatusPill status={status} />
    </div>
  );
}

function AgentCard({
  agent,
  intakeCapBytes,
  run,
  tagStatus,
}: {
  agent: AgentData;
  intakeCapBytes: number;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const { persona, qset, buckets, questionsByBucket } = agent;
  const ns = persona.id;
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isDirty = useDirtyBody(bodyRef, persona.updated_at);

  // Guard collapse: if the user closes the <details> while there are
  // unsaved changes, confirm — and reopen on cancel.
  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    function onToggle() {
      if (!el!.open && isDirty) {
        const ok = window.confirm(
          `You have unsaved changes on ${persona.name}. Collapse anyway and discard? OK to discard, Cancel to keep editing.`,
        );
        if (!ok) {
          el!.open = true;
        }
      }
    }
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [isDirty, persona.name]);

  // Drives the Flow section's session-duration estimate. Lives at AgentCard
  // scope so FlowBlock (above) and QuestionSetBlock (below) agree.
  const totalSelected = buckets.reduce((sum, b) => sum + b.select_count, 0);
  const summaryEstimateMin = estimateDurationMin(
    totalSelected,
    persona.follow_up_depth,
  );
  const summaryOverCap = summaryEstimateMin > SOFT_MAX_DURATION_MIN;

  return (
    // `name="agents"` makes these mutually-exclusive native accordions —
    // opening one auto-closes the others. The `id` on details lets the
    // sticky nav at the top of the page anchor-jump AND auto-open the
    // target (browsers open <details> when a fragment targets them).
    <details
      ref={detailsRef}
      id={`agent-${persona.id}`}
      name="agents"
      className="scroll-mt-20 group"
    >
      <summary
        className={`cursor-pointer list-none border-l-4 pl-4 py-2 select-none ${
          isDirty ? "border-yellow-500" : "border-maroon"
        }`}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="heading text-2xl">{persona.name}</h2>
          {isDirty && (
            <span
              className="text-xs font-medium text-yellow-800 bg-yellow-100 border border-yellow-300 rounded px-1.5 py-0.5"
              title="At least one form on this agent has changes that haven't been saved."
            >
              ● Unsaved changes
            </span>
          )}
          <span className="muted text-xs">
            {totalSelected} question{totalSelected === 1 ? "" : "s"} · ~
            <span className={summaryOverCap ? "text-red-700 font-medium" : ""}>
              {summaryEstimateMin} min
            </span>
            {" · "}
            {persona.follow_up_depth} depth
          </span>
          <span className="muted text-xs ml-auto group-open:hidden">
            ▸ click to expand
          </span>
          <span className="muted text-xs ml-auto hidden group-open:inline">
            ▾ collapse
          </span>
        </div>
        {persona.description && (
          <p className="muted text-sm mt-1">{persona.description}</p>
        )}
      </summary>

      <div ref={bodyRef} className="space-y-5 mt-5">
        <p className="muted text-xs">
          Persona updated {new Date(persona.updated_at).toLocaleDateString()}
          {qset && (
            <>
              {" · "}question set updated{" "}
              {new Date(qset.updated_at).toLocaleDateString()}
            </>
          )}
          {" · "}
          <a
            href={`/dashboard/agents/${persona.id}/try`}
            className="text-maroon no-underline hover:underline"
          >
            try it out (teacher view) →
          </a>
        </p>

        <PersonaBlock
          rowId={persona.id}
          mode="system"
          values={{
            name: persona.name,
            description: persona.description,
            persona_body: persona.persona_body,
            live_voice_name: persona.live_voice_name,
            opening_text: persona.opening_text,
            closing_text: persona.closing_text,
          }}
          ns={ns}
          freshnessKey={persona.updated_at}
          saveAction={updatePersona}
          run={run}
          tagStatus={tagStatus}
        />

        {/* Intake config (Canvas toggles + reference materials) */}
        <IntakeBlock
          ns={ns}
          rowId={persona.id}
          mode="system"
          intakeConfig={agent.intakeConfig}
          capBytes={intakeCapBytes}
          freshnessKey={persona.updated_at}
          actions={ADMIN_INTAKE_ACTIONS}
          run={run}
          tagStatus={tagStatus}
        />

        {/* Flow + question set sit adjacent — select_count × depth jointly
            drive the session-duration estimate. */}
        <FlowBlock
          rowId={persona.id}
          mode="system"
          values={{
            flow_body: persona.flow_body,
            follow_up_depth: persona.follow_up_depth,
            personalization_enabled: persona.personalization_enabled,
          }}
          totalQuestions={totalSelected}
          ns={ns}
          freshnessKey={persona.updated_at}
          saveAction={updateFlow}
          run={run}
          tagStatus={tagStatus}
        />

        {qset ? (
          <QuestionSetBlock
            ns={ns}
            qset={qset}
            buckets={buckets}
            questionsByBucket={questionsByBucket}
            depth={persona.follow_up_depth}
            actions={{
              updateSet: updateQuestionSet,
              createBucket,
              updateBucket,
              deleteBucket,
              moveBucket,
              createQuestion,
              updateQuestion,
              deleteQuestion,
            }}
            run={run}
            tagStatus={tagStatus}
          />
        ) : (
          <div className="bg-white border border-light-blue rounded p-5">
            <p className="text-sm muted">
              No default question set linked. Edit the persona row in SQL to set{" "}
              <code>default_question_set_id</code>.
            </p>
          </div>
        )}

        <EvaluationBlock
          rowId={persona.id}
          mode="system"
          values={{
            eval_prompt_body: persona.eval_prompt_body ?? "",
            rubric_body: persona.rubric_body,
          }}
          ns={ns}
          freshnessKey={persona.updated_at}
          saveAction={updateEvaluation}
          run={run}
          tagStatus={tagStatus}
        />
      </div>
    </details>
  );
}
