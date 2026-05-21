// M2b.5c.4 — server action invoked when the student clicks "Start exam"
// on the pre-exam ready screen.
//
// REMEDIATION_PLAN Phase 1: the multi-step classify → archive → insert flow
// is collapsed into a single SECURITY DEFINER RPC `begin_exam_session` that
// runs the whole transition in one transaction with FOR UPDATE serialization
// against the prior session row. The RPC also populates the new snapshot
// columns (eval_prompt_body / rubric_body / persona_name / roster) so eval
// reads a frozen rubric and scrubbing has an invariant roster — see
// REMEDIATION_PLAN.md.

"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectQuestionsForSet } from "@/lib/runtime/select-questions";
import { resolveExamContext } from "./resolve";
import type { Json } from "@oral-examiner/db";

const ALLOWED_DOMAIN =
  process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";

/**
 * Start a fresh exam session. Re-validates everything server-side (auth,
 * binding, roster) and then delegates the actual classify-archive-insert
 * transition to the begin_exam_session RPC so it's serialized + atomic.
 *
 * Question selection still runs here (Node's crypto.randomInt is preferred
 * over Postgres's random() for exam question selection — CSPRNG > PRNG).
 */
export async function startExam(formData: FormData): Promise<void> {
  const canvasAssignmentId = formData.get("canvas_assignment_id");
  if (typeof canvasAssignmentId !== "string" || !canvasAssignmentId) {
    throw new Error("startExam: missing canvas_assignment_id");
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    throw new Error("startExam: not signed in");
  }
  if (!user.email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    throw new Error("startExam: wrong domain");
  }

  // resolveExamContext also upserts the students row + links auth_user_id,
  // which the RPC depends on (it takes p_student_id). The page handler
  // already called resolve to render the ready screen; we re-call here to
  // catch any race (e.g., teacher unassigned the agent between page load
  // and form submit).
  const resolution = await resolveExamContext({
    canvasAssignmentId,
    studentEmail: user.email,
    studentAuthUserId: user.id,
  });
  if (resolution.kind !== "ok") {
    throw new Error(`startExam: ${resolution.kind}`);
  }

  const { student, agent } = resolution;

  const admin = createAdminClient();
  const questionSetId = pickQuestionSetId(agent);
  const selectedQuestions = questionSetId
    ? await selectQuestionsForSet(questionSetId, admin)
    : [];

  const { data, error } = await admin.rpc("begin_exam_session", {
    p_canvas_assignment_id: canvasAssignmentId,
    p_student_id: student.id,
    p_selected_questions: selectedQuestions as unknown as Json,
  });

  if (error) {
    // The RPC raises P0001 with a known message for each semantic failure.
    // Pattern-match so the caller throws / redirects with a meaningful path.
    const msg = error.message ?? "";
    if (msg.includes("no_binding")) {
      throw new Error("startExam: no_binding");
    }
    if (msg.includes("no_agent")) {
      throw new Error("startExam: no_agent");
    }
    if (msg.includes("roster_missing")) {
      throw new Error("startExam: roster_missing");
    }
    if (msg.includes("completion_blocked")) {
      throw new Error("startExam: already_completed");
    }
    // Belt-and-braces: the partial unique index could fire on a concurrent
    // racer that beat us through the FOR UPDATE window. Redirect to /run;
    // the runs page handles state on its own.
    if (error.code === "23505") {
      redirect(`/exam/${canvasAssignmentId}/run`);
    }
    throw new Error(`startExam: ${msg || "RPC failed"}`);
  }

  if (!data || data.length === 0) {
    throw new Error("startExam: RPC returned no rows");
  }

  // classification of 'live_session' means an existing started/in_progress
  // row was found and reused; the redirect is the same in both cases.
  redirect(`/exam/${canvasAssignmentId}/run`);
}

function pickQuestionSetId(
  agent:
    | {
        kind: "preset";
        preset: { default_question_set_id: string | null };
      }
    | {
        kind: "template";
        template: { question_set_id: string | null };
        preset: { default_question_set_id: string | null } | null;
      },
): string | null {
  if (agent.kind === "preset") {
    return agent.preset.default_question_set_id;
  }
  return (
    agent.template.question_set_id ??
    agent.preset?.default_question_set_id ??
    null
  );
}
