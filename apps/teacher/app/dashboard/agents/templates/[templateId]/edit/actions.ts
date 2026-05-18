"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import type { Json } from "@oral-examiner/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
      "id, teacher_id, personality_preset_id, locked_at, name",
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
