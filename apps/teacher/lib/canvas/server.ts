import { decryptSecret, readKeyFromEnv } from "@oral-examiner/crypto";
import type { CanvasConfig } from "@oral-examiner/canvas";
import { getTeacher } from "@/lib/auth/teacher";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve a CanvasConfig for the currently-authed teacher.
 * Returns null if the teacher hasn't pasted a token yet, OR if the stored
 * token can't be decrypted (key rotated / corruption — surfaces as
 * "reconnect Canvas").
 */
export async function getCanvasConfigForTeacher(): Promise<{
  config: CanvasConfig;
  teacherId: string;
} | null> {
  const result = await getTeacher();
  if (!result) return null;

  const { teacher } = result;
  if (!teacher.canvas_token_encrypted || !teacher.canvas_host) return null;

  try {
    const token = decryptSecret(teacher.canvas_token_encrypted, readKeyFromEnv());
    return {
      config: { host: teacher.canvas_host, token },
      teacherId: teacher.id,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a CanvasConfig for a teacher by id, bypassing auth context.
 * Used in student-context routes (e.g. /api/exam/auth-token) where the
 * signed-in user is the student but we need to act as the binding's
 * teacher to fetch a student's submission. Returns null on missing
 * config or decryption failure — caller should treat as "no Canvas
 * context available" and fail open.
 */
export async function getCanvasConfigByTeacherId(
  teacherId: string,
): Promise<CanvasConfig | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("teachers")
    .select("canvas_host, canvas_token_encrypted")
    .eq("id", teacherId)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.canvas_host || !data.canvas_token_encrypted) return null;
  try {
    const token = decryptSecret(data.canvas_token_encrypted, readKeyFromEnv());
    return { host: data.canvas_host, token };
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth check (M2b.5b.11.a). Returns null when this teacher
 * has a cached assignment row for the given Canvas IDs, indicating the
 * assignment is in a course they teach. Otherwise returns a user-friendly
 * error string.
 *
 * Rationale: Canvas's API rejects writes to assignments outside the
 * authed user's permissions, so a malicious caller can't actually
 * push content. But the OE binding tables (`exam_template_bindings`,
 * `canvas_assignment_cache`) are written via the admin (service-role)
 * client to bypass RLS — without this check, a teacher could pollute
 * their own cache with stale bindings for assignment ids they don't own.
 * The Canvas refresh sweeps don't clean those up because they're keyed
 * by id, not by current-course-membership.
 *
 * Returns the resolved course id alongside the cached row, which install
 * paths can use to detect drift between the caller-supplied course id
 * and what's actually in the cache.
 */
export async function ensureTeacherOwnsAssignment(
  teacherId: string,
  canvasAssignmentId: string,
): Promise<
  | { ok: true; canvasCourseId: string }
  | { ok: false; error: string }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("canvas_assignment_cache")
    .select("canvas_course_id")
    .eq("teacher_id", teacherId)
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (error) {
    return { ok: false, error: `Ownership check failed: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      error:
        "This assignment isn't in your synced cache. Run Refresh assignments from your dashboard and try again — defense-in-depth check.",
    };
  }
  return { ok: true, canvasCourseId: data.canvas_course_id as string };
}
