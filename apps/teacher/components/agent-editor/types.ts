import type { FollowUpDepth } from "@/lib/runtime/flow-parameters";

/** Result shape used by every action this editor calls. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Generic server-action signature accepted by the editor blocks. */
export type ServerFormAction = (fd: FormData) => Promise<ActionResult>;

/** Non-FormData action used by the Drive picker — picker hands back a typed
 *  file ref synchronously, no need to serialize through FormData. */
export type AddFromDriveAction = (
  rowId: string,
  driveFile: { id: string; name: string; mimeType: string },
) => Promise<ActionResult>;

/**
 * Run function injected by the page-level shell (AgentsEditor or
 * TemplateEditor). Each form passes its tag + the action thunk; the
 * shell handles transitions + status state.
 */
export type RunAction = (
  tag: string,
  action: () => Promise<ActionResult>,
) => void;

export type TagStatus = (tag: string) => string | null;

/** "Editing system defaults" (admin) vs "editing one teacher's per-Canvas
 *  assignment override" (template). Drives field visibility + reset
 *  affordances. */
export type EditorMode = "system" | "template";

// ---------------------------------------------------------------------------
// Row shapes — mirror personality_presets, exam_templates, question_sets,
// question_buckets, questions. Per-block reductions live in PersonaBlock.tsx
// / FlowBlock.tsx / EvaluationBlock.tsx.
// ---------------------------------------------------------------------------

export type PersonaRow = {
  id: string;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
  follow_up_depth: FollowUpDepth;
  personalization_enabled: boolean;
  eval_prompt_body: string | null;
  rubric_body: string | null;
  live_voice_name: string | null;
  opening_text: string | null;
  closing_text: string | null;
  updated_at: string;
};

export type QSetRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

export type BucketRow = {
  id: string;
  question_set_id: string;
  name: string;
  position: number;
  select_count: number;
};

export type QuestionRow = {
  id: string;
  question_bucket_id: string;
  position: number;
  text: string;
  reference_snippet: string | null;
};

/** Gemini Live prebuilt voices (as of late 2025 / early 2026). Update this
 *  list when Google ships new voices in the Live API. Lives here so both
 *  the admin persona block and the template persona block render the same
 *  dropdown without re-declaring the constant. */
export const LIVE_VOICES = [
  "Aoede",
  "Charon",
  "Fenrir",
  "Kore",
  "Leda",
  "Puck",
  "Orus",
  "Zephyr",
] as const;

export type LiveVoice = (typeof LIVE_VOICES)[number];
