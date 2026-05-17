"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  type ActionResult,
  createBucket,
  createQuestion,
  deleteBucket,
  deleteQuestion,
  moveBucket,
  updateBucket,
  updateEvaluation,
  updateFlow,
  updatePersona,
  updateQuestion,
  updateQuestionSet,
} from "./actions";
import { IntakeEditor } from "./IntakeEditor";
import type { IntakeConfig } from "@/lib/intake/types";
import {
  estimateDurationMin,
  MINUTES_PER_QUESTION,
  SOFT_MAX_DURATION_MIN,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";

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

// Gemini Live prebuilt voices (as of late 2025 / early 2026). Update this
// list when Google ships new voices in the Live API.
const LIVE_VOICES = [
  "Aoede",
  "Charon",
  "Fenrir",
  "Kore",
  "Leda",
  "Puck",
  "Orus",
  "Zephyr",
] as const;

type QSet = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type Bucket = {
  id: string;
  question_set_id: string;
  name: string;
  position: number;
  select_count: number;
};

type Question = {
  id: string;
  question_bucket_id: string;
  position: number;
  text: string;
  reference_snippet: string | null;
};

export type AgentData = {
  persona: Persona;
  intakeConfig: IntakeConfig;
  qset: QSet | null;
  buckets: Bucket[];
  questionsByBucket: Record<string, Question[]>;
};

type Status =
  | { kind: "idle" }
  | { kind: "saving"; tag: string }
  | { kind: "saved"; tag: string }
  | { kind: "error"; tag: string; msg: string };

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
        setStatus({ kind: "saved", tag });
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
    </div>
  );
}

/**
 * Walk a form's controls and return true if any field's current value
 * differs from its initial (DOM `defaultValue` / `defaultSelected` /
 * `defaultChecked`). Used by AgentCard to surface an "Unsaved changes"
 * badge in the summary header and to guard collapsing.
 *
 * Skips hidden/submit/button inputs. Selects fall back to per-option
 * `defaultSelected` since `HTMLSelectElement` has no `defaultValue`.
 */
function isFormDirty(form: HTMLFormElement): boolean {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
      } else if (
        el.type !== "hidden" &&
        el.type !== "submit" &&
        el.type !== "button"
      ) {
        if (el.value !== el.defaultValue) return true;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      for (const opt of Array.from(el.options)) {
        if (opt.selected !== opt.defaultSelected) return true;
      }
    }
  }
  return false;
}

/**
 * Listens for input/change events anywhere inside `bodyRef` and tracks
 * whether any descendant form marked `data-track-dirty` has unsaved
 * fields. `freshnessKey` (typically the persona's updated_at) resets the
 * dirty state after a successful save — React re-renders the children
 * with new defaultValues, and the next input event picks up the clean
 * state; resetting eagerly on key change avoids a stale flash.
 */
function useDirtyAgent(
  bodyRef: React.RefObject<HTMLElement | null>,
  freshnessKey: string,
): boolean {
  const [dirty, setDirty] = useState(false);
  // Reset-on-prop-change pattern from the React docs: track the last-seen
  // freshnessKey in state and reset dirty when it changes. Setting state
  // during render is the recommended path here (vs a useEffect, which
  // triggers cascading renders that eslint flags).
  const [seenKey, setSeenKey] = useState(freshnessKey);
  if (seenKey !== freshnessKey) {
    setSeenKey(freshnessKey);
    setDirty(false);
  }

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    function recompute() {
      const forms = body!.querySelectorAll<HTMLFormElement>(
        "form[data-track-dirty]",
      );
      setDirty(Array.from(forms).some(isFormDirty));
    }
    body.addEventListener("input", recompute);
    body.addEventListener("change", recompute);
    body.addEventListener("reset", recompute);
    return () => {
      body.removeEventListener("input", recompute);
      body.removeEventListener("change", recompute);
      body.removeEventListener("reset", recompute);
    };
  }, [bodyRef]);

  return dirty;
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
  const ns = persona.id; // namespace for form tags
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isDirty = useDirtyAgent(bodyRef, persona.updated_at);

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

      {/* Persona */}
      <form
        action={(fd) => run(`${ns}:persona`, () => updatePersona(fd))}
        data-track-dirty
        className="surface p-5 space-y-4"
      >
        <input type="hidden" name="id" value={persona.id} />
        <div className="flex items-baseline justify-between">
          <h3 className="heading text-lg">Persona</h3>
          <span className="muted text-xs">Voice, style, boundaries, examination flow</span>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Name">
            <input
              name="name"
              defaultValue={persona.name}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm font-medium"
            />
          </Field>
          <Field label="Description">
            <input
              name="description"
              defaultValue={persona.description ?? ""}
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Live voice">
            <select
              name="live_voice_name"
              defaultValue={persona.live_voice_name ?? ""}
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            >
              <option value="">(default — first available)</option>
              {LIVE_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Persona body"
          hint="Persona paragraph + voice rules + boundaries. The runtime prompt assembler wraps this in the safety envelope."
        >
          <textarea
            name="persona_body"
            defaultValue={persona.persona_body}
            required
            rows={20}
            className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Opening line"
            hint="Deterministic first words. Leave empty to let the flow's PHASE 1 govern."
          >
            <textarea
              name="opening_text"
              defaultValue={persona.opening_text ?? ""}
              rows={3}
              placeholder='e.g. "Good afternoon, dear student. I am ChekhovBot, here to discuss your essay…"'
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </Field>
          <Field
            label="Closing line"
            hint="Deterministic last words. Leave empty to let the flow's wrap govern."
          >
            <textarea
              name="closing_text"
              defaultValue={persona.closing_text ?? ""}
              rows={3}
              placeholder='e.g. "Thank you. Until next we meet by the cherry orchard…"'
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <SaveRow status={tagStatus(`${ns}:persona`)} label="Save persona" />
      </form>

      {/* Intake config (Canvas toggles + reference materials) — sets the
          context the agent receives before the exam */}
      <IntakeEditor
        ns={ns}
        personaId={persona.id}
        intakeConfig={agent.intakeConfig}
        capBytes={intakeCapBytes}
        run={run}
        tagStatus={tagStatus}
      />

      {/* Flow (follow-up depth + personalization + prose). Duration is
          computed from the question set just below — keep these adjacent
          so the dependency is visible. */}
      <FlowBlock
        ns={ns}
        persona={persona}
        totalQuestions={totalSelected}
        run={run}
        tagStatus={tagStatus}
      />

      {/* Question set — the questions the agent will ask. Sits next to Flow
          since select_count + depth jointly drive the session duration. */}
      {qset ? (
        <QuestionSetBlock
          ns={ns}
          qset={qset}
          buckets={buckets}
          questionsByBucket={questionsByBucket}
          depth={persona.follow_up_depth}
          run={run}
          tagStatus={tagStatus}
        />
      ) : (
        <div className="surface p-5">
          <p className="text-sm muted">
            No default question set linked. Edit the persona row in SQL to set{" "}
            <code>default_question_set_id</code>.
          </p>
        </div>
      )}

      {/* Evaluation (eval prompt + rubric) — runs post-session, doesn't
          touch the agent's runtime prompt. Goes last. */}
      <EvaluationBlock ns={ns} persona={persona} run={run} tagStatus={tagStatus} />
      </div>
    </details>
  );
}

function FlowBlock({
  ns,
  persona,
  totalQuestions,
  run,
  tagStatus,
}: {
  ns: string;
  persona: Persona;
  totalQuestions: number;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  // Live estimate: depth state is local so the estimate updates as the
  // teacher picks a different depth, before they save.
  const [depth, setDepth] = useState<FollowUpDepth>(persona.follow_up_depth);
  const estimateMin = estimateDurationMin(totalQuestions, depth);
  const overCap = estimateMin > SOFT_MAX_DURATION_MIN;
  const proseMentionsMinutes = /\b\d+\s*(?:min|minutes|mins?)\b/i.test(
    persona.flow_body,
  );

  return (
    <form
      action={(fd) => run(`${ns}:flow`, () => updateFlow(fd))}
      data-track-dirty
      className="surface p-5 space-y-4"
    >
      <input type="hidden" name="id" value={persona.id} />
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

      {/* Two knobs: depth + personalization. Duration is computed. */}
      <div className="grid sm:grid-cols-2 gap-4 items-start">
        <Field
          label="Follow-up depth"
          hint="How aggressively the agent probes vague answers. Also drives the duration estimate above."
        >
          <select
            name="follow_up_depth"
            defaultValue={persona.follow_up_depth}
            onChange={(e) => setDepth(e.target.value as FollowUpDepth)}
            className="w-full border border-rule rounded px-3 py-2 text-sm"
          >
            <option value="light">Light — accept first answer</option>
            <option value="medium">Medium — probe key claims once</option>
            <option value="deep">Deep — 2–3 levels on important claims</option>
          </select>
        </Field>

        <Field
          label="Personalization"
          hint="Uses student name + assignment context in greetings/transitions."
        >
          <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
            <input
              type="checkbox"
              name="personalization_enabled"
              defaultChecked={persona.personalization_enabled}
            />
            <span>Enabled</span>
          </label>
        </Field>
      </div>

      {/* Prose flow body */}
      <Field
        label="Flow body"
        hint="Examination structure, phase pacing, follow-up types. The agent reads questions from QUESTIONS TO ASK in the order the server hands over. The estimate above is injected as a parameters block ahead of this prose at runtime — don't restate specific times in the prose or they'll contradict."
      >
        <textarea
          name="flow_body"
          defaultValue={persona.flow_body}
          required
          rows={18}
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
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

      <SaveRow status={tagStatus(`${ns}:flow`)} label="Save flow" />
    </form>
  );
}

function EvaluationBlock({
  ns,
  persona,
  run,
  tagStatus,
}: {
  ns: string;
  persona: Persona;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const isUngraded = !persona.rubric_body;
  return (
    <form
      action={(fd) => run(`${ns}:eval`, () => updateEvaluation(fd))}
      data-track-dirty
      className="surface p-5 space-y-4"
    >
      <input type="hidden" name="id" value={persona.id} />
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-lg">Evaluation</h3>
        <span className="muted text-xs">
          {isUngraded ? "Ungraded — feedback only" : "Graded — produces score + grade adjustment"}
        </span>
      </div>

      <Field
        label="Evaluation prompt"
        hint="Post-session: runs over the transcript (and rubric, if any) to produce teacher-facing analysis."
      >
        <textarea
          name="eval_prompt_body"
          defaultValue={persona.eval_prompt_body ?? ""}
          required
          rows={10}
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
      </Field>

      <Field
        label="Rubric"
        hint="Leave empty to make this agent ungraded (eval prompt produces feedback only, no scores)."
      >
        <textarea
          name="rubric_body"
          defaultValue={persona.rubric_body ?? ""}
          rows={18}
          placeholder="(empty = ungraded)"
          className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
        />
      </Field>

      <SaveRow status={tagStatus(`${ns}:eval`)} label="Save evaluation" />
    </form>
  );
}

function QuestionSetBlock({
  ns,
  qset,
  buckets,
  questionsByBucket,
  depth,
  run,
  tagStatus,
}: {
  ns: string;
  qset: QSet;
  buckets: Bucket[];
  questionsByBucket: Record<string, Question[]>;
  depth: FollowUpDepth;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const totalQuestions = buckets.reduce(
    (sum, b) => sum + (questionsByBucket[b.id]?.length ?? 0),
    0
  );
  const totalSelected = buckets.reduce((sum, b) => sum + b.select_count, 0);
  const setEstimateMin = estimateDurationMin(totalSelected, depth);
  const setOverCap = setEstimateMin > SOFT_MAX_DURATION_MIN;

  return (
    <div className="surface p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="heading text-lg">Question set</h3>
        <span className="muted text-xs">
          {buckets.length} bucket{buckets.length === 1 ? "" : "s"} ·{" "}
          {totalQuestions} questions ·{" "}
          <span className={setOverCap ? "text-red-700 font-medium" : ""}>
            {totalSelected} asked per session ≈ ~{setEstimateMin} min
          </span>
        </span>
      </div>
      {setOverCap && (
        <div className="border border-red-300 bg-red-50 rounded p-2 text-xs text-red-900">
          Selecting {totalSelected} questions at {depth} depth lands at ~
          {setEstimateMin} min — over the {SOFT_MAX_DURATION_MIN}-min soft cap.
          Reduce a bucket&apos;s Select N below.
        </div>
      )}

      <form
        action={(fd) => run(`${ns}:set`, () => updateQuestionSet(fd))}
        data-track-dirty
        className="space-y-3 pb-4 border-b border-rule"
      >
        <input type="hidden" name="id" value={qset.id} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Set name">
            <input
              name="name"
              defaultValue={qset.name}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm font-medium"
            />
          </Field>
          <Field label="Set description">
            <input
              name="description"
              defaultValue={qset.description ?? ""}
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <SaveRow status={tagStatus(`${ns}:set`)} label="Save set details" small />
      </form>

      <div className="space-y-5 pt-2">
        {buckets.map((b, i) => (
          <BucketBlock
            key={b.id}
            ns={ns}
            bucket={b}
            questions={questionsByBucket[b.id] ?? []}
            isFirst={i === 0}
            isLast={i === buckets.length - 1}
            run={run}
            tagStatus={tagStatus}
          />
        ))}
      </div>

      {/* Add bucket */}
      <form
        action={(fd) => run(`${ns}:add-bucket`, () => createBucket(fd))}
        className="border-t border-rule pt-4 space-y-2"
      >
        <input type="hidden" name="question_set_id" value={qset.id} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs muted mb-1">Add bucket</label>
            <input
              name="name"
              required
              placeholder="bucket-name (e.g. process)"
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="w-28">
            <label className="block text-xs muted mb-1">Select N</label>
            <input
              name="select_count"
              type="number"
              min={0}
              defaultValue={1}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="btn bg-maroon text-white px-3 py-2 text-sm">
            Add
          </button>
        </div>
        <StatusLine status={tagStatus(`${ns}:add-bucket`)} compact />
      </form>
    </div>
  );
}

function BucketBlock({
  ns,
  bucket,
  questions,
  isFirst,
  isLast,
  run,
  tagStatus,
}: {
  ns: string;
  bucket: Bucket;
  questions: Question[];
  isFirst: boolean;
  isLast: boolean;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  return (
    <div className="border border-rule rounded p-4 space-y-3 bg-white">
      <div className="flex items-end gap-3 flex-wrap">
        <form
          action={(fd) => run(`${ns}:bucket:${bucket.id}`, () => updateBucket(fd))}
          className="flex items-end gap-3 flex-1 min-w-[260px]"
        >
          <input type="hidden" name="id" value={bucket.id} />
          <div className="flex-1">
            <label className="block text-xs muted mb-1">Bucket name</label>
            <input
              name="name"
              defaultValue={bucket.name}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm font-medium font-mono"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs muted mb-1">Select N</label>
            <input
              name="select_count"
              type="number"
              min={0}
              defaultValue={bucket.select_count}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="btn px-3 py-2 text-sm">
            Save
          </button>
        </form>

        <div className="flex items-center gap-1">
          <MoveButton
            disabled={isFirst}
            onClick={() =>
              run(`${ns}:bucket-move:${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                fd.set("question_set_id", bucket.question_set_id);
                fd.set("direction", "up");
                return moveBucket(fd);
              })
            }
            label="↑"
            title="Move bucket up"
          />
          <MoveButton
            disabled={isLast}
            onClick={() =>
              run(`${ns}:bucket-move:${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                fd.set("question_set_id", bucket.question_set_id);
                fd.set("direction", "down");
                return moveBucket(fd);
              })
            }
            label="↓"
            title="Move bucket down"
          />
          <DeleteButton
            label="Delete bucket"
            confirm={`Delete bucket "${bucket.name}" and all ${questions.length} of its questions? This cannot be undone.`}
            onConfirm={() =>
              run(`${ns}:bucket-del:${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                return deleteBucket(fd);
              })
            }
          />
        </div>
      </div>
      <StatusLine status={tagStatus(`${ns}:bucket:${bucket.id}`)} compact />
      <StatusLine status={tagStatus(`${ns}:bucket-move:${bucket.id}`)} compact />
      <StatusLine status={tagStatus(`${ns}:bucket-del:${bucket.id}`)} compact />

      <div>
        <p className="muted text-xs mb-1">
          Within-bucket order doesn&apos;t matter — the server picks{" "}
          <code>{bucket.select_count}</code> at random per session.
        </p>
        <div className="border-t border-rule">
          {questions.map((q) => (
            <QuestionRow
              key={q.id}
              ns={ns}
              question={q}
              run={run}
              tagStatus={tagStatus}
            />
          ))}
        </div>
        {questions.length === 0 && (
          <p className="muted text-xs">No questions in this bucket yet.</p>
        )}
      </div>

      {/* Add question */}
      <form
        action={(fd) =>
          run(`${ns}:add-q:${bucket.id}`, async () => {
            const r = await createQuestion(fd);
            if (r.ok) {
              const form = document.querySelector<HTMLFormElement>(
                `form[data-add-q="${bucket.id}"]`
              );
              form?.reset();
            }
            return r;
          })
        }
        data-add-q={bucket.id}
        className="border-t border-rule pt-2 space-y-2"
      >
        <input type="hidden" name="question_bucket_id" value={bucket.id} />
        <label className="block text-xs muted">Add question to this bucket</label>
        <textarea
          name="text"
          required
          rows={2}
          placeholder="Question text…"
          className="w-full border border-rule rounded px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn bg-maroon text-white px-3 py-1.5 text-xs">
            Add question
          </button>
          <StatusLine status={tagStatus(`${ns}:add-q:${bucket.id}`)} compact />
        </div>
      </form>
    </div>
  );
}

function QuestionRow({
  ns,
  question,
  run,
  tagStatus,
}: {
  ns: string;
  question: Question;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const status = tagStatus(`${ns}:q:${question.id}`);
  const delStatus = tagStatus(`${ns}:q-del:${question.id}`);
  return (
    <form
      action={(fd) => run(`${ns}:q:${question.id}`, () => updateQuestion(fd))}
      className="grid grid-cols-[1fr_180px_auto_auto] items-start gap-2 py-1.5 border-b border-rule last:border-0"
    >
      <input type="hidden" name="id" value={question.id} />
      <textarea
        name="text"
        defaultValue={question.text}
        required
        rows={1}
        className="[field-sizing:content] border border-rule rounded px-2 py-1 text-sm leading-snug resize-none min-h-[2rem]"
      />
      <input
        name="reference_snippet"
        defaultValue={question.reference_snippet ?? ""}
        placeholder='context for the agent (optional, e.g. "Re: Act 3 orchard scene")'
        title="Short anchor the agent can reference when asking this question — gives concrete grounding without forcing the agent to invent context. Leave blank if the question is self-contained."
        className="border border-rule rounded px-2 py-1 text-xs text-ink/70 min-h-[2rem]"
      />
      <button
        type="submit"
        title="Save row"
        className="btn px-2 py-1 text-xs min-h-[2rem]"
      >
        {status === "saving" ? "…" : "Save"}
      </button>
      <DeleteButton
        label="×"
        title="Delete question"
        confirm="Delete this question? This cannot be undone."
        onConfirm={() =>
          run(`${ns}:q-del:${question.id}`, () => {
            const fd = new FormData();
            fd.set("id", question.id);
            return deleteQuestion(fd);
          })
        }
      />
      {(status === "saved" || (typeof status === "string" && status !== "saving" && status !== "saved")) && (
        <div className="col-span-4 -mt-1">
          <StatusLine status={status} compact />
        </div>
      )}
      {delStatus && delStatus !== "saving" && (
        <div className="col-span-4 -mt-1">
          <StatusLine status={delStatus} compact />
        </div>
      )}
    </form>
  );
}

function MoveButton({
  disabled,
  onClick,
  label,
  title,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="btn px-2 py-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

function DeleteButton({
  label,
  title,
  confirm,
  onConfirm,
}: {
  label: string;
  title?: string;
  confirm: string;
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        if (window.confirm(confirm)) onConfirm();
      }}
      className="btn px-2 py-1 text-xs text-red-700 hover:bg-red-50"
    >
      {label}
    </button>
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

function SaveRow({
  status,
  label,
  small,
}: {
  status: string | null;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        className={`btn bg-maroon text-white ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"}`}
      >
        {status === "saving" ? "Saving…" : label}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status, compact }: { status: string | null; compact?: boolean }) {
  if (!status || status === "saving") return null;
  const cls = compact ? "text-xs" : "text-sm";
  if (status === "saved") return <span className={`${cls} text-green-700`}>Saved.</span>;
  return <span className={`${cls} text-red-700`}>Error: {status}</span>;
}
