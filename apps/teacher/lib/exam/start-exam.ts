// M2b.5c.4 — server action invoked when the student clicks "Start exam"
// on the pre-exam ready screen.

"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectQuestionsForSet } from "@/lib/runtime/select-questions";
import { resolveExamContext } from "./resolve";
import {
  archiveReasonFor,
  archiveSession,
  classifyPriorSession,
  findActivePriorSession,
} from "./session";
import type { Json } from "@oral-examiner/db";

const ALLOWED_DOMAIN =
  process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";

/**
 * Start a fresh exam session. Re-validates everything server-side (auth,
 * binding, roster, prior-session race) so a stale page can't sneak past
 * the checks the page handler made on render.
 *
 * On success: inserts an exam_sessions row with state='started' and the
 * pre-selected question list, then redirects to the live-voice URL.
 * Question selection uses Node's crypto.randomInt — never the LLM.
 *
 * The session row points at EITHER an exam_template (teacher customized)
 * OR a personality_preset (binding picked default verbatim) per the
 * 20260519131123 schema. The CHECK constraint enforces exactly-one-of.
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

  const resolution = await resolveExamContext({
    canvasAssignmentId,
    studentEmail: user.email,
    studentAuthUserId: user.id,
  });
  if (resolution.kind !== "ok") {
    throw new Error(`startExam: ${resolution.kind}`);
  }

  const { binding, student, agent } = resolution;

  // Race-guard: re-check the prior session right before insert. A second
  // tab could have just transitioned to completed since the page loaded.
  const prior = await findActivePriorSession({
    canvasAssignmentId,
    studentId: student.id,
  });
  if (prior) {
    const verdict = classifyPriorSession(prior);
    if (verdict === "completion_blocked") {
      throw new Error("startExam: already completed");
    }
    if (verdict === "live_session") {
      // Tab race — let the run URL handle it.
      redirect(`/exam/${canvasAssignmentId}/run`);
    }
    const reason = archiveReasonFor(verdict);
    if (reason) {
      await archiveSession(prior.id, reason);
    }
  }

  const questionSetId = pickQuestionSetId(agent);

  const admin = createAdminClient();
  const selectedQuestions = questionSetId
    ? await selectQuestionsForSet(questionSetId, admin)
    : [];

  // Wire the agent identifier — exactly one of (template, preset) per the
  // CHECK constraint.
  const agentFk =
    binding.exam_template_id !== null
      ? { exam_template_id: binding.exam_template_id }
      : { personality_preset_id: binding.personality_preset_id };

  const { error: insertErr } = await admin.from("exam_sessions").insert({
    ...agentFk,
    canvas_assignment_id: canvasAssignmentId,
    student_id: student.id,
    state: "started",
    selected_questions: selectedQuestions as unknown as Json,
  });

  if (insertErr) {
    throw new Error(`startExam: insert failed: ${insertErr.message}`);
  }

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
