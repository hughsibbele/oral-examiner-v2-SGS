import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasExamCardBlock } from "@oral-examiner/canvas";
import { isActiveTerm } from "@/lib/sync/active-term";
import { refreshAllCanvas } from "./actions";
import { CourseAccordion } from "./CourseAccordion";
import { RefreshButton, SyncIndicator } from "./RefreshButton";
import { TeacherGuide } from "./TeacherGuide";
import type {
  AgentBindingSummary,
  AssignmentRowDB,
  AssignmentWithStatus,
  CourseGroup,
  CourseRowDB,
  DefaultAgentOption,
  TeacherTemplateOption,
} from "./dashboard.types";

type ExamTemplateRow = {
  id: string;
  name: string;
  personality_preset_id: string | null;
  persona_body: string | null;
  flow_body: string | null;
  opening_text: string | null;
  closing_text: string | null;
  live_voice_name: string | null;
  follow_up_depth: string | null;
  personalization_enabled: boolean | null;
  eval_prompt_body: string | null;
  rubric_body: string | null;
};

type PresetNameRow = { id: string; name: string };

type BindingRow = {
  canvas_assignment_id: string;
  exam_template_id: string | null;
  personality_preset_id: string | null;
  exam_token: string;
  /** M6.18c: persisted destination triple. */
  post_to_drive: boolean;
  post_to_canvas_comment: boolean;
  post_to_canvas_submission: boolean;
};

type RosterCacheRow = {
  canvas_course_id: string;
  students: { canvas_user_id: string }[] | null;
  last_synced_at: string;
};

export default async function DashboardPage() {
  const ctx = await getTeacher();
  const teacher = ctx?.teacher;
  const hasToken = !!teacher?.canvas_token_encrypted;

  if (!hasToken) {
    return <ConnectCanvasPrompt name={teacher?.display_name ?? ""} />;
  }

  const supabase = await createServerSupabase();

  const [
    coursesRes,
    assignmentsRes,
    templatesRes,
    bindingsRes,
    rostersRes,
    defaultsRes,
  ] = await Promise.all([
    supabase
      .from("canvas_course_cache")
      .select("canvas_course_id, payload, last_synced_at, short_name"),
    supabase
      .from("canvas_assignment_cache")
      .select("canvas_assignment_id, canvas_course_id, payload, last_synced_at"),
    supabase
      .from("exam_templates")
      .select(
        "id, name, personality_preset_id, persona_body, flow_body, opening_text, closing_text, live_voice_name, follow_up_depth, personalization_enabled, eval_prompt_body, rubric_body",
      ),
    supabase
      .from("exam_template_bindings")
      .select(
        "canvas_assignment_id, exam_template_id, personality_preset_id, exam_token, post_to_drive, post_to_canvas_comment, post_to_canvas_submission",
      ),
    supabase
      .from("course_rosters")
      .select("canvas_course_id, students, last_synced_at"),
    supabase
      .from("personality_presets")
      .select("id, name, description")
      .is("teacher_id", null)
      .order("name"),
  ]);

  const courseRows = (coursesRes.data ?? []) as unknown as CourseRowDB[];
  const assignmentRows = (assignmentsRes.data ?? []) as unknown as AssignmentRowDB[];
  const templates = (templatesRes.data ?? []) as unknown as ExamTemplateRow[];
  const bindings = (bindingsRes.data ?? []) as unknown as BindingRow[];
  const rosters = (rostersRes.data ?? []) as unknown as RosterCacheRow[];
  const defaultAgents = ((defaultsRes.data ?? []) as { id: string; name: string; description: string | null }[])
    .map((a): DefaultAgentOption => ({ id: a.id, name: a.name, description: a.description }));

  // Preset names for the per-row binding labels. Pull every preset id
  // referenced by either a template or a direct preset binding.
  const presetIds = Array.from(
    new Set([
      ...templates
        .map((t) => t.personality_preset_id)
        .filter((x): x is string => !!x),
      ...bindings
        .map((b) => b.personality_preset_id)
        .filter((x): x is string => !!x),
    ]),
  );
  const presetNamesRes = presetIds.length > 0
    ? await supabase
        .from("personality_presets")
        .select("id, name")
        .in("id", presetIds)
    : { data: [] };
  const presetNameById = new Map<string, string>(
    ((presetNamesRes.data ?? []) as unknown as PresetNameRow[]).map(
      (p) => [p.id, p.name],
    ),
  );

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const bindingByAssignment = new Map<string, AgentBindingSummary>();
  // M6.18c: per-assignment destination state, looked up alongside the
  // binding so the bulk-actions bar can show what's currently saved.
  const destinationByAssignment = new Map<
    string,
    { drive: boolean; comment: boolean; submission: boolean }
  >();
  for (const b of bindings) {
    destinationByAssignment.set(b.canvas_assignment_id, {
      drive: b.post_to_drive,
      comment: b.post_to_canvas_comment,
      submission: b.post_to_canvas_submission,
    });
    if (b.exam_template_id) {
      const t = templateById.get(b.exam_template_id);
      if (!t) continue;
      bindingByAssignment.set(b.canvas_assignment_id, {
        kind: "template",
        template_id: t.id,
        template_name: t.name,
        preset_name: t.personality_preset_id
          ? presetNameById.get(t.personality_preset_id) ?? null
          : null,
        override_count: countOverrides(t),
        exam_token: b.exam_token,
      });
    } else if (b.personality_preset_id) {
      // Render the binding even if the preset name lookup failed (RLS
      // denied, preset got deleted between queries, etc.) — falling
      // through to "continue" would hide an assignment that DOES have an
      // agent assigned, surprising the teacher with a phantom "no agent"
      // state.
      const name =
        presetNameById.get(b.personality_preset_id) ?? "unknown default";
      bindingByAssignment.set(b.canvas_assignment_id, {
        kind: "preset",
        preset_id: b.personality_preset_id,
        preset_name: name,
        exam_token: b.exam_token,
      });
    }
  }

  // Picker options for the install-with-agent dialog. Teacher templates
  // appear in addition to default agents so a previously-customized
  // template is one click away.
  const teacherTemplates: TeacherTemplateOption[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    presetName: t.personality_preset_id
      ? presetNameById.get(t.personality_preset_id) ?? null
      : null,
  }));

  const rosterByCourse = new Map<string, { studentCount: number; lastSyncedAt: string | null }>(
    rosters.map((r) => [
      r.canvas_course_id,
      {
        studentCount: Array.isArray(r.students) ? r.students.length : 0,
        lastSyncedAt: r.last_synced_at,
      },
    ]),
  );

  const groups: CourseGroup[] = courseRows
    .map((row) => {
      const courseAssignments: AssignmentWithStatus[] = assignmentRows
        .filter((a) => a.canvas_course_id === row.canvas_course_id)
        .map((a) => {
          const payload = a.payload;
          return {
            ...payload,
            canvas_assignment_id: a.canvas_assignment_id,
            canvas_course_id: a.canvas_course_id,
            cardInstalled: hasExamCardBlock(
              payload.description ?? "",
              a.canvas_assignment_id,
            ),
            binding:
              bindingByAssignment.get(a.canvas_assignment_id) ?? null,
            destination: destinationByAssignment.get(
              a.canvas_assignment_id,
            ) ?? { drive: true, comment: true, submission: false },
          };
        })
        .sort(byDueDateThenName);

      const installedCount = courseAssignments.filter((a) => a.cardInstalled).length;
      const boundCount = courseAssignments.filter((a) => a.binding).length;

      return {
        course: {
          ...row.payload,
          canvas_course_id: row.canvas_course_id,
          short_name: row.short_name,
        },
        assignments: courseAssignments,
        installedCount,
        boundCount,
        roster:
          rosterByCourse.get(row.canvas_course_id) ?? {
            studentCount: 0,
            lastSyncedAt: null,
          },
      };
    })
    .sort(byActiveStateThenName);

  const activeGroups = groups.filter((g) => isActiveTerm(g.course.term?.name));
  const otherTerm = groups.filter((g) => !isActiveTerm(g.course.term?.name));

  const visibleActive = activeGroups.filter((g) => g.assignments.length > 0);
  const emptyActive = activeGroups.filter((g) => g.assignments.length === 0);

  // Show the most-recent cache write as the global "last synced" time —
  // derived from canvas_course_cache instead of a dedicated teachers
  // column, so we don't proliferate schema for a UX nicety.
  const lastSyncedAt = courseRows.reduce<string | null>((latest, r) => {
    if (!latest) return r.last_synced_at;
    return r.last_synced_at > latest ? r.last_synced_at : latest;
  }, null);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-medium text-ink">Your courses</h1>
          <TeacherGuide />
        </div>
        <form action={refreshFromDashboard} className="flex items-center gap-2">
          <SyncIndicator lastSyncedAt={lastSyncedAt} />
          <RefreshButton />
        </form>
      </div>

      {courseRows.length === 0 ? (
        <FirstSyncPrompt />
      ) : visibleActive.length > 0 ? (
        <div className="space-y-2">
          {visibleActive.map((g) => (
            <CourseAccordion
              key={g.course.canvas_course_id}
              group={g}
              defaultAgents={defaultAgents}
              teacherTemplates={teacherTemplates}
            />
          ))}
        </div>
      ) : (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          No active-term courses with assignments. If you teach a course this
          term, click <strong>Refresh from Canvas</strong> above.
        </div>
      )}

      {(emptyActive.length > 0 || otherTerm.length > 0) && (
        <OtherCoursesSection
          emptyActive={emptyActive}
          otherTerm={otherTerm}
        />
      )}
    </div>
  );
}

async function refreshFromDashboard() {
  "use server";
  await refreshAllCanvas();
}

function OtherCoursesSection({
  emptyActive,
  otherTerm,
}: {
  emptyActive: CourseGroup[];
  otherTerm: CourseGroup[];
}) {
  const total = emptyActive.length + otherTerm.length;
  const byTerm = new Map<string, CourseGroup[]>();
  for (const g of otherTerm) {
    const k = g.course.term?.name ?? "No term";
    if (!byTerm.has(k)) byTerm.set(k, []);
    byTerm.get(k)!.push(g);
  }
  const terms = Array.from(byTerm.entries()).sort(([a], [b]) => b.localeCompare(a));

  return (
    <details className="mt-8 rounded border border-stone-200 bg-stone-50 text-sm">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-ink hover:bg-white">
        <span className="inline-flex items-center gap-2">
          <span className="text-stone-500">▸</span>
          Other courses ({total} course{total === 1 ? "" : "s"})
        </span>
      </summary>
      <div className="space-y-4 border-t border-stone-200 px-4 py-3">
        {emptyActive.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">
              Active term · no assignments yet
            </div>
            <p className="mb-1.5 text-[11px] text-stone-500">
              Hidden by default since there&apos;s nothing to install on. Add an
              assignment in Canvas, then click Refresh.
            </p>
            <ul className="space-y-0.5">
              {emptyActive.map((g) => (
                <li
                  key={g.course.canvas_course_id}
                  className="truncate text-xs text-stone-500"
                >
                  {g.course.course_code && (
                    <span className="mr-1.5 font-semibold text-maroon">
                      {g.course.course_code}
                    </span>
                  )}
                  {g.course.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {terms.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">
              Previous terms
            </div>
            <p className="mb-2 text-[11px] text-stone-500">
              Assignments aren&apos;t synced for these — Refresh skips them to
              save Canvas API budget. Listed here in case you need a quick
              lookup.
            </p>
            <div className="space-y-3">
              {terms.map(([termName, list]) => (
                <div key={termName}>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-500">
                    {termName}
                  </div>
                  <ul className="space-y-0.5">
                    {list.map((g) => (
                      <li
                        key={g.course.canvas_course_id}
                        className="truncate text-xs text-stone-500"
                      >
                        {g.course.name}
                        {g.course.course_code && (
                          <span className="ml-1.5 font-mono text-stone-500">
                            ({g.course.course_code})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function FirstSyncPrompt() {
  return (
    <div className="rounded border border-stone-200 bg-white p-6 text-center text-sm">
      <h2 className="font-medium text-ink text-lg">No courses cached yet</h2>
      <p className="mt-2 text-stone-500">
        Click <strong>Refresh from Canvas</strong> above to pull your
        active-term courses and their assignments.
      </p>
    </div>
  );
}

function ConnectCanvasPrompt({ name }: { name: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink">Welcome{name && `, ${name}`}.</h1>
      </div>
      <div className="bg-white border border-stone-200 rounded p-5">
        <h2 className="font-medium text-ink text-lg mb-2">Connect Canvas</h2>
        <p className="text-sm mb-3">
          OE v2 needs a Canvas API token to read your courses + assignments and
          (eventually) post oral-defense submissions on the student&apos;s
          behalf.
        </p>
        <Link href="/dashboard/canvas" className="inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed">
          Connect Canvas →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function countOverrides(t: ExamTemplateRow): number {
  let n = 0;
  if (t.persona_body !== null) n++;
  if (t.flow_body !== null) n++;
  if (t.opening_text !== null) n++;
  if (t.closing_text !== null) n++;
  if (t.live_voice_name !== null) n++;
  if (t.follow_up_depth !== null) n++;
  if (t.personalization_enabled !== null) n++;
  if (t.eval_prompt_body !== null) n++;
  if (t.rubric_body !== null) n++;
  return n;
}

function byActiveStateThenName(a: CourseGroup, b: CourseGroup): number {
  // Available first, then everything else; within group, alphabetical.
  const aActive = a.course.workflow_state === "available" ? 0 : 1;
  const bActive = b.course.workflow_state === "available" ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;
  return a.course.name.localeCompare(b.course.name);
}

function byDueDateThenName(
  a: AssignmentWithStatus,
  b: AssignmentWithStatus,
): number {
  // Installed assignments float to the top — those are the ones the teacher
  // is actively managing. Within each group: soonest due first; no due date
  // sorts to the bottom of its group.
  const aInstalled = a.cardInstalled ? 0 : 1;
  const bInstalled = b.cardInstalled ? 0 : 1;
  if (aInstalled !== bInstalled) return aInstalled - bInstalled;
  const aDue = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
  const bDue = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return a.name.localeCompare(b.name);
}
