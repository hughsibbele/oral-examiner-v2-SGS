"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import {
  getTeacherGoogleClient,
  GoogleAuthError,
} from "@/lib/google/auth";
import {
  extractPdfText,
  extractPdfTextFromDrive,
  PdfExtractionError,
} from "@/lib/intake/pdf-to-text";
import {
  DEFAULT_INTAKE_CONFIG,
  parseIntakeConfig,
  type IntakeAttachment,
  type IntakeConfig,
} from "@/lib/intake/types";
import type { Json } from "@oral-examiner/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Per-attachment file cap (before extraction) — matches admin actions. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Total intake-pack cap (sum of extracted-text byte sizes). Mirrors the
 *  admin's `INTAKE_TOTAL_CAP_BYTES` knob so both sides honor the same cap. */
const MAX_TOTAL_INTAKE_BYTES = Number(
  process.env.INTAKE_TOTAL_CAP_BYTES ?? 500 * 1024,
);

/**
 * Per-template editor actions (M2b.5b.3). Each action writes to a
 * `exam_templates` row owned by the authed teacher; RLS enforces the
 * ownership check.
 *
 * "Override vs inherit" semantics: a column is an override when its value
 * differs from the linked preset's value; if the submitted value matches
 * the preset, the column is set to NULL so future preset edits flow
 * through. The `resetTemplateField` action is a one-click way to clear
 * any one column to NULL.
 *
 * Question-set + intake editing land in M2b.5b.4/.5/.6 — out of scope
 * here. Locked templates (a session has run) reject all writes.
 */

const PERSONA_FIELDS = [
  "persona_body",
  "live_voice_name",
  "opening_text",
  "closing_text",
] as const;
const FLOW_FIELDS = [
  "flow_body",
  "follow_up_depth",
  "personalization_enabled",
] as const;
const EVAL_FIELDS = ["eval_prompt_body", "rubric_body"] as const;

/** Every column the per-template editor is allowed to reset to NULL. */
const RESETTABLE_FIELDS = new Set<string>([
  ...PERSONA_FIELDS,
  ...FLOW_FIELDS,
  ...EVAL_FIELDS,
]);

type TemplateRow = {
  id: string;
  teacher_id: string;
  personality_preset_id: string | null;
  locked_at: string | null;
  name: string;
  intake_config: Json;
};

type PresetRow = {
  persona_body: string;
  flow_body: string;
  follow_up_depth: "light" | "medium" | "deep";
  personalization_enabled: boolean;
  live_voice_name: string | null;
  opening_text: string | null;
  closing_text: string | null;
  eval_prompt_body: string | null;
  rubric_body: string | null;
  intake_config: Json;
};

type LoadResult =
  | { ok: true; template: TemplateRow; preset: PresetRow | null }
  | { ok: false; error: string };

async function loadTemplateContext(templateId: string): Promise<LoadResult> {
  if (!templateId) return { ok: false, error: "Missing template id." };
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  const supabase = await createServerSupabase();
  // RLS scopes this select to teacher_id == this teacher; if the row's
  // missing, either it doesn't exist or it belongs to someone else.
  const { data: template, error: tplErr } = await supabase
    .from("exam_templates")
    .select(
      "id, teacher_id, personality_preset_id, locked_at, name, intake_config",
    )
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr) return { ok: false, error: tplErr.message };
  if (!template) return { ok: false, error: "Template not found (or not yours)." };
  const tpl = template as unknown as TemplateRow;
  if (tpl.locked_at) {
    return {
      ok: false,
      error: "This template is locked — a student session already ran.",
    };
  }

  let preset: PresetRow | null = null;
  if (tpl.personality_preset_id) {
    const { data: presetRow, error: presetErr } = await supabase
      .from("personality_presets")
      .select(
        "persona_body, flow_body, follow_up_depth, personalization_enabled, live_voice_name, opening_text, closing_text, eval_prompt_body, rubric_body, intake_config",
      )
      .eq("id", tpl.personality_preset_id)
      .maybeSingle();
    if (presetErr) return { ok: false, error: presetErr.message };
    preset = (presetRow as unknown as PresetRow | null) ?? null;
  }
  return { ok: true, template: tpl, preset };
}

/**
 * If `value` equals the preset's, return null (= inherit); otherwise return
 * `value`. Empty string is treated as null (= inherit) regardless. Used by
 * each update action to keep override semantics clean.
 */
function diffOrNull<T extends string | boolean | null>(
  value: T,
  presetValue: T | null | undefined,
): T | null {
  if (value === null || value === "") return null;
  if (presetValue !== undefined && presetValue !== null && value === presetValue) {
    return null;
  }
  return value;
}

function revalidateEditPage(template: TemplateRow): void {
  revalidatePath(`/dashboard/agents/templates/${template.id}/edit`);
  revalidatePath("/dashboard/agents");
  revalidatePath("/dashboard");
}

// =========================================================================
// Persona — persona_body + live_voice_name + opening_text + closing_text
// =========================================================================

export async function updateTemplatePersona(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template, preset } = ctx;

  const persona_body = String(formData.get("persona_body") ?? "").trim();
  const live_voice_name = String(formData.get("live_voice_name") ?? "").trim();
  const opening_text = String(formData.get("opening_text") ?? "").trim();
  const closing_text = String(formData.get("closing_text") ?? "").trim();

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("exam_templates")
    .update({
      persona_body: diffOrNull(persona_body, preset?.persona_body),
      live_voice_name: diffOrNull(live_voice_name, preset?.live_voice_name),
      opening_text: diffOrNull(opening_text, preset?.opening_text),
      closing_text: diffOrNull(closing_text, preset?.closing_text),
    })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

// =========================================================================
// Flow — flow_body + follow_up_depth + personalization_enabled
// =========================================================================

export async function updateTemplateFlow(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template, preset } = ctx;

  const flow_body = String(formData.get("flow_body") ?? "").trim();
  const follow_up_depth_raw = String(formData.get("follow_up_depth") ?? "").trim();
  if (
    follow_up_depth_raw !== "" &&
    follow_up_depth_raw !== "light" &&
    follow_up_depth_raw !== "medium" &&
    follow_up_depth_raw !== "deep"
  ) {
    return { ok: false, error: "Follow-up depth must be light, medium, or deep." };
  }
  const personalization_enabled = formData.get("personalization_enabled") === "on";

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("exam_templates")
    .update({
      flow_body: diffOrNull(flow_body, preset?.flow_body),
      follow_up_depth: diffOrNull(
        follow_up_depth_raw,
        preset?.follow_up_depth,
      ),
      personalization_enabled: diffOrNull(
        personalization_enabled,
        preset?.personalization_enabled,
      ),
    })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

// =========================================================================
// Evaluation — eval_prompt_body + rubric_body
// =========================================================================

export async function updateTemplateEvaluation(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template, preset } = ctx;

  const eval_prompt_body = String(formData.get("eval_prompt_body") ?? "").trim();
  const rubric_body = String(formData.get("rubric_body") ?? "").trim();

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("exam_templates")
    .update({
      eval_prompt_body: diffOrNull(
        eval_prompt_body,
        preset?.eval_prompt_body,
      ),
      rubric_body: diffOrNull(rubric_body, preset?.rubric_body),
    })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

// =========================================================================
// Per-field reset — set one column to NULL so the runtime inherits from
// the preset. FormData carries `id` (= template id) and `field`.
// =========================================================================

export async function resetTemplateField(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  if (!RESETTABLE_FIELDS.has(field)) {
    return { ok: false, error: `Field "${field}" can't be reset.` };
  }
  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template } = ctx;

  const supabase = await createServerSupabase();
  // Dynamic-key update — Supabase's typed update wants a literal object, so
  // we widen via `as never` since `field` is gated by the allowlist above.
  const patch = { [field]: null } as never;
  const { error } = await supabase
    .from("exam_templates")
    .update(patch)
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

/**
 * Update the template's display name. Independent of the persona override
 * fields; mirrors the renaming affordance that lives at the top of the
 * edit page. Empty string falls back to the previously-stored name (we
 * reject empty submissions outright).
 */
export async function updateTemplateName(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name can't be empty." };

  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template } = ctx;

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("exam_templates")
    .update({ name })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

// =========================================================================
// Intake config (per-template; mirrors the admin actions but writes to
// exam_templates.intake_config, scoped by RLS to this teacher's row).
// =========================================================================

/** Sum of attachment byte_size across a config; used for cap enforcement. */
function totalIntakeBytes(cfg: IntakeConfig): number {
  return cfg.attachments.reduce((n, a) => n + (a.byte_size || 0), 0);
}

function checkTotalCap(
  cfg: IntakeConfig,
  newBytes: number,
): { ok: true } | { ok: false; error: string } {
  const after = totalIntakeBytes(cfg) + newBytes;
  if (after > MAX_TOTAL_INTAKE_BYTES) {
    const usedKb = (totalIntakeBytes(cfg) / 1024).toFixed(0);
    const capKb = (MAX_TOTAL_INTAKE_BYTES / 1024).toFixed(0);
    const addKb = (newBytes / 1024).toFixed(1);
    return {
      ok: false,
      error: `Would exceed total cap (${usedKb} KB used + ${addKb} KB new > ${capKb} KB cap). Remove a snippet first or trim this one.`,
    };
  }
  return { ok: true };
}

/**
 * Round-trip helper: load the template's intake_config, run a mutator,
 * write back. `mutate` returns either the new shape or an error message.
 * Locked templates reject all writes (caught upstream in loadTemplateContext).
 */
async function withTemplateIntake(
  templateId: string,
  mutate: (cfg: IntakeConfig) => IntakeConfig | { error: string },
): Promise<ActionResult> {
  const ctx = await loadTemplateContext(templateId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template } = ctx;

  const current = parseIntakeConfig(template.intake_config);
  const result = mutate(current);
  if ("error" in result) return { ok: false, error: result.error };

  const supabase = await createServerSupabase();
  const { error: writeErr } = await supabase
    .from("exam_templates")
    .update({ intake_config: result as unknown as never })
    .eq("id", template.id);
  if (writeErr) return { ok: false, error: writeErr.message };

  revalidateEditPage(template);
  return { ok: true };
}

export async function updateTemplateIntakeToggles(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const useDesc = formData.get("use_canvas_description") === "on";
  const useSub = formData.get("use_canvas_submission") === "on";
  return withTemplateIntake(id, (cfg) => ({
    ...cfg,
    use_canvas_description: useDesc,
    use_canvas_submission: useSub,
  }));
}

export async function addTemplateIntakeAttachmentFromDrive(
  templateId: string,
  driveFile: { id: string; name: string; mimeType: string },
): Promise<ActionResult> {
  if (!driveFile?.id) return { ok: false, error: "Missing Drive file id." };
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  let extracted;
  try {
    const oauth = await getTeacherGoogleClient(auth.teacher.id);
    extracted = await extractPdfTextFromDrive(driveFile.id, oauth, {
      mimeType: driveFile.mimeType,
    });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return { ok: false, error: `Drive auth: ${err.message}` };
    }
    if (err instanceof PdfExtractionError) {
      return { ok: false, error: `Could not extract text: ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Drive fetch failed.",
    };
  }

  const attachment: IntakeAttachment = {
    id: randomUUID(),
    kind: "drive",
    name: driveFile.name,
    content: extracted.text,
    byte_size: Buffer.byteLength(extracted.text, "utf8"),
    drive_file_id: driveFile.id,
    drive_mime_type: driveFile.mimeType,
    created_at: new Date().toISOString(),
  };
  return withTemplateIntake(templateId, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

export async function addTemplateIntakeAttachmentFromUpload(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing template id." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a PDF to upload." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB, exceeds 10MB cap.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extracted;
  try {
    extracted = await extractPdfText({ buffer, filename: file.name });
  } catch (err) {
    if (err instanceof PdfExtractionError) {
      return { ok: false, error: `Could not extract text: ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Extraction failed.",
    };
  }

  const attachment: IntakeAttachment = {
    id: randomUUID(),
    kind: "upload",
    name: file.name,
    content: extracted.text,
    byte_size: Buffer.byteLength(extracted.text, "utf8"),
    created_at: new Date().toISOString(),
  };
  return withTemplateIntake(id, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

export async function addTemplateIntakeAttachmentFromPaste(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!id) return { ok: false, error: "Missing template id." };
  if (!name) return { ok: false, error: "Give the snippet a name." };
  if (!content) return { ok: false, error: "Paste some text first." };
  if (Buffer.byteLength(content, "utf8") > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Pasted text exceeds 10MB cap." };
  }

  const attachment: IntakeAttachment = {
    id: randomUUID(),
    kind: "paste",
    name,
    content,
    byte_size: Buffer.byteLength(content, "utf8"),
    created_at: new Date().toISOString(),
  };
  return withTemplateIntake(id, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

export async function removeTemplateIntakeAttachment(
  formData: FormData,
): Promise<ActionResult> {
  const templateId = String(formData.get("id") ?? "");
  const attachmentId = String(formData.get("attachment_id") ?? "");
  if (!templateId) return { ok: false, error: "Missing template id." };
  if (!attachmentId) return { ok: false, error: "Missing attachment id." };

  return withTemplateIntake(templateId, (cfg) => ({
    ...cfg,
    attachments: cfg.attachments.filter((a) => a.id !== attachmentId),
  }));
}

/**
 * Re-snapshot the template's intake_config from its linked preset (or to
 * the all-default blank shape if the template is blank-slate). This is the
 * template-level "reset to defaults" action — the equivalent of clicking
 * "reset to default" on a single override field, but for the whole intake
 * config blob. Discards every attachment + toggle override.
 */
export async function resetTemplateIntakeConfig(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template, preset } = ctx;

  const fresh = preset
    ? parseIntakeConfig(preset.intake_config)
    : DEFAULT_INTAKE_CONFIG;

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("exam_templates")
    .update({ intake_config: fresh as unknown as never })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

/** Public cap (KB) for the UI to display. Lives alongside the intake
 *  actions; admin's `getIntakeTotalCapBytes` reads the same env var. */
export async function getTemplateIntakeTotalCapBytes(): Promise<number> {
  return MAX_TOTAL_INTAKE_BYTES;
}

// =========================================================================
// Question set — picker + clone-to-mine (M2b.5b.5)
// =========================================================================

/**
 * Re-link the template to a different question_set. The set must be either
 * system-seeded (teacher_id IS NULL) or owned by this teacher — RLS already
 * scopes question_sets reads to those two cases, so an unauthorized id
 * would surface as "not found" anyway, but we check explicitly so the
 * error message is useful.
 */
export async function setTemplateQuestionSet(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  if (!setId) return { ok: false, error: "Missing question set id." };

  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template } = ctx;

  const supabase = await createServerSupabase();
  const { data: set, error: readErr } = await supabase
    .from("question_sets")
    .select("id, teacher_id")
    .eq("id", setId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!set) return { ok: false, error: "Question set not found." };
  if (set.teacher_id !== null && set.teacher_id !== template.teacher_id) {
    return { ok: false, error: "That question set isn't available to you." };
  }

  const { error } = await supabase
    .from("exam_templates")
    .update({ question_set_id: setId })
    .eq("id", template.id);
  if (error) return { ok: false, error: error.message };

  revalidateEditPage(template);
  return { ok: true };
}

/**
 * Clone the template's currently-linked question set into a new
 * teacher-owned set + cascade question_buckets + questions. Re-links the
 * template to the new set. Used by the "Make my own copy of [current set]"
 * affordance — the only path that turns a system set into a teacher-owned
 * editable set within this template's editor.
 *
 * Per the M2b.5b plan: question-set sharing model is "save-as-mine to
 * reuse" (Option A). Teachers consciously opt into reuse — every clone
 * lands as a fresh set, and only further explicit re-linking shares it
 * across templates.
 */
export async function cloneQuestionSetForTeacher(
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const newName = String(formData.get("name") ?? "").trim();
  if (!newName) return { ok: false, error: "Give your copy a name." };

  const ctx = await loadTemplateContext(id);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { template } = ctx;

  const supabase = await createServerSupabase();

  // Source set lookup — derived from the current question_set_id; reject
  // if the template isn't currently pointed at any set.
  const { data: tplWithSet } = await supabase
    .from("exam_templates")
    .select("question_set_id")
    .eq("id", template.id)
    .maybeSingle();
  const sourceSetId = (tplWithSet?.question_set_id as string | null) ?? null;
  if (!sourceSetId) {
    return {
      ok: false,
      error:
        "Pick a question set first — there's nothing to copy. The agent's default set will appear once a personality preset is linked.",
    };
  }

  const { data: sourceSet, error: srcErr } = await supabase
    .from("question_sets")
    .select("id, teacher_id, description")
    .eq("id", sourceSetId)
    .maybeSingle();
  if (srcErr) return { ok: false, error: srcErr.message };
  if (!sourceSet) return { ok: false, error: "Source set not found." };

  // Insert the new teacher-owned set. RLS write policies on question_sets
  // accept teacher-scoped rows; chasing buckets/questions through the
  // teacher-owned set's RLS chain works the same way.
  const { data: newSet, error: newSetErr } = await supabase
    .from("question_sets")
    .insert({
      teacher_id: template.teacher_id,
      name: newName,
      description: sourceSet.description as string | null,
    })
    .select("id")
    .single();
  if (newSetErr || !newSet) {
    return { ok: false, error: newSetErr?.message ?? "Set clone failed." };
  }

  // Pull source buckets in order, clone each into the new set, then clone
  // the questions under each bucket. Done sequentially to preserve the
  // (parent, position) unique constraints — concurrent inserts would race.
  const { data: srcBuckets, error: bktErr } = await supabase
    .from("question_buckets")
    .select("id, name, position, select_count")
    .eq("question_set_id", sourceSetId)
    .order("position");
  if (bktErr) return { ok: false, error: bktErr.message };

  for (const b of (srcBuckets ?? []) as Array<{
    id: string;
    name: string;
    position: number;
    select_count: number;
  }>) {
    const { data: newBucket, error: bktInsErr } = await supabase
      .from("question_buckets")
      .insert({
        question_set_id: newSet.id as string,
        name: b.name,
        position: b.position,
        select_count: b.select_count,
      })
      .select("id")
      .single();
    if (bktInsErr || !newBucket) {
      return { ok: false, error: bktInsErr?.message ?? "Bucket clone failed." };
    }

    const { data: srcQs, error: qErr } = await supabase
      .from("questions")
      .select("position, text, reference_snippet")
      .eq("question_bucket_id", b.id)
      .order("position");
    if (qErr) return { ok: false, error: qErr.message };

    if ((srcQs ?? []).length > 0) {
      const qRows = (srcQs as Array<{
        position: number;
        text: string;
        reference_snippet: string | null;
      }>).map((q) => ({
        question_bucket_id: newBucket.id as string,
        position: q.position,
        text: q.text,
        reference_snippet: q.reference_snippet,
      }));
      const { error: qInsErr } = await supabase
        .from("questions")
        .insert(qRows);
      if (qInsErr) return { ok: false, error: qInsErr.message };
    }
  }

  // Re-link the template to the freshly-cloned set.
  const { error: linkErr } = await supabase
    .from("exam_templates")
    .update({ question_set_id: newSet.id as string })
    .eq("id", template.id);
  if (linkErr) return { ok: false, error: linkErr.message };

  revalidateEditPage(template);
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

// =========================================================================
// Question set inline editor — buckets + questions (M2b.5b.6)
//
// Teacher-scoped CRUD on teacher-owned question_sets / question_buckets /
// questions. RLS already gates writes to rows the teacher owns; these
// actions only add the signed-in check + the revalidate. Editing a
// system-seeded set (teacher_id IS NULL) fails the RLS write policy and
// surfaces as a "permission denied" error to the caller.
//
// Why these duplicate the admin's actions: admins call `requireAdmin()`
// and write to system rows; teachers call `getTeacher()` and write to
// their own rows. Same Supabase shape, different auth check + revalidate
// targets. The shared QuestionSetBlock component takes whichever set of
// actions the page wires up.
// =========================================================================

const TEACHER_AGENT_HUB_PATH = "/dashboard/agents";

function revalidateAgentHub(): void {
  revalidatePath(TEACHER_AGENT_HUB_PATH);
}

async function requireSignedInTeacher(): Promise<
  | { ok: true; teacherId: string }
  | { ok: false; error: string }
> {
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };
  return { ok: true, teacherId: auth.teacher.id };
}

export async function updateOwnedQuestionSet(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!id) return { ok: false, error: "Missing set id." };
  if (!name) return { ok: false, error: "Name is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("question_sets")
    .update({ name, description: description || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function createOwnedBucket(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const setId = String(formData.get("question_set_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const selectCount = Number(formData.get("select_count") ?? 1);
  if (!setId) return { ok: false, error: "Missing set id." };
  if (!name) return { ok: false, error: "Bucket name is required." };
  if (!Number.isInteger(selectCount) || selectCount < 0) {
    return { ok: false, error: "Select count must be a non-negative integer." };
  }

  const supabase = await createServerSupabase();
  const { data: existing } = await supabase
    .from("question_buckets")
    .select("position")
    .eq("question_set_id", setId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("question_buckets").insert({
    question_set_id: setId,
    name,
    position: nextPos,
    select_count: selectCount,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function updateOwnedBucket(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const selectCount = Number(formData.get("select_count") ?? 1);
  if (!id) return { ok: false, error: "Missing bucket id." };
  if (!name) return { ok: false, error: "Bucket name is required." };
  if (!Number.isInteger(selectCount) || selectCount < 0) {
    return { ok: false, error: "Select count must be a non-negative integer." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("question_buckets")
    .update({ name, select_count: selectCount })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function deleteOwnedBucket(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing bucket id." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("question_buckets").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function moveOwnedBucket(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !setId) return { ok: false, error: "Missing ids." };
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: "Invalid direction." };
  }
  return swapPosition({
    table: "question_buckets",
    parentColumn: "question_set_id",
    parentId: setId,
    rowId: id,
    direction,
  });
}

export async function createOwnedQuestion(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const bucketId = String(formData.get("question_bucket_id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!bucketId) return { ok: false, error: "Missing bucket id." };
  if (!text) return { ok: false, error: "Question text is required." };

  const supabase = await createServerSupabase();
  const { data: existing } = await supabase
    .from("questions")
    .select("position")
    .eq("question_bucket_id", bucketId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("questions").insert({
    question_bucket_id: bucketId,
    position: nextPos,
    text,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function updateOwnedQuestion(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const reference = String(formData.get("reference_snippet") ?? "").trim();
  if (!id) return { ok: false, error: "Missing question id." };
  if (!text) return { ok: false, error: "Question text is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("questions")
    .update({ text, reference_snippet: reference || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

export async function deleteOwnedQuestion(
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireSignedInTeacher();
  if (!auth.ok) return { ok: false, error: auth.error };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing question id." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateAgentHub();
  return { ok: true };
}

// =========================================================================
// Position-swap helper (mirrors admin's; sentinel -1 dodges the unique
// (parent, position) constraint mid-swap)
// =========================================================================

async function swapPosition(opts: {
  table: "question_buckets" | "questions";
  parentColumn: "question_set_id" | "question_bucket_id";
  parentId: string;
  rowId: string;
  direction: "up" | "down";
}): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const { data: current, error: currentErr } = await supabase
    .from(opts.table)
    .select("position")
    .eq("id", opts.rowId)
    .maybeSingle();
  if (currentErr || !current) {
    return { ok: false, error: currentErr?.message ?? "Row not found." };
  }
  const currentPos = current.position as number;

  const isUp = opts.direction === "up";
  const query = supabase
    .from(opts.table)
    .select("id, position")
    .eq(opts.parentColumn as never, opts.parentId as never)
    .order("position", { ascending: !isUp })
    .limit(1);
  const { data: neighborData, error: neighborErr } = isUp
    ? await query.lt("position", currentPos)
    : await query.gt("position", currentPos);
  if (neighborErr) return { ok: false, error: neighborErr.message };

  const neighborRow =
    (neighborData?.[0] as { id: string; position: number } | undefined) ?? null;
  if (!neighborRow) return { ok: true }; // already at edge — no-op

  const sentinel = -1;
  let step;
  step = await supabase.from(opts.table).update({ position: sentinel }).eq("id", opts.rowId);
  if (step.error) return { ok: false, error: step.error.message };
  step = await supabase
    .from(opts.table)
    .update({ position: currentPos })
    .eq("id", neighborRow.id);
  if (step.error) return { ok: false, error: step.error.message };
  step = await supabase
    .from(opts.table)
    .update({ position: neighborRow.position })
    .eq("id", opts.rowId);
  if (step.error) return { ok: false, error: step.error.message };

  revalidateAgentHub();
  return { ok: true };
}
