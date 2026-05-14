import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { RefreshAssignmentsButton } from "./RefreshAssignmentsButton";

type CoursePayload = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state: string;
};

type AssignmentPayload = {
  id: number;
  name: string;
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
              return (
                <li
                  key={row.canvas_assignment_id}
                  className="p-3 flex items-baseline justify-between gap-4"
                >
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="muted text-xs mt-0.5">
                      Due {due}
                      {typeof a.points_possible === "number" && ` · ${a.points_possible} pts`}
                      {a.submission_types && a.submission_types.length > 0 && (
                        <> · <code>{a.submission_types.join(", ")}</code></>
                      )}
                    </div>
                  </div>
                  <span className="muted text-xs whitespace-nowrap">
                    Phase 2 install →
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="muted text-xs mt-3">
          {assignments.length} published assignment{assignments.length === 1 ? "" : "s"}.
          Per-template authoring + branded-card install ship in the Phase 2 follow-on.
        </p>
      </section>
    </div>
  );
}
