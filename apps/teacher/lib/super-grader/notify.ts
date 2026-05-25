import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildOralExaminerEnvelope } from "./envelope";
import type { Json } from "@oral-examiner/db";

const TIMEOUT_MS = 5_000;

export type PushOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "posted"; attempted_at: string }
  | { kind: "failed"; error: string; status?: number; attempted_at: string };

/**
 * Push a completed exam session's envelope to super-grader's
 * `/api/ingest/oral_examiner`. Single-shot (one session = one student),
 * unlike HH's per-participant fan-out.
 *
 * Best-effort: never throws. Outcome persisted to
 * `exam_sessions.super_grader_post_status` + `super_grader_response`.
 */
export async function pushSessionToSuperGrader(
  examSessionId: string,
): Promise<PushOutcome> {
  const ingestUrl = process.env.SUPER_GRADER_API_URL;
  const ingestToken = process.env.SUPER_GRADER_INGEST_TOKEN;
  if (!ingestUrl || !ingestToken) {
    return {
      kind: "skipped",
      reason: "SUPER_GRADER_API_URL / SUPER_GRADER_INGEST_TOKEN unset",
    };
  }

  const admin = createAdminClient();
  const attemptedAt = new Date().toISOString();

  let envelope;
  try {
    envelope = await buildOralExaminerEnvelope(examSessionId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await persistOutcome(admin, examSessionId, "error", {
      error,
      attempted_at: attemptedAt,
    });
    return { kind: "failed", error, attempted_at: attemptedAt };
  }

  if (!envelope) {
    const reason = "envelope build returned null (session not found or incomplete)";
    await persistOutcome(admin, examSessionId, "error", {
      error: reason,
      attempted_at: attemptedAt,
    });
    return { kind: "skipped", reason };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ingestUrl}/api/ingest/oral_examiner`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ingestToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const error = body.slice(0, 500) || `HTTP ${res.status}`;
        await persistOutcome(admin, examSessionId, "error", {
          error,
          status: res.status,
          attempted_at: attemptedAt,
        });
        return {
          kind: "failed",
          error,
          status: res.status,
          attempted_at: attemptedAt,
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await persistOutcome(admin, examSessionId, "error", {
      error,
      attempted_at: attemptedAt,
    });
    return { kind: "failed", error, attempted_at: attemptedAt };
  }

  await persistOutcome(admin, examSessionId, "posted", {
    attempted_at: attemptedAt,
  });
  return { kind: "posted", attempted_at: attemptedAt };
}

async function persistOutcome(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
  status: "posted" | "error",
  response: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("exam_sessions")
    .update({
      super_grader_post_status: status,
      super_grader_response: response as Json,
    })
    .eq("id", sessionId);
}
