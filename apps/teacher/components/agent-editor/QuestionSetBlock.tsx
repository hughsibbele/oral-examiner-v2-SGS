"use client";

import {
  type FollowUpDepth,
  estimateDurationMin,
  SOFT_MAX_DURATION_MIN,
} from "@/lib/runtime/flow-parameters";
import {
  DeleteButton,
  Field,
  MoveButton,
  SaveRow,
  StatusLine,
} from "./Primitives";
import {
  type BucketRow,
  type QSetRow,
  type QuestionRow as QuestionRowType,
  type RunAction,
  type ServerFormAction,
  type TagStatus,
} from "./types";

/**
 * Question set block — set metadata + buckets + questions inline editor.
 *
 * Admin actions are passed in via the `actions` bundle so callers (admin
 * vs template editor) can wire their own server actions. In `readOnly`
 * mode (e.g. when a template's linked set is system-seeded and not yet
 * cloned-to-mine), edit affordances are hidden — the block becomes a
 * structured display of the set's contents.
 *
 * Question set picker + clone-to-mine + teacher-owned editing land in
 * M2b.5b.5 / M2b.5b.6. Until then, template mode renders this block in
 * readOnly mode with a link to /admin/agents.
 */
export type QuestionSetActions = {
  updateSet: ServerFormAction;
  createBucket: ServerFormAction;
  updateBucket: ServerFormAction;
  deleteBucket: ServerFormAction;
  moveBucket: ServerFormAction;
  createQuestion: ServerFormAction;
  updateQuestion: ServerFormAction;
  deleteQuestion: ServerFormAction;
};

export function QuestionSetBlock(props: {
  ns: string;
  qset: QSetRow;
  buckets: BucketRow[];
  questionsByBucket: Record<string, QuestionRowType[]>;
  depth: FollowUpDepth;
  readOnly?: boolean;
  actions?: QuestionSetActions;
  run: RunAction;
  tagStatus: TagStatus;
}) {
  const {
    ns,
    qset,
    buckets,
    questionsByBucket,
    depth,
    readOnly,
    actions,
    run,
    tagStatus,
  } = props;

  const totalQuestions = buckets.reduce(
    (sum, b) => sum + (questionsByBucket[b.id]?.length ?? 0),
    0,
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

      {readOnly ? (
        <div className="space-y-1 pb-3 border-b border-rule">
          <p className="text-sm">
            <strong>{qset.name}</strong>
          </p>
          {qset.description && (
            <p className="muted text-xs">{qset.description}</p>
          )}
        </div>
      ) : (
        actions && (
          <form
            action={(fd) => run(`${ns}:set`, () => actions.updateSet(fd))}
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
            <SaveRow
              status={tagStatus(`${ns}:set`)}
              label="Save set details"
              small
            />
          </form>
        )
      )}

      <div className="space-y-5 pt-2">
        {buckets.map((b, i) => (
          <BucketBlock
            key={b.id}
            ns={ns}
            bucket={b}
            questions={questionsByBucket[b.id] ?? []}
            isFirst={i === 0}
            isLast={i === buckets.length - 1}
            readOnly={readOnly}
            actions={actions}
            run={run}
            tagStatus={tagStatus}
          />
        ))}
      </div>

      {/* Add bucket — hidden in readOnly */}
      {!readOnly && actions && (
        <form
          action={(fd) =>
            run(`${ns}:add-bucket`, () => actions.createBucket(fd))
          }
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
            <button
              type="submit"
              className="btn bg-maroon text-white px-3 py-2 text-sm"
            >
              Add
            </button>
          </div>
          <StatusLine status={tagStatus(`${ns}:add-bucket`)} compact />
        </form>
      )}
    </div>
  );
}

function BucketBlock({
  ns,
  bucket,
  questions,
  isFirst,
  isLast,
  readOnly,
  actions,
  run,
  tagStatus,
}: {
  ns: string;
  bucket: BucketRow;
  questions: QuestionRowType[];
  isFirst: boolean;
  isLast: boolean;
  readOnly?: boolean;
  actions?: QuestionSetActions;
  run: RunAction;
  tagStatus: TagStatus;
}) {
  return (
    <div className="border border-rule rounded p-4 space-y-3 bg-white">
      <div className="flex items-end gap-3 flex-wrap">
        {readOnly || !actions ? (
          <div className="flex items-baseline gap-3 flex-1 min-w-[260px]">
            <span className="font-medium text-sm font-mono">{bucket.name}</span>
            <span className="muted text-xs">
              select {bucket.select_count} of {questions.length}
            </span>
          </div>
        ) : (
          <>
            <form
              action={(fd) =>
                run(`${ns}:bucket:${bucket.id}`, () => actions.updateBucket(fd))
              }
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
                    return actions.moveBucket(fd);
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
                    return actions.moveBucket(fd);
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
                    return actions.deleteBucket(fd);
                  })
                }
              />
            </div>
          </>
        )}
      </div>
      {!readOnly && (
        <>
          <StatusLine status={tagStatus(`${ns}:bucket:${bucket.id}`)} compact />
          <StatusLine
            status={tagStatus(`${ns}:bucket-move:${bucket.id}`)}
            compact
          />
          <StatusLine
            status={tagStatus(`${ns}:bucket-del:${bucket.id}`)}
            compact
          />
        </>
      )}

      <div>
        {!readOnly && (
          <p className="muted text-xs mb-1">
            Within-bucket order doesn&apos;t matter — the server picks{" "}
            <code>{bucket.select_count}</code> at random per session.
          </p>
        )}
        <div className="border-t border-rule">
          {questions.map((q) => (
            <QuestionRowItem
              key={q.id}
              ns={ns}
              question={q}
              readOnly={readOnly}
              actions={actions}
              run={run}
              tagStatus={tagStatus}
            />
          ))}
        </div>
        {questions.length === 0 && (
          <p className="muted text-xs">No questions in this bucket yet.</p>
        )}
      </div>

      {/* Add question — hidden in readOnly */}
      {!readOnly && actions && (
        <form
          action={(fd) =>
            run(`${ns}:add-q:${bucket.id}`, async () => {
              const r = await actions.createQuestion(fd);
              if (r.ok) {
                const form = document.querySelector<HTMLFormElement>(
                  `form[data-add-q="${bucket.id}"]`,
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
          <label className="block text-xs muted">
            Add question to this bucket
          </label>
          <textarea
            name="text"
            required
            rows={2}
            placeholder="Question text…"
            className="w-full border border-rule rounded px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn bg-maroon text-white px-3 py-1.5 text-xs"
            >
              Add question
            </button>
            <StatusLine status={tagStatus(`${ns}:add-q:${bucket.id}`)} compact />
          </div>
        </form>
      )}
    </div>
  );
}

function QuestionRowItem({
  ns,
  question,
  readOnly,
  actions,
  run,
  tagStatus,
}: {
  ns: string;
  question: QuestionRowType;
  readOnly?: boolean;
  actions?: QuestionSetActions;
  run: RunAction;
  tagStatus: TagStatus;
}) {
  if (readOnly || !actions) {
    return (
      <div className="py-1.5 border-b border-rule last:border-0 text-sm leading-snug">
        {question.text}
        {question.reference_snippet && (
          <span className="muted text-xs ml-2">
            (ref: {question.reference_snippet})
          </span>
        )}
      </div>
    );
  }
  const status = tagStatus(`${ns}:q:${question.id}`);
  const delStatus = tagStatus(`${ns}:q-del:${question.id}`);
  return (
    <form
      action={(fd) =>
        run(`${ns}:q:${question.id}`, () => actions.updateQuestion(fd))
      }
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
            return actions.deleteQuestion(fd);
          })
        }
      />
      {(status === "saved" ||
        (typeof status === "string" &&
          status !== "saving" &&
          status !== "saved")) && (
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
