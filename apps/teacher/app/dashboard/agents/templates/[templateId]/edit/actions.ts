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
