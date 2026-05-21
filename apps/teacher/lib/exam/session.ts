// M2b.5c.3 — prior-session lookup + soft-archive helpers.

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@oral-examiner/db";

export const SHORT_ATTEMPT_THRESHOLD_SEC = 60;

// REMEDIATION_PLAN Phase 3: how long to wait before treating a wedged
// started/in_progress row as abandoned. HARD_MAX_MINUTES = 30 (token TTL
// cap on /api/exam/auth-token) + 30 min buffer = 60 min. After this
// window the Live session is provably dead — the ephemeral Gemini token
// has expired, audio frames stopped flowing — so it's safe to archive
// without interrupting a real exam in progress. Generous on purpose;
// tighten later if observability shows the cap is too lax.
export const STALE_SESSION_GRACE_MIN = 60;

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

/**
 * REMEDIATION_PLAN Phase 3: a started/in_progress row whose created_at is
 * past the grace window is presumed abandoned (Live token has long since
 * expired; no further audio can flow). Used by the page-handler auto-
 * archive on re-entry and by the sweep-stale-sessions cron.
 */
export function isStaleLiveSession(prior: PriorSession | null): boolean {
  if (!prior) return false;
  if (prior.state !== "started" && prior.state !== "in_progress") return false;
  const ageMs = Date.now() - new Date(prior.created_at).getTime();
  return ageMs > STALE_SESSION_GRACE_MIN * 60 * 1000;
}

/**
 * Archive a wedged live-session row AND refund any reserved Live minutes.
 * Used by both the page-handler auto-archive (synchronous, when a student
 * re-enters /exam/[id]) and the sweep-stale-sessions cron (batched).
 * Idempotent via the state fence — concurrent callers don't double-archive
 * or double-refund.
 */
export async function refundAndArchiveSession(
  sessionId: string,
  reason: ArchiveReason,
): Promise<{ archived: boolean; refundedMinutes: number }> {
  const admin = createAdminClient();

  // Read the reservation first so we know how much to refund. State-fenced
  // so a row that's already excluded (concurrent sweep) returns null and
  // we no-op.
  const { data: row, error: readErr } = await admin
    .from("exam_sessions")
    .select("live_minutes_used, state")
    .eq("id", sessionId)
    .maybeSingle();
  if (readErr || !row) {
    return { archived: false, refundedMinutes: 0 };
  }
  if (row.state !== "started" && row.state !== "in_progress") {
    return { archived: false, refundedMinutes: 0 };
  }
  const minutes = row.live_minutes_used ?? 0;

  // Phase 2-style state fence: only the first caller actually archives.
  const { data: archivedRows, error: archiveErr } = await admin
    .from("exam_sessions")
    .update({ state: "excluded", excluded_reason: reason })
    .eq("id", sessionId)
    .in("state", ["started", "in_progress"])
    .select("id");
  if (archiveErr) {
    throw new Error(
      `refundAndArchiveSession ${sessionId}: archive failed: ${archiveErr.message}`,
    );
  }
  if (!archivedRows || archivedRows.length === 0) {
    // Another caller beat us to it. Don't refund — they will.
    return { archived: false, refundedMinutes: 0 };
  }

  if (minutes > 0) {
    const { error: refundErr } = await admin.rpc(
      "refund_gemini_live_minutes_session",
      { p_exam_session_id: sessionId, p_minutes: minutes },
    );
    if (refundErr) {
      console.warn(
        `[refundAndArchiveSession] refund failed session=${sessionId} err=${refundErr.message}`,
      );
    }
  }

  return { archived: true, refundedMinutes: minutes };
}
