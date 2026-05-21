// M2b.5d.2 — student-callable server actions for the live exam page.
//
// All paths use the service-role admin client (no student RLS path through
// exam_sessions / exam_templates post-recursion-fix) but gate themselves
// behind the signed-in Supabase user's email matching the row's student.

"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXAM_COMPLETED_EVENT, inngest } from "@/lib/inngest/client";
import {
  loadRosterForSession,
  RosterMissingError,
  scrubTranscriptEntries,
} from "./scrub";
import type { Database, Json } from "@oral-examiner/db";

const ALLOWED_DOMAIN =
  process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";

type ExamSessionState = Database["public"]["Enums"]["exam_session_state"];

type Guard =
  | {
      ok: true;
      sessionId: string;
      canvasAssignmentId: string;
      state: ExamSessionState;
    }
  | { ok: false; reason: string };

async function authorizeForSession(examSessionId: string): Promise<Guard> {
  if (typeof examSessionId !== "string" || !examSessionId) {
    return { ok: false, reason: "missing examSessionId" };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, reason: "not signed in" };
  if (!user.email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    return { ok: false, reason: "wrong domain" };
  }
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("exam_sessions")
    .select("id, state, student_id, canvas_assignment_id")
    .eq("id", examSessionId)
    .maybeSingle();
  if (!session) return { ok: false, reason: "session not found" };
  const { data: student } = await admin
    .from("students")
    .select("email")
    .eq("id", session.student_id)
    .maybeSingle();
  if (!student || student.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, reason: "ownership mismatch" };
  }
  return {
    ok: true,
    sessionId: session.id,
    canvasAssignmentId: session.canvas_assignment_id,
    state: session.state,
  };
}

export type TranscriptEntry = {
  role: "user" | "model";
  text: string;
  timestamp: string;
};

const MAX_TRANSCRIPT_ENTRIES = 2000;

/**
 * Flip state='started' → 'in_progress' on Live `setupComplete`. Idempotent
 * for already-in-progress rows (re-call is a no-op). Race-guarded at the
 * UPDATE level via the state filter so two near-simultaneous client posts
 * can't accidentally regress.
 */
export async function markInProgress(
  examSessionId: string,
): Promise<{ ok: true } | { error: string }> {
  const guard = await authorizeForSession(examSessionId);
  if (!guard.ok) return { error: guard.reason };
  if (guard.state !== "started") return { ok: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("exam_sessions")
    .update({ state: "in_progress" })
    .eq("id", examSessionId)
    .eq("state", "started");
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Save the running transcript so a browser crash or lost connection mid-
 * exam doesn't drop everything the student said. Called every ~10s from
 * the client + on end. Overwrites; the client always sends the cumulative
 * buffer.
 */
export async function flushTranscript(
  examSessionId: string,
  entries: TranscriptEntry[],
): Promise<{ ok: true } | { error: string }> {
  const guard = await authorizeForSession(examSessionId);
  if (!guard.ok) return { error: guard.reason };
  if (guard.state !== "started" && guard.state !== "in_progress") {
    return { error: `Session is ${guard.state}, can't flush.` };
  }
  const admin = createAdminClient();
  let roster;
  try {
    roster = await loadRosterForSession(admin, examSessionId);
  } catch (err) {
    if (err instanceof RosterMissingError) {
      console.warn(
        `[flushTranscript] roster_missing session=${examSessionId} reason=${err.reason}`,
      );
      return { error: "roster_missing" };
    }
    throw err;
  }
  const trimmed = entries.slice(-MAX_TRANSCRIPT_ENTRIES);
  const scrubbed = scrubTranscriptEntries(trimmed, roster);
  // Phase 2 state fence: don't overwrite the transcript on a row that
  // already moved past in_progress (e.g., a 10s flush firing after End-
  // exam committed the final scrubbed payload — would clobber the final
  // state with intermediate data). Treat zero rows as a no-op success.
  const { error } = await admin
    .from("exam_sessions")
    .update({ transcript: scrubbed as unknown as Json })
    .eq("id", examSessionId)
    .in("state", ["started", "in_progress"]);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Close the exam session. Stamps state='completed', completed_at,
 * call_duration_sec, transcript, and optional audio_url; refunds unused
 * Live minutes on the session row; fires the Inngest exam.completed event
 * so the eval pipeline (5d.4) picks it up; then redirects.
 *
 * The `audioPath` arg is the storage path returned by /api/exam/upload-audio.
 * Null when the audio upload failed — we still mark the session complete
 * (the student finished talking; losing audio is recoverable via transcript)
 * but eval may have less context.
 *
 * Return contract: `redirect()` throws on success, so the Promise only
 * resolves when the action FAILED. A returned `{ error: ... }` means the
 * session was NOT marked completed; the client should surface the message.
 * `error === "roster_missing"` is the Phase 0 fail-closed signal that no
 * transcript was written (student speech is anon-token-only territory).
 */
export async function endExamSession(
  examSessionId: string,
  finalTranscript: TranscriptEntry[],
  durationSec: number,
  audioPath: string | null,
): Promise<{ error: string }> {
  const guard = await authorizeForSession(examSessionId);
  if (!guard.ok) return { error: guard.reason };

  const admin = createAdminClient();
  let roster;
  try {
    roster = await loadRosterForSession(admin, examSessionId);
  } catch (err) {
    if (err instanceof RosterMissingError) {
      console.warn(
        `[endExamSession] roster_missing session=${examSessionId} reason=${err.reason} — refusing to write unscrubbed transcript`,
      );
      return { error: "roster_missing" };
    }
    throw err;
  }
  const trimmed = finalTranscript.slice(-MAX_TRANSCRIPT_ENTRIES);
  const scrubbed = scrubTranscriptEntries(trimmed, roster);

  // Read the pre-reservation set in /api/exam/auth-token. We refund any
  // unused tail back to live_minutes_used so the column reflects actual
  // consumption rather than the up-front reservation.
  const { data: priorRow } = await admin
    .from("exam_sessions")
    .select("live_minutes_used")
    .eq("id", examSessionId)
    .maybeSingle();
  const reservedMinutes = priorRow?.live_minutes_used ?? 0;
  const actualMinutes = Math.max(1, Math.ceil(durationSec / 60));
  const unusedMinutes = Math.max(0, reservedMinutes - actualMinutes);

  // Phase 2 state fence: only complete the row if it's still in a state
  // that can move to 'completed'. The `.select("id")` makes Supabase
  // return the affected rows so we can detect a no-op (which means
  // someone — a double-click, a visibilitychange handler, a network
  // retry — already finished this session). When rows-affected = 0,
  // skip the refund + Inngest send (we'd double-count both) and just
  // redirect to the same completion screen the prior call landed on.
  const { data: updatedRows, error: updateErr } = await admin
    .from("exam_sessions")
    .update({
      state: "completed",
      completed_at: new Date().toISOString(),
      call_duration_sec: Math.max(0, Math.round(durationSec)),
      transcript: scrubbed as unknown as Json,
      audio_url: audioPath,
    })
    .eq("id", examSessionId)
    .in("state", ["started", "in_progress"])
    .select("id");
  if (updateErr) return { error: `endExamSession: ${updateErr.message}` };

  const didCompleteHere = (updatedRows?.length ?? 0) > 0;
  if (!didCompleteHere) {
    console.warn(
      `[endExamSession] no_op session=${examSessionId} guard.state=${guard.state} — row was already past in_progress; skipping refund + Inngest send`,
    );
    redirect(`/exam/${guard.canvasAssignmentId}`);
  }

  if (unusedMinutes > 0) {
    // Best-effort. A refund failure shouldn't block the session
    // close — the column just over-reports usage.
    const { error: refundErr } = await admin.rpc(
      "refund_gemini_live_minutes_session",
      {
        p_exam_session_id: examSessionId,
        p_minutes: unusedMinutes,
      },
    );
    if (refundErr) {
      console.warn(
        `[endExamSession] refund failed session=${examSessionId} err=${refundErr.message}`,
      );
    }
  }

  // Fire the exam.completed event for the Inngest eval pipeline (5d.4).
  // Best-effort: a failed send shouldn't block the redirect. The state is
  // already 'completed' so a teacher could manually re-trigger eval via
  // a future admin affordance if needed.
  try {
    await inngest.send({
      name: EXAM_COMPLETED_EVENT,
      data: { exam_session_id: examSessionId },
    });
  } catch (err) {
    console.warn(
      `[endExamSession] inngest send failed session=${examSessionId} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  redirect(`/exam/${guard.canvasAssignmentId}`);
}
