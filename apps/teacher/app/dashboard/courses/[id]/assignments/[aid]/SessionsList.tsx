// M2b.5c.5 — teacher-facing list of exam_sessions for a single Canvas
// assignment, with per-student Reset affordance.

import { createAdminClient } from "@/lib/supabase/admin";
import { resetExamSession } from "@/lib/exam/teacher-actions";

type SessionRow = {
  id: string;
  student_id: string;
  state: string;
  excluded_reason: string | null;
  call_duration_sec: number | null;
  completed_at: string | null;
  created_at: string;
};

type StudentRow = {
  id: string;
  display_name: string;
  email: string;
};

export async function SessionsList({
  canvasCourseId,
  canvasAssignmentId,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
}) {
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("exam_sessions")
    .select(
      "id, student_id, state, excluded_reason, call_duration_sec, completed_at, created_at",
    )
    .eq("canvas_assignment_id", canvasAssignmentId)
    .order("created_at", { ascending: false });

  const sessions = (rows ?? []) as SessionRow[];
  if (sessions.length === 0) {
    return (
      <section className="bg-white border border-stone-200 rounded p-5 space-y-2">
        <h2 className="font-medium text-ink text-lg">Student sessions</h2>
        <p className="text-sm text-stone-500">
          No students have started this exam yet. Sessions show up here once
          students click the Canvas card and start.
        </p>
      </section>
    );
  }

  const studentIds = Array.from(new Set(sessions.map((s) => s.student_id)));
  const { data: studentRows } = await admin
    .from("students")
    .select("id, display_name, email")
    .in("id", studentIds);
  const studentById = new Map(
    ((studentRows ?? []) as StudentRow[]).map((s) => [s.id, s]),
  );

  return (
    <section className="bg-white border border-stone-200 rounded p-5 space-y-3">
      <h2 className="font-medium text-ink text-lg">Student sessions</h2>
      <p className="text-sm text-stone-500">
        Resetting a session lets the student retake the exam. Excluded rows
        stay for the audit trail.
      </p>
      <ul className="divide-y divide-stone-100 text-sm">
        {sessions.map((s) => {
          const student = studentById.get(s.student_id);
          return (
            <li key={s.id} className="py-3 flex items-baseline justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-medium">
                  {student?.display_name ?? "(unknown student)"}
                </div>
                <div className="text-stone-500 text-xs">
                  {formatState(s)} · {formatTime(s)}
                </div>
              </div>
              {s.state !== "excluded" && (
                <form action={resetExamSession}>
                  <input type="hidden" name="session_id" value={s.id} />
                  <input
                    type="hidden"
                    name="canvas_course_id"
                    value={canvasCourseId}
                  />
                  <input
                    type="hidden"
                    name="canvas_assignment_id"
                    value={canvasAssignmentId}
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed text-xs px-3 py-1"
                  >
                    Reset
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatState(s: SessionRow): string {
  if (s.state === "excluded") {
    return `excluded (${s.excluded_reason ?? "no reason"})`;
  }
  if (s.state === "completed") {
    const sec = s.call_duration_sec ?? 0;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `completed (${min}:${remSec.toString().padStart(2, "0")})`;
  }
  return s.state;
}

function formatTime(s: SessionRow): string {
  const iso = s.completed_at ?? s.created_at;
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
