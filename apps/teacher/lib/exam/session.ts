// M2b.5c.3 — prior-session lookup + soft-archive helpers.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@oral-examiner/db";

export const SHORT_ATTEMPT_THRESHOLD_SEC = 60;

type ExamSessionState = Database["public"]["Enums"]["exam_session_state"];

export type PriorSession = {
  id: string;
  state: ExamSessionState;
  call_duration_sec: number | null;
  completed_at: string | null;
  created_at: string;
};

/**
 * Return the one non-excluded session for (canvas_assignment_id, student),
 * or null if there isn't one. The partial unique index
 * exam_sessions_assignment_student_live_uniq guarantees at most one row.
 *
 * Service-role: cross-row student reads on exam_sessions have no RLS
 * path post the recursion-fix migration.
 */
export async function findActivePriorSession({
  canvasAssignmentId,
  studentId,
}: {
  canvasAssignmentId: string;
  studentId: string;
}): Promise<PriorSession | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("exam_sessions")
    .select("id, state, call_duration_sec, completed_at, created_at")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .eq("student_id", studentId)
    .neq("state", "excluded")
    .maybeSingle();

  if (error) {
    throw new Error(`Existing-session lookup failed: ${error.message}`);
  }
  return (data as PriorSession | null) ?? null;
}

type ArchiveReason =
  | "short_attempt_auto"
  | "abandoned_resume"
  | "teacher_reset"
  | "failed_eval";

/**
 * Soft-archive a session row by flipping state→excluded with a reason.
 */
export async function archiveSession(
  sessionId: string,
  reason: ArchiveReason,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("exam_sessions")
    .update({ state: "excluded", excluded_reason: reason })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`Failed to archive session ${sessionId}: ${error.message}`);
  }
}

export type PriorSessionVerdict =
  | "fresh"
  | "completion_blocked"
  | "short_attempt"
  | "live_session"
  | "failed_prior"
  | "scheduled_orphan";

/**
 * Classify a prior session for the /exam/[token] page handler.
 *
 *   - null                                              → "fresh"
 *   - state='completed' AND call_duration_sec >= 60     → "completion_blocked"
 *   - state='completed' AND call_duration_sec <  60     → "short_attempt"
 *   - state IN ('started','in_progress')                → "live_session"
 *   - state='failed'                                    → "failed_prior"
 *   - state='scheduled'                                 → "scheduled_orphan"
 */
export function classifyPriorSession(
  prior: PriorSession | null,
): PriorSessionVerdict {
  if (!prior) return "fresh";
  if (prior.state === "completed") {
    return (prior.call_duration_sec ?? 0) >= SHORT_ATTEMPT_THRESHOLD_SEC
      ? "completion_blocked"
      : "short_attempt";
  }
  if (prior.state === "started" || prior.state === "in_progress") {
    return "live_session";
  }
  if (prior.state === "failed") return "failed_prior";
  if (prior.state === "scheduled") return "scheduled_orphan";
  return "fresh";
}

export function archiveReasonFor(
  verdict: PriorSessionVerdict,
): ArchiveReason | null {
  if (verdict === "short_attempt") return "short_attempt_auto";
  if (verdict === "failed_prior") return "failed_eval";
  if (verdict === "scheduled_orphan") return "abandoned_resume";
  return null;
}
