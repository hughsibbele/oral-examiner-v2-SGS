"use client";

import { useState, useTransition } from "react";
import {
  type ActionResult,
  createBucket,
  createQuestion,
  deleteBucket,
  deleteQuestion,
  moveBucket,
  moveQuestion,
  updateBucket,
  updateQuestion,
  updateQuestionSet,
} from "../actions";

type QSet = {
  id: string;
  name: string;
  description: string | null;
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

type Status =
  | { kind: "idle" }
  | { kind: "saving"; tag: string }
  | { kind: "saved"; tag: string }
  | { kind: "error"; tag: string; msg: string };

export function QuestionSetEditor({
  qset,
  buckets,
  questionsByBucket,
}: {
  qset: QSet;
  buckets: Bucket[];
  questionsByBucket: Record<string, Question[]>;
}) {
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

  const tagStatus = (tag: string) => {
    if (status.kind === "saving" && status.tag === tag) return "saving";
    if (status.kind === "saved" && status.tag === tag) return "saved";
    if (status.kind === "error" && status.tag === tag) return status.msg;
    return null;
  };

  return (
    <div className="space-y-8">
      {/* Set details */}
      <form
        action={(fd) => run("set", () => updateQuestionSet(fd))}
        className="surface p-5 space-y-3"
      >
        <input type="hidden" name="id" value={qset.id} />
        <h2 className="heading text-lg">Set details</h2>
        <Field label="Name">
          <input
            name="name"
            defaultValue={qset.name}
            required
            className="w-full border border-rule rounded px-3 py-2 text-sm font-medium"
          />
        </Field>
        <Field label="Description">
          <input
            name="description"
            defaultValue={qset.description ?? ""}
            className="w-full border border-rule rounded px-3 py-2 text-sm"
          />
        </Field>
        <SaveRow status={tagStatus("set")} label="Save set" />
      </form>

      {/* Buckets */}
      <div className="space-y-6">
        {buckets.map((b, i) => (
          <BucketCard
            key={b.id}
            bucket={b}
            questions={questionsByBucket[b.id] ?? []}
            isFirst={i === 0}
            isLast={i === buckets.length - 1}
            run={run}
            tagStatus={tagStatus}
          />
        ))}

        {buckets.length === 0 && (
          <p className="muted text-sm">No buckets yet. Add one below.</p>
        )}
      </div>

      {/* Add bucket */}
      <form
        action={(fd) => run("add-bucket", () => createBucket(fd))}
        className="surface p-5 space-y-3"
      >
        <input type="hidden" name="question_set_id" value={qset.id} />
        <h2 className="heading text-lg">Add bucket</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field label="Name" hint="e.g. process, content, recall">
              <input
                name="name"
                required
                placeholder="bucket-name"
                className="w-full border border-rule rounded px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <Field label="Select count" hint="Questions to pick at random per session">
            <input
              name="select_count"
              type="number"
              min={0}
              defaultValue={1}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <SaveRow status={tagStatus("add-bucket")} label="Add bucket" />
      </form>
    </div>
  );
}

function BucketCard({
  bucket,
  questions,
  isFirst,
  isLast,
  run,
  tagStatus,
}: {
  bucket: Bucket;
  questions: Question[];
  isFirst: boolean;
  isLast: boolean;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  return (
    <section className="surface p-5 space-y-4">
      {/* Bucket header (rename + select_count + move/delete) */}
      <div className="flex items-end gap-3 flex-wrap">
        <form
          action={(fd) => run(`bucket-${bucket.id}`, () => updateBucket(fd))}
          className="flex items-end gap-3 flex-1 min-w-[260px]"
        >
          <input type="hidden" name="id" value={bucket.id} />
          <input type="hidden" name="question_set_id" value={bucket.question_set_id} />
          <div className="flex-1">
            <label className="block text-xs muted mb-1">Bucket name</label>
            <input
              name="name"
              defaultValue={bucket.name}
              required
              className="w-full border border-rule rounded px-3 py-2 text-sm font-medium font-mono"
            />
          </div>
          <div className="w-28">
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
              run(`move-bucket-${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                fd.set("question_set_id", bucket.question_set_id);
                fd.set("direction", "up");
                return moveBucket(fd);
              })
            }
            label="↑"
            title="Move up"
          />
          <MoveButton
            disabled={isLast}
            onClick={() =>
              run(`move-bucket-${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                fd.set("question_set_id", bucket.question_set_id);
                fd.set("direction", "down");
                return moveBucket(fd);
              })
            }
            label="↓"
            title="Move down"
          />
          <DeleteButton
            label="Delete bucket"
            confirm={`Delete bucket "${bucket.name}" and all ${questions.length} of its questions? This cannot be undone.`}
            onConfirm={() =>
              run(`delete-bucket-${bucket.id}`, () => {
                const fd = new FormData();
                fd.set("id", bucket.id);
                fd.set("question_set_id", bucket.question_set_id);
                return deleteBucket(fd);
              })
            }
          />
        </div>
      </div>
      <StatusLine status={tagStatus(`bucket-${bucket.id}`)} />
      <StatusLine status={tagStatus(`move-bucket-${bucket.id}`)} />
      <StatusLine status={tagStatus(`delete-bucket-${bucket.id}`)} />

      {/* Questions */}
      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionRow
            key={q.id}
            question={q}
            setId={bucket.question_set_id}
            isFirst={i === 0}
            isLast={i === questions.length - 1}
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
          run(`add-q-${bucket.id}`, async () => {
            const r = await createQuestion(fd);
            if (r.ok) {
              // Clear the textarea on success — server action triggers a refresh
              // via revalidatePath, but the controlled-ish form state needs help.
              const form = document.querySelector<HTMLFormElement>(
                `form[data-add-q="${bucket.id}"]`
              );
              form?.reset();
            }
            return r;
          })
        }
        data-add-q={bucket.id}
        className="border-t border-rule pt-3 space-y-2"
      >
        <input type="hidden" name="question_bucket_id" value={bucket.id} />
        <input type="hidden" name="question_set_id" value={bucket.question_set_id} />
        <label className="block text-xs muted">Add question to this bucket</label>
        <textarea
          name="text"
          required
          rows={2}
          placeholder="Question text…"
          className="w-full border border-rule rounded px-3 py-2 text-sm"
        />
        <SaveRow status={tagStatus(`add-q-${bucket.id}`)} label="Add question" />
      </form>
    </section>
  );
}

function QuestionRow({
  question,
  setId,
  isFirst,
  isLast,
  run,
  tagStatus,
}: {
  question: Question;
  setId: string;
  isFirst: boolean;
  isLast: boolean;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  return (
    <div className="border border-rule rounded p-3 space-y-2 bg-paper">
      <div className="flex items-start gap-2">
        <div className="muted text-xs font-mono pt-2 w-8 text-right">
          {question.position + 1}.
        </div>
        <form
          action={(fd) => run(`q-${question.id}`, () => updateQuestion(fd))}
          className="flex-1 space-y-2"
        >
          <input type="hidden" name="id" value={question.id} />
          <input type="hidden" name="question_set_id" value={setId} />
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
            placeholder="Optional reference snippet (anchor text for the question)"
            className="w-full border border-rule rounded px-3 py-2 text-xs"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="submit" className="btn px-3 py-1.5 text-xs">
              Save
            </button>
            <StatusLine status={tagStatus(`q-${question.id}`)} compact />
          </div>
        </form>
        <div className="flex flex-col items-center gap-1">
          <MoveButton
            disabled={isFirst}
            onClick={() =>
              run(`move-q-${question.id}`, () => {
                const fd = new FormData();
                fd.set("id", question.id);
                fd.set("question_bucket_id", question.question_bucket_id);
                fd.set("question_set_id", setId);
                fd.set("direction", "up");
                return moveQuestion(fd);
              })
            }
            label="↑"
            title="Move up"
          />
          <MoveButton
            disabled={isLast}
            onClick={() =>
              run(`move-q-${question.id}`, () => {
                const fd = new FormData();
                fd.set("id", question.id);
                fd.set("question_bucket_id", question.question_bucket_id);
                fd.set("question_set_id", setId);
                fd.set("direction", "down");
                return moveQuestion(fd);
              })
            }
            label="↓"
            title="Move down"
          />
          <DeleteButton
            label="×"
            title="Delete question"
            confirm="Delete this question? This cannot be undone."
            onConfirm={() =>
              run(`delete-q-${question.id}`, () => {
                const fd = new FormData();
                fd.set("id", question.id);
                fd.set("question_set_id", setId);
                return deleteQuestion(fd);
              })
            }
          />
        </div>
      </div>
      <StatusLine status={tagStatus(`move-q-${question.id}`)} compact />
      <StatusLine status={tagStatus(`delete-q-${question.id}`)} compact />
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

function SaveRow({ status, label }: { status: string | null; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="submit" className="btn bg-maroon text-white px-4 py-2 text-sm">
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
