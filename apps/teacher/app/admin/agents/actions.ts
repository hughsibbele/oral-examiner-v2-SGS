"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
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

export type ActionResult = { ok: true } | { ok: false; error: string };

const AGENTS_PATH = "/admin/agents";

/** Per-attachment file cap (before extraction) — M2b.1f spec. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Total intake-pack cap (sum of extracted-text byte sizes across all
 * attachments). 500KB ≈ 125K tokens — well within any model context but
 * small enough that nobody attaches a textbook. Override via
 * INTAKE_TOTAL_CAP_BYTES env.
 */
const MAX_TOTAL_INTAKE_BYTES = Number(
  process.env.INTAKE_TOTAL_CAP_BYTES ?? 500 * 1024,
);

/** Sum of attachment byte_size across a config; used for cap enforcement + UI. */
function totalIntakeBytes(cfg: IntakeConfig): number {
  return cfg.attachments.reduce((n, a) => n + (a.byte_size || 0), 0);
}

/** Validate that adding `newBytes` doesn't exceed the total cap. */
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

// =========================================================================
// Universal prompts (safety envelope + system prompts in `prompts` table)
// =========================================================================

export async function updateSafetyEnvelope(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { ok: false, error: "Envelope body is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("safety_envelope")
    .update({ body })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function updateSystemPrompt(formData: FormData): Promise<ActionResult> {
  const result = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id) return { ok: false, error: "Missing prompt id." };
  if (!body) return { ok: false, error: "Prompt body is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("prompts")
    .update({ body, updated_by_email: result.teacher.email })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

// =========================================================================
// Persona (personality_presets)
// =========================================================================

export async function updatePersona(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const persona_body = String(formData.get("persona_body") ?? "").trim();
  const flow_body = String(formData.get("flow_body") ?? "").trim();
  const live_voice_name = String(formData.get("live_voice_name") ?? "").trim();
  const opening_text = String(formData.get("opening_text") ?? "").trim();
  const closing_text = String(formData.get("closing_text") ?? "").trim();

  if (!id) return { ok: false, error: "Missing preset id." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!persona_body) return { ok: false, error: "Persona body is required." };
  if (!flow_body) return { ok: false, error: "Flow body is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("personality_presets")
    .update({
      name,
      description: description || null,
      persona_body,
      flow_body,
      live_voice_name: live_voice_name || null,
      opening_text: opening_text || null,
      closing_text: closing_text || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

// =========================================================================
// Evaluation (eval prompt + rubric on the persona row)
// =========================================================================

export async function updateEvaluation(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const eval_prompt_body = String(formData.get("eval_prompt_body") ?? "").trim();
  const rubric_body = String(formData.get("rubric_body") ?? "").trim();

  if (!id) return { ok: false, error: "Missing preset id." };
  if (!eval_prompt_body) return { ok: false, error: "Evaluation prompt is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("personality_presets")
    .update({
      eval_prompt_body,
      rubric_body: rubric_body || null,  // empty rubric = ungraded
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

// =========================================================================
// Question set
// =========================================================================

export async function updateQuestionSet(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

// =========================================================================
// Buckets
// =========================================================================

export async function createBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function updateBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function deleteBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing bucket id." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("question_buckets").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function moveBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

// =========================================================================
// Questions
// =========================================================================

export async function createQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function updateQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function deleteQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing question id." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function moveQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const bucketId = String(formData.get("question_bucket_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !bucketId) return { ok: false, error: "Missing ids." };
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: "Invalid direction." };
  }
  return swapPosition({
    table: "questions",
    parentColumn: "question_bucket_id",
    parentId: bucketId,
    rowId: id,
    direction,
  });
}

// =========================================================================
// Intake config (admin-default on personality_presets)
// =========================================================================

/**
 * Read + mutate the intake_config jsonb for a persona row. Centralizes the
 * round-trip so each individual action stays small. Caller's `mutate`
 * receives the parsed config and returns the updated shape (or null to
 * abort with the given error message).
 */
async function withIntakeConfig(
  personaId: string,
  mutate: (cfg: IntakeConfig) => IntakeConfig | { error: string },
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data: row, error: readErr } = await supabase
    .from("personality_presets")
    .select("intake_config")
    .eq("id", personaId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "Persona not found." };

  const current = parseIntakeConfig(row.intake_config);
  const result = mutate(current);
  if ("error" in result) return { ok: false, error: result.error };

  const { error: writeErr } = await supabase
    .from("personality_presets")
    .update({ intake_config: result as unknown as never })
    .eq("id", personaId);
  if (writeErr) return { ok: false, error: writeErr.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function updateIntakeToggles(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing persona id." };

  const useDesc = formData.get("use_canvas_description") === "on";
  const useSub = formData.get("use_canvas_submission") === "on";

  return withIntakeConfig(id, (cfg) => ({
    ...cfg,
    use_canvas_description: useDesc,
    use_canvas_submission: useSub,
  }));
}

export async function addIntakeAttachmentFromDrive(
  personaId: string,
  driveFile: { id: string; name: string; mimeType: string },
): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!personaId) return { ok: false, error: "Missing persona id." };
  if (!driveFile?.id) return { ok: false, error: "Missing Drive file id." };

  let extracted;
  try {
    const oauth = await getTeacherGoogleClient(ctx.teacher.id);
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
  return withIntakeConfig(personaId, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

export async function addIntakeAttachmentFromUpload(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing persona id." };

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
  return withIntakeConfig(id, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

export async function addIntakeAttachmentFromPaste(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!id) return { ok: false, error: "Missing persona id." };
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
  return withIntakeConfig(id, (cfg) => {
    const check = checkTotalCap(cfg, attachment.byte_size);
    if (!check.ok) return { error: check.error };
    return { ...cfg, attachments: [...cfg.attachments, attachment] };
  });
}

/** Read the total-intake cap for the UI to display. Public, so the
 *  IntakeEditor can show "X KB / Y KB used" without hardcoding the value. */
export async function getIntakeTotalCapBytes(): Promise<number> {
  return MAX_TOTAL_INTAKE_BYTES;
}

export async function removeIntakeAttachment(
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const personaId = String(formData.get("persona_id") ?? "");
  const attachmentId = String(formData.get("attachment_id") ?? "");
  if (!personaId) return { ok: false, error: "Missing persona id." };
  if (!attachmentId) return { ok: false, error: "Missing attachment id." };

  return withIntakeConfig(personaId, (cfg) => ({
    ...cfg,
    attachments: cfg.attachments.filter((a) => a.id !== attachmentId),
  }));
}

/** Reset a persona's intake_config to the all-default shape. */
export async function resetIntakeConfig(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing persona id." };
  return withIntakeConfig(id, () => DEFAULT_INTAKE_CONFIG);
}

// =========================================================================
// Helper: swap position with adjacent row (sentinel -1 dodges the
// unique (parent, position) constraint mid-swap)
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
  // .eq's column param is narrowed per-table by Supabase's generic types; we
  // widen via `as never` since the caller passes the matching column name.
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

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}
