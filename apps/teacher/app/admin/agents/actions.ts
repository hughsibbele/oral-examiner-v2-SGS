"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

const AGENTS_PATH = "/admin/agents";

// =========================================================================
// Safety envelope (singleton; admin-editable)
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
