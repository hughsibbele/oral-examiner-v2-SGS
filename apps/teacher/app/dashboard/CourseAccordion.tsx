"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refreshRoster } from "./actions";
import {
  bulkInstallExamCards,
  bulkUninstallExamCards,
} from "./agents/actions";
import type {
  AssignmentWithStatus,
  CourseGroup,
  DefaultAgentOption,
  TeacherTemplateOption,
} from "./dashboard.types";

/**
 * Single-course accordion (M6.18c). Multi-select assignments → the
 * bulk-actions bar carries the agent picker + 3-checkbox destination
 * picker + Install/Reinstall/Uninstall buttons. Per-row affordances are
 * read-only badges + a "Edit template →" / "Swap or customize →" link
 * to the configure page.
 *
 * Open state persists in sessionStorage so revalidatePath remounts don't
 * collapse the accordion the teacher was working in.
 */
function useSessionFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const raw = sessionStorage.getItem(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration read
    if (raw === "1") setValue(true);
    else if (raw === "0") setValue(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is stable per accordion instance
  }, []);
  const setPersistent = (v: boolean) => {
    setValue(v);
    sessionStorage.setItem(key, v ? "1" : "0");
  };
  return [value, setPersistent] as const;
}

export function CourseAccordion({
  group,
  defaultAgents,
  teacherTemplates,
}: {
  group: CourseGroup;
  defaultAgents: DefaultAgentOption[];
  teacherTemplates: TeacherTemplateOption[];
}) {
  const { course, assignments, installedCount, boundCount, roster } = group;
  const [open, setOpen] = useSessionFlag(
    `dashboard:course-${course.canvas_course_id}:open`,
    false,
  );
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) => a.name.toLowerCase().includes(q));
  }, [assignments, search]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  const selectedAssignments = useMemo(
    () => filtered.filter((a) => selectedIds.has(a.canvas_assignment_id)),
    [filtered, selectedIds],
  );

  const isInactive = course.workflow_state !== "available";

  return (
    <section
      className={`rounded border bg-white transition-colors ${
        open ? "border-maroon/30 shadow-sm" : "border-light-blue hover:border-stone-300"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Chevron open={open} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">
              {course.name}
              {isInactive && (
                <span className="ml-2 text-[10px] font-normal uppercase tracking-wide muted">
                  {course.workflow_state}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] muted">
              {course.term?.name ?? "No term"}
              {course.course_code && (
                <>
                  {" · "}
                  <span className="font-mono">{course.course_code}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <span className="muted">
            {assignments.length} assignment{assignments.length === 1 ? "" : "s"}
          </span>
          {installedCount > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
              {installedCount} installed
            </span>
          ) : (
            <span className="muted">none installed</span>
          )}
          {boundCount > 0 && (
            <span
              className="rounded-full bg-maroon/10 px-2 py-0.5 font-medium text-maroon"
              title={`${boundCount} assignment${boundCount === 1 ? "" : "s"} with an agent template configured`}
            >
              {boundCount} configured
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-light-blue">
          {assignments.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm muted">
              No assignments cached for this course yet. Click Refresh above.
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="border-b border-light-blue bg-paper px-4 py-3">
                  <BulkActions
                    canvasCourseId={course.canvas_course_id}
                    selectedIds={Array.from(selectedIds)}
                    selectedAssignments={selectedAssignments}
                    defaultAgents={defaultAgents}
                    teacherTemplates={teacherTemplates}
                    onClearSelection={clearSelection}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 border-b border-light-blue px-4 py-2">
                <input
                  type="search"
                  placeholder="Search assignments…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-[200px] flex-1 rounded border border-light-blue bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
                />
                <span className="text-[11px] muted">
                  {filtered.length === assignments.length
                    ? `${assignments.length} total`
                    : `${filtered.length} of ${assignments.length}`}
                </span>
              </div>

              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm muted">
                  No assignments match &ldquo;{search}&rdquo;.
                </div>
              ) : (
                <ul className="divide-y divide-light-blue">
                  {filtered.map((a) => (
                    <AssignmentRow
                      key={a.canvas_assignment_id}
                      assignment={a}
                      canvasCourseId={course.canvas_course_id}
                      checked={selectedIds.has(a.canvas_assignment_id)}
                      onToggle={() => toggle(a.canvas_assignment_id)}
                    />
                  ))}
                </ul>
              )}

              <RosterFooter
                canvasCourseId={course.canvas_course_id}
                roster={roster}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AssignmentRow({
  assignment,
  canvasCourseId,
  checked,
  onToggle,
}: {
  assignment: AssignmentWithStatus;
  canvasCourseId: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const due = formatDue(assignment.due_at ?? null);
  const installed = assignment.cardInstalled;
  const hubHref = `/dashboard/courses/${canvasCourseId}/assignments/${assignment.canvas_assignment_id}`;
  const editHref =
    assignment.binding?.kind === "template"
      ? `/dashboard/agents/templates/${assignment.binding.template_id}/edit`
      : hubHref;

  const destChars: { char: string; active: boolean; label: string }[] = [
    { char: "D", active: assignment.destination.drive, label: "Drive doc" },
    {
      char: "C",
      active: assignment.destination.comment,
      label: "Canvas draft comment",
    },
    {
      char: "S",
      active: assignment.destination.submission,
      label: "Canvas submission",
    },
  ];

  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-paper">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          <Link href={hubHref} className="no-underline text-ink hover:text-maroon">
            {assignment.name}
          </Link>
          {assignment.workflow_state && assignment.workflow_state !== "published" && (
            <span className="ml-2 text-[10px] font-normal uppercase tracking-wide muted">
              {assignment.workflow_state}
            </span>
          )}
        </div>
        <div className="text-[11px] muted">
          {due}
          {assignment.points_possible != null && <> · {assignment.points_possible} pts</>}
          {assignment.binding && (
            <>
              {" · "}
              <Link href={editHref} className="text-maroon no-underline hover:underline">
                {assignment.binding.kind === "preset"
                  ? `Default ${assignment.binding.preset_name}`
                  : `${assignment.binding.template_name}${
                      assignment.binding.preset_name
                        ? ` (based on ${assignment.binding.preset_name})`
                        : ""
                    }${
                      assignment.binding.override_count > 0
                        ? ` · ${assignment.binding.override_count} override${assignment.binding.override_count === 1 ? "" : "s"}`
                        : ""
                    }`}
              </Link>
            </>
          )}
          {assignment.binding && (
            <span
              className="ml-2 inline-flex gap-0.5 font-mono text-[10px]"
              title="D = Drive doc · C = Canvas draft comment · S = Canvas submission"
            >
              {destChars.map((d) => (
                <span
                  key={d.char}
                  className={
                    d.active
                      ? "rounded bg-maroon/15 px-1 text-maroon"
                      : "rounded bg-stone-100 px-1 text-stone-400"
                  }
                  title={`${d.label}: ${d.active ? "on" : "off"}`}
                >
                  {d.char}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {installed ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
            Card installed
          </span>
        ) : (
          <span className="text-[11px] muted">Not installed</span>
        )}
        {installed && assignment.binding && (
          <Link
            href={editHref}
            className="rounded border border-maroon/40 px-2.5 py-1 text-[11px] font-medium text-maroon no-underline hover:bg-maroon hover:text-white"
          >
            {assignment.binding.kind === "template"
              ? "Edit template →"
              : "Swap or customize →"}
          </Link>
        )}
      </div>
    </li>
  );
}

function BulkActions({
  canvasCourseId,
  selectedIds,
  selectedAssignments,
  defaultAgents,
  teacherTemplates,
  onClearSelection,
}: {
  canvasCourseId: string;
  selectedIds: string[];
  selectedAssignments: AssignmentWithStatus[];
  defaultAgents: DefaultAgentOption[];
  teacherTemplates: TeacherTemplateOption[];
  onClearSelection: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Initial agent pick: if every selected row already has the same binding,
  // start with that. Otherwise default to the first system preset.
  const initialAgent = useMemo<
    { kind: "preset"; id: string } | { kind: "template"; id: string }
  >(() => {
    const bindings = selectedAssignments
      .map((a) => a.binding)
      .filter((b): b is NonNullable<typeof b> => b !== null);
    if (bindings.length === selectedAssignments.length && bindings.length > 0) {
      const first = bindings[0]!;
      const allSame = bindings.every((b) =>
        b.kind === first.kind &&
        (b.kind === "preset"
          ? (first as typeof b).preset_id === b.preset_id
          : (first as typeof b).template_id === b.template_id),
      );
      if (allSame) {
        return first.kind === "preset"
          ? { kind: "preset", id: first.preset_id }
          : { kind: "template", id: first.template_id };
      }
    }
    return defaultAgents[0]
      ? { kind: "preset", id: defaultAgents[0].id }
      : teacherTemplates[0]
        ? { kind: "template", id: teacherTemplates[0].id }
        : { kind: "preset", id: "" };
  }, [selectedAssignments, defaultAgents, teacherTemplates]);

  const [agent, setAgent] = useState(initialAgent);
  const agentKey =
    agent.kind === "preset" ? `preset:${agent.id}` : `template:${agent.id}`;

  // Initial destination: honor the first selected row's persisted state
  // ONLY when that row has actually been installed before — otherwise show
  // the M6.18c defaults (Drive ✓ + comment ✓ + submission ✗). For OE the
  // binding cascades on uninstall, so a row with `cardInstalled=false` has
  // no binding and `destination` is the column defaults — falling through
  // to defaults gives the right initial state.
  const first = selectedAssignments[0];
  const useSaved = first?.cardInstalled ?? false;
  const [postToDrive, setPostToDrive] = useState(
    useSaved ? first?.destination.drive ?? true : true,
  );
  const [postToComment, setPostToComment] = useState(
    useSaved ? first?.destination.comment ?? true : true,
  );
  const [postToSubmission, setPostToSubmission] = useState(
    useSaved ? first?.destination.submission ?? false : false,
  );

  const someInstalled = selectedAssignments.some((a) => a.cardInstalled);

  function run(op: "install" | "uninstall") {
    setError(null);
    startTransition(async () => {
      if (op === "uninstall") {
        if (
          !window.confirm(
            `Uninstall the card from ${selectedIds.length} assignment${selectedIds.length === 1 ? "" : "s"}? The agent binding gets pulled too — cards and agents are paired.`,
          )
        )
          return;
        const r = await bulkUninstallExamCards({
          canvasCourseId,
          canvasAssignmentIds: selectedIds,
        });
        if (r.failureCount === 0) onClearSelection();
        else
          setError(
            `${r.successCount} succeeded, ${r.failureCount} failed${firstError(r.results)}`,
          );
        router.refresh();
        return;
      }

      if (!agent.id) {
        setError("Pick an agent.");
        return;
      }
      const r = await bulkInstallExamCards({
        canvasCourseId,
        canvasAssignmentIds: selectedIds,
        agent,
        destination: {
          drive: postToDrive,
          comment: postToComment,
          submission: postToSubmission,
        },
      });
      if (r.failureCount === 0) onClearSelection();
      else
        setError(
          `${r.successCount} succeeded, ${r.failureCount} failed${firstError(r.results)}`,
        );
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-ink">
          {selectedIds.length} selected
        </span>

        <label className="inline-flex items-center gap-1.5 text-ink">
          <span className="text-[11px] uppercase tracking-wide muted">Agent</span>
          <select
            value={agentKey}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":") as [
                "preset" | "template",
                string,
              ];
              setAgent({ kind, id });
            }}
            disabled={pending}
            className="rounded border border-light-blue bg-white px-2 py-1 text-xs"
          >
            {defaultAgents.length > 0 && (
              <optgroup label="Default agents">
                {defaultAgents.map((d) => (
                  <option key={`preset:${d.id}`} value={`preset:${d.id}`}>
                    Default {d.name}
                  </option>
                ))}
              </optgroup>
            )}
            {teacherTemplates.length > 0 && (
              <optgroup label="Your custom templates">
                {teacherTemplates.map((t) => (
                  <option key={`template:${t.id}`} value={`template:${t.id}`}>
                    {t.name}
                    {t.presetName ? ` (based on ${t.presetName})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <fieldset className="inline-flex items-center gap-3 text-ink">
          <legend className="text-[11px] uppercase tracking-wide muted">
            Exam artifacts submitted to:
          </legend>
          <DestinationCheckbox
            label="Drive"
            checked={postToDrive}
            onChange={setPostToDrive}
            disabled={pending}
            title="Save the transcript + summary + evaluation to a Google Doc in your Drive. Writer ships with M7.4."
          />
          <DestinationCheckbox
            label="Canvas as draft comment"
            checked={postToComment}
            onChange={setPostToComment}
            disabled={pending}
            title="Post a draft comment in SpeedGrader containing the eval + summary + Drive doc link."
          />
          <DestinationCheckbox
            label="Canvas as submission"
            checked={postToSubmission}
            onChange={setPostToSubmission}
            disabled={pending}
            title="Post the artifacts as the student's submission body. Rare for orals — opt-in only."
          />
        </fieldset>

        <button
          type="button"
          onClick={onClearSelection}
          disabled={pending}
          className="rounded px-2 py-1 muted hover:bg-stone-100 disabled:opacity-50"
        >
          Cancel
        </button>
        {someInstalled && (
          <button
            type="button"
            onClick={() => run("uninstall")}
            disabled={pending}
            className="rounded border border-light-blue px-3 py-1 font-semibold text-ink hover:bg-stone-100 disabled:opacity-50"
          >
            {pending ? "Working…" : "Uninstall"}
          </button>
        )}
        <button
          type="button"
          onClick={() => run("install")}
          disabled={
            pending ||
            !agent.id ||
            (!postToDrive && !postToComment && !postToSubmission)
          }
          className="rounded bg-maroon px-3 py-1 font-semibold text-white hover:bg-maroon/90 disabled:opacity-50"
          title={
            !postToDrive && !postToComment && !postToSubmission
              ? "Pick at least one destination."
              : undefined
          }
        >
          {pending
            ? "Installing…"
            : someInstalled
              ? "Reinstall"
              : "Install card"}
        </button>
      </div>

      <p className="italic muted">
        {describeDestination({
          drive: postToDrive,
          comment: postToComment,
          submission: postToSubmission,
        })}
      </p>

      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}

function DestinationCheckbox({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-light-blue accent-maroon disabled:opacity-50"
      />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function describeDestination(d: {
  drive: boolean;
  comment: boolean;
  submission: boolean;
}): string {
  const targets: string[] = [];
  if (d.drive) targets.push("a Google Doc in your Drive folder");
  if (d.comment) targets.push("a Canvas draft comment");
  if (d.submission) targets.push("the student's Canvas submission body");
  if (targets.length === 0) {
    return "Nothing checked — artifacts won't be saved anywhere. Pick at least one destination.";
  }
  if (targets.length === 1) {
    return `Exam artifacts will be saved to ${targets[0]}.`;
  }
  if (targets.length === 2) {
    return `Exam artifacts will be saved to ${targets[0]} and ${targets[1]}.`;
  }
  return `Exam artifacts will be saved to ${targets[0]}, ${targets[1]}, and ${targets[2]}.`;
}

function firstError(
  results: { ok: boolean; message?: string }[],
): string {
  const failure = results.find((r) => !r.ok);
  return failure?.message ? ` — first error: ${failure.message}` : "";
}

function RosterFooter({
  canvasCourseId,
  roster,
}: {
  canvasCourseId: string;
  roster: CourseGroup["roster"];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      const r = await refreshRoster(canvasCourseId);
      if (r.ok) {
        setMsg(
          `${r.students} student${r.students === 1 ? "" : "s"} synced` +
            (r.skipped ? ` · ${r.skipped} skipped (no email)` : ""),
        );
        router.refresh();
      } else {
        setMsg(`Error: ${r.error}`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-light-blue bg-paper px-4 py-2 text-[11px]">
      <span className="muted">
        Roster:{" "}
        {roster.studentCount === 0
          ? "not synced yet"
          : `${roster.studentCount} student${roster.studentCount === 1 ? "" : "s"}`}
        {roster.lastSyncedAt && (
          <> · last synced {new Date(roster.lastSyncedAt).toLocaleDateString()}</>
        )}
      </span>
      <div className="flex items-baseline gap-2">
        {msg && <span className="muted">{msg}</span>}
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded border border-light-blue bg-white px-2.5 py-1 text-[11px] text-ink hover:border-maroon hover:text-maroon disabled:opacity-50"
        >
          {pending ? "Syncing…" : "Refresh roster"}
        </button>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 20 20"
      className={`shrink-0 muted transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatDue(due: string | null): string {
  if (!due) return "No due date";
  const d = new Date(due);
  return `Due ${d.toLocaleDateString()}`;
}
