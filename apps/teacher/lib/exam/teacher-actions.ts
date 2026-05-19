// M2b.5c.5 — teacher-side affordances for managing student exam sessions.

"use server";

import { revalidatePath } from "next/cache";
import { getTeacher } from "@/lib/auth/teacher";
import { createAdminClient } from "@/lib/supabase/admin";
import { archiveSession } from "./session";

/**
 * Manually archive a student's session so they can retake the exam. Soft-
 * delete (state='excluded' + excluded_reason='teacher_reset'); never hard-
 * deletes — preserves the audit trail.
 *
 * Defense in depth: re-verifies that the session belongs to a Canvas
 * assignment this teacher owns (i.e., one in their canvas_assignment_cache).
 * RLS doesn't gate this path because the service-role admin client bypasses
 * it; the ownership check is the substitute.
 */
export async function resetExamSession(formData: FormData): Promise<void> {
  const sessionId = formData.get("session_id");
  const canvasCourseId = formData.get("canvas_course_id");
  const canvasAssignmentId = formData.get("canvas_assignment_id");
  if (
    typeof sessionId !== "string" ||
    typeof canvasCourseId !== "string" ||
    typeof canvasAssignmentId !== "string"
  ) {
    throw new Error("resetExamSession: missing form fields");
  }

  const auth = await getTeacher();
  if (!auth) throw new Error("resetExamSession: not signed in");

  const admin = createAdminClient();

  const [{ data: ownership }, { data: sessionRow }] = await Promise.all([
    admin
      .from("canvas_assignment_cache")
      .select("canvas_assignment_id")
      .eq("teacher_id", auth.teacher.id)
      .eq("canvas_assignment_id", canvasAssignmentId)
      .maybeSingle(),
    admin
      .from("exam_sessions")
      .select("id, canvas_assignment_id, state")
      .eq("id", sessionId)
      .maybeSingle(),
  ]);

  if (!ownership) {
    throw new Error(
      "resetExamSession: assignment not owned by this teacher (run Refresh assignments?)",
    );
  }
  if (!sessionRow) {
    throw new Error("resetExamSession: session not found");
  }
  if (sessionRow.canvas_assignment_id !== canvasAssignmentId) {
    throw new Error(
      "resetExamSession: session/assignment mismatch (suspected stale UI)",
    );
  }
  if (sessionRow.state === "excluded") {
    // Already archived — idempotent no-op; reasonable to surface as success.
    revalidatePath(
      `/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
    );
    return;
  }

  await archiveSession(sessionId, "teacher_reset");
  revalidatePath(
    `/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
  );
}
