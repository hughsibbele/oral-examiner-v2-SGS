import Link from "next/link";
import { notFound } from "next/navigation";
import { hasExamCardBlock } from "@oral-examiner/canvas";
import { createServerSupabase } from "@/lib/supabase/server";
import { RefreshAssignmentsButton } from "./RefreshAssignmentsButton";
import { RefreshRosterButton } from "./RefreshRosterButton";
import { InstallCardButton } from "./InstallCardButton";

type CoursePayload = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state: string;
};

type AssignmentPayload = {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  workflow_state: string;
};

type AssignmentRow = {
  canvas_assignment_id: string;
  payload: AssignmentPayload;
  last_synced_at: string;
};

type RosterStudent = {
  canvas_user_id: string;
  display_name: string;
  email: string;
  anon_token: string;
};

type RosterRow = {
  students: RosterStudent[];
  last_synced_at: string;
};

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: canvasCourseId } = await params;
  const supabase = await createServerSupabase();

  const { data: courseRow } = await supabase
    .from("canvas_course_cache")
    .select("payload")
    .eq("canvas_course_id", canvasCourseId)
    .maybeSingle();

  if (!courseRow) notFound();
  const course = (courseRow.payload as unknown) as CoursePayload;

  const { data: assignmentRows } = await supabase
    .from("canvas_assignment_cache")
    .select("canvas_assignment_id, payload, last_synced_at")
    .eq("canvas_course_id", canvasCourseId)
    .order("last_synced_at", { ascending: false });

  const assignments = (assignmentRows ?? []) as unknown as AssignmentRow[];

  // Which assignments have an agent assigned? Used to gate the install
  // button — no cards without agents.
  const { data: bindingsData } = await supabase
    .from("exam_template_bindings")
    .select("canvas_assignment_id")
    .eq("canvas_course_id", canvasCourseId);
  const boundAssignmentIds = new Set(
    (bindingsData ?? []).map((b) => b.canvas_assignment_id as string),
  );

  const { data: rosterRow } = await supabase
    .from("course_rosters")
    .select("students, last_synced_at")
    .eq("canvas_course_id", canvasCourseId)
    .maybeSingle();
  const roster = rosterRow as unknown as RosterRow | null;
  const rosterStudents = roster?.students ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="muted text-sm">
          ← Dashboard
        </Link>
        <h1 className="heading text-2xl mt-2">{course.name}</h1>
        <p className="muted text-sm mt-1">
          {course.course_code ?? "—"} · Canvas course {canvasCourseId}
        </p>
      </div>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-lg">Assignments</h2>
          <RefreshAssignmentsButton canvasCourseId={canvasCourseId} />
        </div>

        {assignments.length === 0 ? (
          <p className="text-sm muted">
            No assignments cached yet. Refresh from Canvas to populate.
          </p>
        ) : (
          <ul className="divide-y divide-rule border border-rule rounded">
            {assignments.map((row) => {
              const a = row.payload;
              const due = a.due_at ? new Date(a.due_at).toLocaleDateString() : "—";
              const installed = hasExamCardBlock(
                a.description ?? "",
                row.canvas_assignment_id,
              );
              return (
                <li
                  key={row.canvas_assignment_id}
                  className="p-3 flex items-baseline justify-between gap-4"
                >
                  <div>
                    <Link
                      href={`/dashboard/courses/${canvasCourseId}/assignments/${row.canvas_assignment_id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {a.name}
                    </Link>
                    <div className="muted text-xs mt-0.5">
                      Due {due}
                      {typeof a.points_possible === "number" && ` · ${a.points_possible} pts`}
                      {a.submission_types && a.submission_types.length > 0 && (
                        <> · <code>{a.submission_types.join(", ")}</code></>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <InstallCardButton
                      canvasCourseId={canvasCourseId}
                      canvasAssignmentId={row.canvas_assignment_id}
                      installed={installed}
                      agentAssigned={boundAssignmentIds.has(row.canvas_assignment_id)}
                    />
                    <Link
                      href={`/dashboard/courses/${canvasCourseId}/assignments/${row.canvas_assignment_id}`}
                      className="muted text-xs underline"
                    >
                      Configure agent →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted text-xs mt-3">
          {assignments.length} published assignment{assignments.length === 1 ? "" : "s"}.
          Install paints a branded EHS card into the Canvas assignment description;
          re-install is idempotent and uninstall strips the block cleanly.
        </p>
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-lg">Roster</h2>
          <RefreshRosterButton canvasCourseId={canvasCourseId} />
        </div>

        {rosterStudents.length === 0 ? (
          <p className="text-sm muted">
            No roster synced yet. Refresh from Canvas to populate. Student
            identifiers are anonymized at sync time; raw names never leave
            the teacher&apos;s browser session.
          </p>
        ) : (
          <p className="text-sm muted">
            {rosterStudents.length} student{rosterStudents.length === 1 ? "" : "s"} synced
            {roster?.last_synced_at && (
              <> · last synced {new Date(roster.last_synced_at).toLocaleString()}</>
            )}
            .
          </p>
        )}
      </section>
    </div>
  );
}
