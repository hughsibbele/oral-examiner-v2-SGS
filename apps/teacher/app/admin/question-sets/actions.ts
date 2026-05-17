"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

  revalidatePath("/admin/question-sets");
  revalidatePath(`/admin/question-sets/${id}`);
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

  const { error } = await supabase
    .from("question_buckets")
    .insert({
      question_set_id: setId,
      name,
      position: nextPos,
      select_count: selectCount,
    });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/question-sets/${setId}`);
  return { ok: true };
}

export async function updateBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const selectCount = Number(formData.get("select_count") ?? 1);

  if (!id || !setId) return { ok: false, error: "Missing ids." };
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

  revalidatePath(`/admin/question-sets/${setId}`);
  return { ok: true };
}

export async function deleteBucket(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  if (!id || !setId) return { ok: false, error: "Missing ids." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("question_buckets").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/question-sets/${setId}`);
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
    revalidate: `/admin/question-sets/${setId}`,
  });
}

// =========================================================================
// Questions
// =========================================================================

export async function createQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const bucketId = String(formData.get("question_bucket_id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  const text = String(formData.get("text") ?? "").trim();

  if (!bucketId || !setId) return { ok: false, error: "Missing ids." };
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

  revalidatePath(`/admin/question-sets/${setId}`);
  return { ok: true };
}

export async function updateQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const reference = String(formData.get("reference_snippet") ?? "").trim();

  if (!id || !setId) return { ok: false, error: "Missing ids." };
  if (!text) return { ok: false, error: "Question text is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("questions")
    .update({ text, reference_snippet: reference || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/question-sets/${setId}`);
  return { ok: true };
}

export async function deleteQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  if (!id || !setId) return { ok: false, error: "Missing ids." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/question-sets/${setId}`);
  return { ok: true };
}

export async function moveQuestion(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const bucketId = String(formData.get("question_bucket_id") ?? "");
  const setId = String(formData.get("question_set_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !bucketId || !setId) return { ok: false, error: "Missing ids." };
  if (direction !== "up" && direction !== "down") {
    return { ok: false, error: "Invalid direction." };
  }
  return swapPosition({
    table: "questions",
    parentColumn: "question_bucket_id",
    parentId: bucketId,
    rowId: id,
    direction,
    revalidate: `/admin/question-sets/${setId}`,
  });
}

// =========================================================================
// Helper: swap position with adjacent row (uses sentinel -1 to dodge the
// unique (parent, position) constraint mid-swap)
// =========================================================================

async function swapPosition(opts: {
  table: "question_buckets" | "questions";
  parentColumn: "question_set_id" | "question_bucket_id";
  parentId: string;
  rowId: string;
  direction: "up" | "down";
  revalidate: string;
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
  // .eq's column param is narrowed per-table by Supabase's generic types; for
  // the table-agnostic helper we widen via `as never` — the caller passes the
  // matching column name for each table.
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

  // Three-step swap to dodge the unique (parent, position) constraint:
  //   1) park current at sentinel -1
  //   2) move neighbor into current's old slot
  //   3) move current into neighbor's old slot
  const sentinel = -1;
  let step;
  step = await supabase.from(opts.table).update({ position: sentinel }).eq("id", opts.rowId);
  if (step.error) return { ok: false, error: step.error.message };
  step = await supabase.from(opts.table).update({ position: currentPos }).eq("id", neighborRow.id);
  if (step.error) return { ok: false, error: step.error.message };
  step = await supabase
    .from(opts.table)
    .update({ position: neighborRow.position })
    .eq("id", opts.rowId);
  if (step.error) return { ok: false, error: step.error.message };

  revalidatePath(opts.revalidate);
  return { ok: true };
}
