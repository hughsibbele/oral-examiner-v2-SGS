"use client";

import { useState, useTransition } from "react";
import {
  type ActionResult,
  createBucket,
  createQuestion,
  deleteBucket,
  deleteQuestion,
  moveBucket,
  updateBucket,
  updateEvaluation,
  updatePersona,
  updateQuestion,
  updateQuestionSet,
} from "./actions";

type Persona = {
  id: string;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
  eval_prompt_body: string | null;
  rubric_body: string | null;
  updated_at: string;
};

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
  qset: QSet | null;
  buckets: Bucket[];
  questionsByBucket: Record<string, Question[]>;
};

type Status =
  | { kind: "idle" }
  | { kind: "saving"; tag: string }
  | { kind: "saved"; tag: string }
  | { kind: "error"; tag: string; msg: string };

export function AgentsEditor({ agents }: { agents: AgentData[] }) {
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
        <AgentCard key={a.persona.id} agent={a} run={run} tagStatus={tagStatus} />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  run,
  tagStatus,
}: {
  agent: AgentData;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const { persona, qset, buckets, questionsByBucket } = agent;
  const ns = persona.id; // namespace for form tags

  return (
    <section id={`agent-${persona.id}`} className="scroll-mt-20 space-y-5">
      <header className="border-l-4 border-maroon pl-4">
        <h2 className="heading text-2xl">{persona.name}</h2>
        {persona.description && (
          <p className="muted text-sm mt-1">{persona.description}</p>
        )}
        <p className="muted text-xs mt-1">
          Persona updated {new Date(persona.updated_at).toLocaleDateString()}
          {qset && (
            <>
              {" · "}question set updated{" "}
              {new Date(qset.updated_at).toLocaleDateString()}
            </>
          )}
        </p>
      </header>

      {/* Persona */}
      <form
        action={(fd) => run(`${ns}:persona`, () => updatePersona(fd))}
        className="surface p-5 space-y-4"
      >
        <input type="hidden" name="id" value={persona.id} />
        <div className="flex items-baseline justify-between">
          <h3 className="heading text-lg">Persona</h3>
          <span className="muted text-xs">Voice, style, boundaries, examination flow</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
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

        <Field
          label="Flow body"
          hint="Examination structure, phase timings, follow-up types. The agent reads questions from QUESTIONS TO ASK in the order the server hands over."
        >
          <textarea
            name="flow_body"
            defaultValue={persona.flow_body}
            required
            rows={18}
            className="w-full border border-rule rounded px-3 py-2 text-xs font-mono leading-relaxed"
          />
        </Field>

        <SaveRow status={tagStatus(`${ns}:persona`)} label="Save persona" />
      </form>

      {/* Evaluation (eval prompt + rubric) */}
      <EvaluationBlock ns={ns} persona={persona} run={run} tagStatus={tagStatus} />

      {/* Question set */}
      {qset ? (
        <QuestionSetBlock
          ns={ns}
          qset={qset}
          buckets={buckets}
          questionsByBucket={questionsByBucket}
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
    </section>
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
  run,
  tagStatus,
}: {
  ns: string;
  qset: QSet;
  buckets: Bucket[];
  questionsByBucket: Record<string, Question[]>;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const totalQuestions = buckets.reduce(
    (sum, b) => sum + (questionsByBucket[b.id]?.length ?? 0),
    0
  );
  const totalSelected = buckets.reduce((sum, b) => sum + b.select_count, 0);

  return (
    <div className="surface p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-lg">Question set</h3>
        <span className="muted text-xs">
          {buckets.length} bucket{buckets.length === 1 ? "" : "s"} ·{" "}
          {totalQuestions} questions · {totalSelected} asked per session
        </span>
      </div>

      <form
        action={(fd) => run(`${ns}:set`, () => updateQuestionSet(fd))}
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

      <div className="space-y-2">
        <p className="muted text-xs">
          Within-bucket order doesn&apos;t matter — the server picks{" "}
          <code>{bucket.select_count}</code> at random per session.
        </p>
        {questions.map((q) => (
          <QuestionRow
            key={q.id}
            ns={ns}
            question={q}
            run={run}
            tagStatus={tagStatus}
          />
        ))}
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
  return (
    <div className="border border-rule rounded p-3 space-y-2 bg-paper">
      <div className="flex items-start gap-2">
        <form
          action={(fd) => run(`${ns}:q:${question.id}`, () => updateQuestion(fd))}
          className="flex-1 space-y-2"
        >
          <input type="hidden" name="id" value={question.id} />
          <textarea
            name="text"
            defaultValue={question.text}
            required
            rows={3}
            className="w-full border border-rule rounded px-3 py-2 text-sm"
          />
          <input
            name="reference_snippet"
            defaultValue={question.reference_snippet ?? ""}
            placeholder="Optional reference snippet"
            className="w-full border border-rule rounded px-3 py-2 text-xs"
          />
          <div className="flex items-center gap-2">
            <button type="submit" className="btn px-3 py-1.5 text-xs">
              Save
            </button>
            <StatusLine status={tagStatus(`${ns}:q:${question.id}`)} compact />
          </div>
        </form>
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
      </div>
      <StatusLine status={tagStatus(`${ns}:q-del:${question.id}`)} compact />
    </div>
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
