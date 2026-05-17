// Structured flow parameters that get inlined into the runtime system
// prompt's # EXAMINATION FLOW section, ahead of the prose flow_body.
//
// Duration is COMPUTED from question count × time-per-question (which
// scales with follow-up depth) — not a separately-stored knob. This avoids
// the "slider says 15min but the prose says 30min" contradiction by
// making the question set the single source of truth for tempo.
//
// Admins tune follow_up_depth + personalization_enabled per persona via
// toggles in /admin/agents. Teachers override per-template in M2b.5.

export type FollowUpDepth = "light" | "medium" | "deep";

export type FlowParameters = {
  follow_up_depth: FollowUpDepth;
  personalization_enabled: boolean;
};

/** Minutes per question, by follow-up depth. Heuristic, not a contract. */
export const MINUTES_PER_QUESTION: Record<FollowUpDepth, number> = {
  light: 1.5,
  medium: 2.5,
  deep: 4,
};

/** Soft cap that turns the UI estimate red and the runtime warns. */
export const SOFT_MAX_DURATION_MIN = 20;

/**
 * Compute the rough session duration (in minutes) for `questionCount`
 * questions at the given depth. Rounds to the nearest half-minute.
 */
export function estimateDurationMin(
  questionCount: number,
  depth: FollowUpDepth,
): number {
  const raw = questionCount * MINUTES_PER_QUESTION[depth];
  return Math.round(raw * 2) / 2;
}

const DEPTH_DESCRIPTIONS: Record<FollowUpDepth, string> = {
  light:
    "Ask each question once. Accept the first reasonable answer and move on. Don't probe.",
  medium:
    "Probe vague or shallow answers once. Press for evidence on key claims. Move on after one follow-up.",
  deep:
    "Probe persistently until you understand the student's reasoning. Ask follow-ups 2–3 levels deep on important claims; don't accept hand-waves.",
};

const PERSONALIZATION_ON =
  "Address the student by name when given. Reference the assignment context (intake materials, course topic) in greetings and transitions to make the conversation feel specific to their work.";
const PERSONALIZATION_OFF =
  "Keep the conversation generic. Don't address the student by name. Reference assignment context only when strictly necessary to ask the next question.";

/**
 * Format the parameters as a short prompt block that prepends the prose
 * flow_body in the runtime system prompt. Sentence-form, not bullet-form,
 * because models follow narrative directives more reliably than terse
 * lists. The wording is imperative ("you must…") so the agent treats it
 * as instructions rather than data.
 *
 * `questionCount` comes from the session's selected questions (server-side
 * Fisher-Yates result, not the bucket total). Duration is computed inside.
 */
export function formatFlowParameters(
  params: FlowParameters,
  questionCount: number,
): string {
  const durationMin = estimateDurationMin(questionCount, params.follow_up_depth);
  const lines: string[] = [];
  lines.push(
    `You have ${questionCount} questions to ask. Target ~${durationMin} minutes total at a comfortable pace — that's about ${MINUTES_PER_QUESTION[params.follow_up_depth]} minutes per question with the follow-up style below. Don't rush; don't linger.`,
  );
  lines.push(DEPTH_DESCRIPTIONS[params.follow_up_depth]);
  lines.push(
    params.personalization_enabled ? PERSONALIZATION_ON : PERSONALIZATION_OFF,
  );
  return lines.join("\n\n");
}
