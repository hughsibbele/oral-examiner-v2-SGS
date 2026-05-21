// REMEDIATION_PLAN Phase 3 — Inngest cron that archives wedged
// started/in_progress exam_sessions past the STALE_SESSION_GRACE_MIN
// window and refunds their reserved Live minutes. Recovers from the
// "student opened the exam, minted a token, then closed the tab before
// the audio session connected" scenario that Phase 2's idempotent
// reservation gate would otherwise wedge the row at (live_minutes_used
// > 0 → 409 on retry).
//
// Schedule is generous (every 5 min) — sessions don't churn that fast
// and Inngest charges per step, not per cron tick. The grace window
// itself (60 min by default) is the conservative knob; the cron cadence
// just decides how soon after the window expires we observe + clean up.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  refundAndArchiveSession,
  STALE_SESSION_GRACE_MIN,
} from "@/lib/exam/session";
import { inngest } from "./client";

const STALE_BATCH_LIMIT = 200;

export const sweepStaleExamSessions = inngest.createFunction(
  {
    id: "sweep-stale-exam-sessions",
    retries: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step, logger }) => {
    const cutoffIso = new Date(
      Date.now() - STALE_SESSION_GRACE_MIN * 60 * 1000,
    ).toISOString();

    const stale = await step.run("find-stale", async () => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("exam_sessions")
        .select("id, state, live_minutes_used, created_at")
        .in("state", ["started", "in_progress"])
        .lt("created_at", cutoffIso)
        .limit(STALE_BATCH_LIMIT);
      if (error) throw new Error(`find-stale: ${error.message}`);
      return data ?? [];
    });

    if (stale.length === 0) {
      logger.info(`[sweep-stale-exam-sessions] none past cutoff=${cutoffIso}`);
      return { swept: 0 };
    }

    logger.info(
      `[sweep-stale-exam-sessions] found ${stale.length} past cutoff=${cutoffIso}`,
    );

    let archived = 0;
    let refundedTotal = 0;
    for (const row of stale) {
      // Each archive is its own step so retries don't re-archive succeeded
      // rows. refundAndArchiveSession is state-fenced + idempotent so a
      // retry of a single step also can't double-refund.
      const result = await step.run(`archive-${row.id}`, async () => {
        try {
          return await refundAndArchiveSession(row.id, "abandoned_resume");
        } catch (err) {
          logger.error(
            `[sweep-stale-exam-sessions] archive failed session=${row.id} err=${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return { archived: false, refundedMinutes: 0 };
        }
      });
      if (result.archived) {
        archived += 1;
        refundedTotal += result.refundedMinutes;
      }
    }

    logger.info(
      `[sweep-stale-exam-sessions] archived=${archived}/${stale.length} refunded_minutes_total=${refundedTotal}`,
    );
    return {
      swept: stale.length,
      archived,
      refunded_minutes_total: refundedTotal,
    };
  },
);
