"use client";

import { useState } from "react";
import type { QSetRow, RunAction, ServerFormAction, TagStatus } from "./types";

/**
 * Template-mode picker that sits above the QuestionSetBlock. Surfaces:
 *  - which set the template currently uses (system or teacher-owned),
 *  - a select dropdown to switch to any other available set, and
 *  - a "Make my own copy of [current set]" CTA that clones the current set
 *    into a teacher-owned row + cascades buckets/questions + re-links.
 *
 * Editing the questions themselves stays in QuestionSetBlock — this block
 * is purely set-level: pick / clone / switch.
 */
type Props = {
  ns: string;
  templateId: string;
  currentSet: QSetRow | null;
  availableSets: QSetRow[];
  /** How many other templates also link this set. Surfaces in the warning
   *  banner when a teacher-owned set is shared across templates (5b.6 uses
   *  this in the inline editor; the picker just displays it as context). */
  sharedAcrossTemplates: number;
  setQuestionSet: ServerFormAction;
  cloneQuestionSet: ServerFormAction;
  run: RunAction;
  tagStatus: TagStatus;
};

export function QuestionSetPicker({
  ns,
  templateId,
  currentSet,
  availableSets,
  sharedAcrossTemplates,
  setQuestionSet,
  cloneQuestionSet,
  run,
  tagStatus,
}: Props) {
  const [showClone, setShowClone] = useState(false);
  const isTeacherOwned = currentSet?.teacher_id != null;

  const systemSets = availableSets.filter((s) => s.teacher_id == null);
  const teacherSets = availableSets.filter((s) => s.teacher_id != null);

  const switchTag = `${ns}:set-switch`;
  const cloneTag = `${ns}:set-clone`;
  const switchStatus = tagStatus(switchTag);
  const cloneStatus = tagStatus(cloneTag);

  return (
    <section className="bg-white border border-light-blue rounded p-5 space-y-3 border-l-4 border-light-blue">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="heading text-sm">Which questions does this agent ask?</h3>
        <span className="muted text-xs">
          {isTeacherOwned
            ? "Editing your own copy"
            : "Reading from the system default (read-only)"}
        </span>
      </div>

      <form
        action={(fd) => run(switchTag, () => setQuestionSet(fd))}
        className="flex items-end gap-2 flex-wrap"
      >
        <input type="hidden" name="id" value={templateId} />
        <div className="flex-1 min-w-[280px]">
          <label className="block text-xs muted mb-1">Question set</label>
          <select
            name="question_set_id"
            defaultValue={currentSet?.id ?? ""}
            className="w-full border border-light-blue rounded px-3 py-2 text-sm bg-white"
          >
            {!currentSet && <option value="">— pick a set —</option>}
            {systemSets.length > 0 && (
              <optgroup label="System defaults (read-only)">
                {systemSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {teacherSets.length > 0 && (
              <optgroup label="Your custom sets">
                {teacherSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm"
          title="Switch this template to the selected question set"
        >
          {switchStatus === "saving" ? "Switching…" : "Use this set"}
        </button>
        {switchStatus === "saved" && (
          <span className="text-xs text-green-700">Switched.</span>
        )}
        {switchStatus &&
          switchStatus !== "saved" &&
          switchStatus !== "saving" && (
            <span className="text-xs text-red-700">Error: {switchStatus}</span>
          )}
      </form>

      {/* Clone-to-mine — disabled when the template has no current set */}
      {currentSet && (
        <div className="space-y-2">
          {!showClone ? (
            <button
              type="button"
              onClick={() => setShowClone(true)}
              className="inline-flex items-center gap-1.5 rounded font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs"
              title="Make an editable, teacher-owned copy of this set; the template will re-link to your copy."
            >
              Make my own copy of {currentSet.name} →
            </button>
          ) : (
            <form
              action={(fd) =>
                run(cloneTag, async () => {
                  const r = await cloneQuestionSet(fd);
                  if (r.ok) setShowClone(false);
                  return r;
                })
              }
              className="flex items-end gap-2 flex-wrap border border-light-blue rounded p-3 bg-white"
            >
              <input type="hidden" name="id" value={templateId} />
              <div className="flex-1 min-w-[260px]">
                <label className="block text-xs muted mb-1">
                  Name your copy
                </label>
                <input
                  name="name"
                  required
                  defaultValue={`${currentSet.name} (my copy)`}
                  className="w-full border border-light-blue rounded px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm"
              >
                {cloneStatus === "saving" ? "Cloning…" : "Clone & re-link"}
              </button>
              <button
                type="button"
                onClick={() => setShowClone(false)}
                className="inline-flex items-center gap-1.5 rounded font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm"
              >
                Cancel
              </button>
              {cloneStatus &&
                cloneStatus !== "saved" &&
                cloneStatus !== "saving" && (
                  <span className="text-xs text-red-700 basis-full">
                    Error: {cloneStatus}
                  </span>
                )}
            </form>
          )}
        </div>
      )}

      {/* Sharing warning — teacher-owned sets used by multiple templates */}
      {isTeacherOwned && sharedAcrossTemplates > 1 && (
        <div className="border-l-4 border-yellow-500 bg-yellow-50 p-2 text-xs text-yellow-900">
          <strong>Shared across {sharedAcrossTemplates} templates.</strong>{" "}
          Editing this set updates every template using it. To diverge,
          clone it first.
        </div>
      )}
    </section>
  );
}
