"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  installOralExamCard,
  refreshRoster,
  uninstallOralExamCard,
} from "./actions";
import { InstallWithAgentDialog } from "./InstallWithAgentDialog";
import type {
  AssignmentWithStatus,
  CourseGroup,
  DefaultAgentOption,
  TeacherTemplateOption,
} from "./dashboard.types";

/**
 * Single-course accordion. Mirrors AI Documenter's `CourseAccordion` shape
 * with OE-specific affordances:
 *   - Per-assignment Install / Uninstall card button (idempotent splice
 *     into the Canvas assignment description's marker block).
 *   - Per-assignment "Customize →" link to the M2b.5b template editor.
 *   - Per-course "Refresh roster" — OE needs the roster before students
 *     can sign in via /exam/<token>.
 *
 * Open state persists in sessionStorage so revalidatePath remounts don't
 * collapse the accordion the teacher was working in.
 */
/**
 * Boolean persisted in sessionStorage so the accordion doesn't snap shut on
 * revalidatePath remounts. Reads the saved value on mount; first paint
 * matches SSR (`initial`) then briefly transitions to the saved state.
 *
 * The setState-in-effect is intentional: it's a one-time SSR-deferred read,
 * not a cascading render. The lint rule flags this pattern in general but
 * this is the textbook "read browser-only state after hydration" use case.
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignments;
    return assignments.filter((a) => a.name.toLowerCase().includes(q));
  }, [assignments, search]);

  const isInactive = course.workflow_state !== "available";

  return (
    <section
      className={`rounded border bg-white transition-colors ${
        open ? "border-maroon/30 shadow-sm" : "border-rule hover:border-stone-300"
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
        <div className="border-t border-rule">
          {assignments.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm muted">
              No assignments cached for this course yet. Click Refresh above.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2">
                <input
                  type="search"
                  placeholder="Search assignments…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-[200px] flex-1 rounded border border-rule bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon"
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
                <ul className="divide-y divide-rule">
                  {filtered.map((a) => (
                    <AssignmentRow
                      key={a.canvas_assignment_id}
                      assignment={a}
                      canvasCourseId={course.canvas_course_id}
                      defaultAgents={defaultAgents}
                      teacherTemplates={teacherTemplates}
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
  defaultAgents,
  teacherTemplates,
}: {
  assignment: AssignmentWithStatus;
  canvasCourseId: string;
  defaultAgents: DefaultAgentOption[];
  teacherTemplates: TeacherTemplateOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // No binding yet? Clicking "Install" opens the picker dialog instead of
  // running install directly — every card must have an agent so students
  // who click it land somewhere.
  function onInstall() {
    if (!assignment.binding) {
      setDialogOpen(true);
      return;
    }
    runInstall("install");
  }

  function runInstall(action: "install" | "uninstall") {
    if (action === "uninstall") {
      // Uninstall also drops the agent binding (same invariant: card + agent
      // are paired). Warn explicitly so the teacher isn't surprised.
      if (
        !window.confirm(
          "Uninstall the card? The agent assignment will be removed too — cards and agents are paired.",
        )
      )
        return;
    }
    setError(null);
    startTransition(async () => {
      const fn = action === "install" ? installOralExamCard : uninstallOralExamCard;
      const r = await fn({
        canvasCourseId,
        canvasAssignmentId: assignment.canvas_assignment_id,
      });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  const due = formatDue(assignment.due_at ?? null);
  const installed = assignment.cardInstalled;
  const hubHref = `/dashboard/courses/${canvasCourseId}/assignments/${assignment.canvas_assignment_id}`;
  // "Manage agent →" link routes by binding kind. Preset bindings have no
  // editor (defaults are read-only); send the teacher to the assignment
  // configure page where they can swap or clone-customize. Custom
  // templates deep-link straight to the editor.
  const editHref =
    assignment.binding?.kind === "template"
      ? `/dashboard/agents/templates/${assignment.binding.template_id}/edit`
      : hubHref;

  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-paper">
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
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <InstallBadge
          installed={installed}
          pending={pending}
          onInstall={onInstall}
          onUninstall={() => runInstall("uninstall")}
        />
        {/* Vary the label per binding kind so the destination matches the
            CTA. Preset bindings have no editor — the link goes to the
            assignment configure page where the teacher can swap or
            clone-customize. Custom-template bindings deep-link to the
            editor. Only shown once the card's installed (and so a binding
            exists per the paired invariant). */}
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

      <InstallWithAgentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        canvasCourseId={canvasCourseId}
        canvasAssignmentId={assignment.canvas_assignment_id}
        defaultAgents={defaultAgents}
        teacherTemplates={teacherTemplates}
      />

      {error && (
        <div className="basis-full text-[11px] text-red-700">
          {error}
        </div>
      )}
    </li>
  );
}

function InstallBadge({
  installed,
  pending,
  onInstall,
  onUninstall,
}: {
  installed: boolean;
  pending: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  if (installed) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
          Card installed
        </span>
        <button
          type="button"
          onClick={onUninstall}
          disabled={pending}
          className="text-[10px] muted underline disabled:no-underline"
        >
          {pending ? "Removing…" : "uninstall"}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onInstall}
      disabled={pending}
      className="rounded border border-rule bg-white px-2.5 py-1 text-[11px] text-ink hover:border-maroon hover:text-maroon disabled:opacity-50"
    >
      {pending ? "Installing…" : "Install card"}
    </button>
  );
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-paper px-4 py-2 text-[11px]">
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
          className="rounded border border-rule bg-white px-2.5 py-1 text-[11px] text-ink hover:border-maroon hover:text-maroon disabled:opacity-50"
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
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
