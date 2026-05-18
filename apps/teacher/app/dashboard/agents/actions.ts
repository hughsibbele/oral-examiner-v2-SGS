"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth/teacher";
import { getCanvasConfigForTeacher } from "@/lib/canvas/server";
import { resolveCardTextForTeacher } from "@/lib/card-text/resolve";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildExamCardBlock,
  CanvasError,
  getAssignment,
  hasExamCardBlock,
  removeExamCardBlock,
  replaceOrAppendExamCardBlock,
  updateAssignmentDescription,
} from "@oral-examiner/canvas";
import type { Json } from "@oral-examiner/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Agent-template management actions (M2b.5b dashboard refactor v2,
 * 2026-05-18). A Canvas assignment binds to EITHER:
 *   - a `personality_presets` row (system default agent) — no
 *     teacher-owned template required, the assignment uses the default
 *     verbatim
 *   - an `exam_templates` row (teacher's custom template) — produced by
 *     cloning a default or another template and giving it a new name
 *
 * Picking a default agent for an assignment NO LONGER creates a template.
 * "Your custom templates" stays clean — only rows the teacher consciously
 * cloned + named appear there.
 */

const AGENTS_PATH = "/dashboard/agents";

/** Reject names that collide with any system preset. Forces a meaningful
 *  rename when cloning from default. Case-insensitive trim compare. */
async function nameIsForbidden(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return "Name can't be empty.";
  const admin = createAdminClient();
  const { data } = await admin
    .from("personality_presets")
    .select("name")
    .is("teacher_id", null);
  const taken = (data ?? [])
    .map((r) => (r.name ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (taken.includes(trimmed.toLowerCase())) {
    return `"${trimmed}" matches a default agent's name. Pick a different name for your custom template.`;
  }
  return null;
}

// =========================================================================
// Clone-from-source: create a NEW custom template seeded from either a
// personality_preset or another exam_template, with a forced new name.
// Optionally rebinds a Canvas assignment to the new template in the same
// operation. This is the only path that creates a teacher-owned
// exam_templates row.
// =========================================================================

export async function cloneAgentTemplate(args: {
  /** `kind: "blank"` produces a starter template with everything null — the
   *  teacher writes the persona, flow, eval, and picks/builds a question set
   *  themselves. `preset` and `template` clone from an existing agent. */
  source:
    | { kind: "preset"; id: string }
    | { kind: "template"; id: string }
    | { kind: "blank" };
  newName: string;
  /** If provided, the assignment's binding is updated to point at the new
   *  clone. Used by "Clone & customize" on the assignment configure page. */
  bindToAssignment?: { canvasCourseId: string; canvasAssignmentId: string };
}): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  const nameErr = await nameIsForbidden(args.newName);
  if (nameErr) return { ok: false, error: nameErr };

  const admin = createAdminClient();

  // Resolve the source: preset gives us defaults to seed (preset id +
  // default_question_set_id); template gives us all the override fields;
  // blank gives an all-null starter.
  type SeedPayload = {
    personality_preset_id: string | null;
    question_set_id: string | null;
    persona_body: string | null;
    flow_body: string | null;
    opening_text: string | null;
    closing_text: string | null;
    live_voice_name: string | null;
    follow_up_depth: string | null;
    personalization_enabled: boolean | null;
    eval_prompt_body: string | null;
    rubric_body: string | null;
    intake_config: Json;
  };
  const BLANK_INTAKE: Json = {
    use_canvas_description: false,
    use_canvas_submission: false,
    attachments: [],
  };
  let seed: SeedPayload;

  if (args.source.kind === "blank") {
    seed = {
      personality_preset_id: null,
      question_set_id: null,
      persona_body: null,
      flow_body: null,
      opening_text: null,
      closing_text: null,
      live_voice_name: null,
      follow_up_depth: null,
      personalization_enabled: null,
      eval_prompt_body: null,
      rubric_body: null,
      intake_config: BLANK_INTAKE,
    };
  } else if (args.source.kind === "preset") {
    const { data: preset, error } = await admin
      .from("personality_presets")
      .select(
        "id, default_question_set_id, teacher_id, intake_config",
      )
      .eq("id", args.source.id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!preset) return { ok: false, error: "Default agent not found." };
    if (preset.teacher_id && preset.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "That agent isn't available to your account." };
    }
    seed = {
      personality_preset_id: preset.id as string,
      question_set_id: (preset.default_question_set_id as string | null) ?? null,
      persona_body: null,
      flow_body: null,
      opening_text: null,
      closing_text: null,
      live_voice_name: null,
      follow_up_depth: null,
      personalization_enabled: null,
      eval_prompt_body: null,
      rubric_body: null,
      intake_config: preset.intake_config as Json,
    };
  } else {
    const { data: tpl, error } = await admin
      .from("exam_templates")
      .select(
        "id, teacher_id, personality_preset_id, question_set_id, persona_body, flow_body, opening_text, closing_text, live_voice_name, follow_up_depth, personalization_enabled, eval_prompt_body, rubric_body, intake_config",
      )
      .eq("id", args.source.id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!tpl || tpl.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "Source template not found or not yours." };
    }
    seed = {
      personality_preset_id: tpl.personality_preset_id as string | null,
      question_set_id: tpl.question_set_id as string | null,
      persona_body: tpl.persona_body as string | null,
      flow_body: tpl.flow_body as string | null,
      opening_text: tpl.opening_text as string | null,
      closing_text: tpl.closing_text as string | null,
      live_voice_name: tpl.live_voice_name as string | null,
      follow_up_depth: tpl.follow_up_depth as string | null,
      personalization_enabled: tpl.personalization_enabled as boolean | null,
      eval_prompt_body: tpl.eval_prompt_body as string | null,
      rubric_body: tpl.rubric_body as string | null,
      intake_config: tpl.intake_config as Json,
    };
  }

  const { data: inserted, error: insErr } = await admin
    .from("exam_templates")
    .insert({
      teacher_id: auth.teacher.id,
      name: args.newName.trim(),
      ...seed,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return { ok: false, error: insErr?.message ?? "Insert failed." };
  }
  const templateId = inserted.id as string;

  // Optionally rebind a Canvas assignment to the new template. Only
  // allowed when the assignment ALREADY has a binding — that's the only
  // place the "clone & customize" affordance is surfaced (the picker on
  // the configure page, after the card is installed). Creating a fresh
  // binding here would let the caller route around the install-with-agent
  // dialog and produce an agent-without-card state.
  if (args.bindToAssignment) {
    const { canvasCourseId, canvasAssignmentId } = args.bindToAssignment;
    const { data: existingBinding } = await admin
      .from("exam_template_bindings")
      .select("exam_token")
      .eq("teacher_id", auth.teacher.id)
      .eq("canvas_assignment_id", canvasAssignmentId)
      .maybeSingle();
    if (!existingBinding) {
      return {
        ok: false,
        error:
          "Install the Canvas card with an agent first — clone-and-customize only swaps an existing binding, it doesn't create one.",
      };
    }
    const { error: upErr } = await admin
      .from("exam_template_bindings")
      .update({
        exam_template_id: templateId,
        personality_preset_id: null,
        canvas_course_id: canvasCourseId,
      })
      .eq("teacher_id", auth.teacher.id)
      .eq("canvas_assignment_id", canvasAssignmentId);
    if (upErr) return { ok: false, error: upErr.message };
    revalidatePath(
      `/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
    );
    revalidatePath("/dashboard");
  }

  revalidatePath(AGENTS_PATH);
  return { ok: true, templateId };
}

/**
 * Form-action wrapper around cloneAgentTemplate for the "+ New" form on
 * /dashboard/agents. Redirects to the editor on success.
 */
export async function createTemplateForm(formData: FormData): Promise<void> {
  const auth = await getTeacher();
  if (!auth) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  const sourceKind = String(formData.get("source_kind") ?? "");
  const sourceId = String(formData.get("source_id") ?? "");
  if (!name) throw new Error("Template name is required.");
  if (sourceKind !== "preset" && sourceKind !== "template" && sourceKind !== "blank") {
    throw new Error("Pick a source to clone from.");
  }
  if (sourceKind !== "blank" && !sourceId) {
    throw new Error("Source id missing.");
  }

  const source =
    sourceKind === "blank"
      ? ({ kind: "blank" } as const)
      : sourceKind === "preset"
        ? ({ kind: "preset", id: sourceId } as const)
        : ({ kind: "template", id: sourceId } as const);

  const r = await cloneAgentTemplate({ source, newName: name });
  if (!r.ok) throw new Error(r.error);
  redirect(`/dashboard/agents/templates/${r.templateId}/edit`);
}

// =========================================================================
// Bindings: which agent a Canvas assignment uses.
// =========================================================================

export async function setAssignmentAgent(args: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  agent: { kind: "preset"; id: string } | { kind: "template"; id: string } | null;
}): Promise<ActionResult> {
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };
  const admin = createAdminClient();

  if (!args.agent) {
    // Unassign: card and binding move together (the cards-without-agents
    // invariant runs both directions). Refuse the unassign if Canvas isn't
    // reachable — dropping the binding while leaving the card live would
    // route students to a 404'd /exam/<id>, exactly what we're avoiding.
    const canvas = await getCanvasConfigForTeacher();
    if (!canvas) {
      return {
        ok: false,
        error:
          "Reconnect Canvas before unassigning — the Canvas card has to come down with the agent, and we can't reach Canvas without a token.",
      };
    }
    try {
      const current = await getAssignment(
        canvas.config,
        args.canvasCourseId,
        args.canvasAssignmentId,
      );
      if (hasExamCardBlock(current.description ?? "", args.canvasAssignmentId)) {
        const nextDescription = removeExamCardBlock(
          current.description ?? "",
          args.canvasAssignmentId,
        );
        const updated = await updateAssignmentDescription(
          canvas.config,
          args.canvasCourseId,
          args.canvasAssignmentId,
          nextDescription,
        );
        await admin
          .from("canvas_assignment_cache")
          .upsert(
            {
              teacher_id: auth.teacher.id,
              canvas_assignment_id: args.canvasAssignmentId,
              canvas_course_id: args.canvasCourseId,
              payload: updated as unknown as Json,
              last_synced_at: new Date().toISOString(),
            },
            { onConflict: "teacher_id,canvas_assignment_id" },
          );
      }
    } catch (err) {
      if (err instanceof CanvasError) {
        return {
          ok: false,
          error: `Couldn't remove the Canvas card: ${err.message}. Try uninstalling manually from the assignment page.`,
        };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Card removal failed.",
      };
    }

    const { error } = await admin
      .from("exam_template_bindings")
      .delete()
      .eq("teacher_id", auth.teacher.id)
      .eq("canvas_assignment_id", args.canvasAssignmentId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(
      `/dashboard/courses/${args.canvasCourseId}/assignments/${args.canvasAssignmentId}`,
    );
    revalidatePath("/dashboard");
    revalidatePath(AGENTS_PATH);
    return { ok: true };
  }

  // Verify the agent is visible to this teacher (system preset OR own template).
  if (args.agent.kind === "template") {
    const { data: tpl } = await admin
      .from("exam_templates")
      .select("id, teacher_id")
      .eq("id", args.agent.id)
      .maybeSingle();
    if (!tpl || tpl.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "Template not found or not yours." };
    }
  } else {
    const { data: pre } = await admin
      .from("personality_presets")
      .select("id, teacher_id")
      .eq("id", args.agent.id)
      .maybeSingle();
    if (!pre) return { ok: false, error: "Default agent not found." };
    if (pre.teacher_id && pre.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "That agent isn't available to your account." };
    }
  }

  const { data: existing } = await admin
    .from("exam_template_bindings")
    .select("exam_token")
    .eq("teacher_id", auth.teacher.id)
    .eq("canvas_assignment_id", args.canvasAssignmentId)
    .maybeSingle();
  if (existing) {
    const patch =
      args.agent.kind === "template"
        ? { exam_template_id: args.agent.id, personality_preset_id: null }
        : { exam_template_id: null, personality_preset_id: args.agent.id };
    const { error } = await admin
      .from("exam_template_bindings")
      .update({ ...patch, canvas_course_id: args.canvasCourseId })
      .eq("teacher_id", auth.teacher.id)
      .eq("canvas_assignment_id", args.canvasAssignmentId);
    if (error) return { ok: false, error: error.message };
  } else {
    const examToken = randomBytes(8).toString("hex");
    const fields =
      args.agent.kind === "template"
        ? { exam_template_id: args.agent.id, personality_preset_id: null }
        : { exam_template_id: null, personality_preset_id: args.agent.id };
    const { error } = await admin.from("exam_template_bindings").insert({
      teacher_id: auth.teacher.id,
      canvas_course_id: args.canvasCourseId,
      canvas_assignment_id: args.canvasAssignmentId,
      exam_token: examToken,
      ...fields,
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(
    `/dashboard/courses/${args.canvasCourseId}/assignments/${args.canvasAssignmentId}`,
  );
  revalidatePath("/dashboard");
  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

// =========================================================================
// Install card + bind agent in one shot. Triggered by the install-with-agent
// dialog on the dashboard.
// =========================================================================

export async function installCardForAssignment(args: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  agent: { kind: "preset"; id: string } | { kind: "template"; id: string };
}): Promise<
  | { ok: true; binding: { kind: "preset" | "template"; id: string } }
  | { ok: false; error: string }
> {
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) return { ok: false, error: "Canvas token not configured." };

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";
  if (!appBaseUrl) {
    return { ok: false, error: "NEXT_PUBLIC_APP_URL not set." };
  }

  // Ownership check: don't trust the picker — re-verify the agent is
  // visible to this teacher. Mirrors setAssignmentAgent's check but happens
  // before any Canvas / DB writes so failures don't leave half-state.
  const admin = createAdminClient();
  if (args.agent.kind === "template") {
    const { data: tpl } = await admin
      .from("exam_templates")
      .select("id, teacher_id")
      .eq("id", args.agent.id)
      .maybeSingle();
    if (!tpl || tpl.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "Template not found or not yours." };
    }
  } else {
    const { data: pre } = await admin
      .from("personality_presets")
      .select("id, teacher_id")
      .eq("id", args.agent.id)
      .maybeSingle();
    if (!pre) return { ok: false, error: "Default agent not found." };
    if (pre.teacher_id && pre.teacher_id !== auth.teacher.id) {
      return { ok: false, error: "That agent isn't available to your account." };
    }
  }

  // Canvas write FIRST, binding row SECOND. Reviewer-flagged: doing them
  // in the other order leaves a phantom "agent assigned but no card" state
  // if Canvas PUT fails — exactly the inverse of the invariant we're
  // enforcing. If Canvas succeeds and the binding write fails (rare), the
  // teacher sees the card in Canvas but no binding in our cache; the
  // dashboard re-render shows the card with no agent label and the next
  // click re-runs binding (idempotent via primary key).
  let updatedAssignment;
  try {
    const current = await getAssignment(
      canvas.config,
      args.canvasCourseId,
      args.canvasAssignmentId,
    );
    const text = await resolveCardTextForTeacher(auth.teacher.id);
    const cardHtml = buildExamCardBlock({
      appBaseUrl,
      canvasAssignmentId: args.canvasAssignmentId,
      text,
    });
    const nextDescription = replaceOrAppendExamCardBlock(
      current.description ?? "",
      cardHtml,
      args.canvasAssignmentId,
    );
    updatedAssignment = await updateAssignmentDescription(
      canvas.config,
      args.canvasCourseId,
      args.canvasAssignmentId,
      nextDescription,
    );
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Install failed.",
    };
  }

  // Card is now live in Canvas. Upsert the binding + cache.
  const bound = await setAssignmentAgent({
    canvasCourseId: args.canvasCourseId,
    canvasAssignmentId: args.canvasAssignmentId,
    agent: args.agent,
  });
  if (!bound.ok) return bound;

  await admin
    .from("canvas_assignment_cache")
    .upsert(
      {
        teacher_id: auth.teacher.id,
        canvas_assignment_id: args.canvasAssignmentId,
        canvas_course_id: args.canvasCourseId,
        payload: updatedAssignment as unknown as Json,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "teacher_id,canvas_assignment_id" },
    );

  revalidatePath("/dashboard");
  revalidatePath(
    `/dashboard/courses/${args.canvasCourseId}/assignments/${args.canvasAssignmentId}`,
  );
  revalidatePath(AGENTS_PATH);
  return { ok: true, binding: args.agent };
}

// =========================================================================
// Template-only operations (rename / delete). Defaults aren't editable here.
// =========================================================================

export async function renameTemplate(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { ok: false, error: "Missing template id." };
  if (!name) return { ok: false, error: "Name can't be empty." };

  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  const supabase = await createServerSupabase();

  // Only run the default-name collision check if the name is actually
  // changing. Otherwise a teacher re-saving a row that was named before a
  // matching default was seeded would suddenly fail validation.
  const { data: existing } = await supabase
    .from("exam_templates")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  const currentName = (existing?.name as string | null)?.trim() ?? "";
  if (name !== currentName) {
    const nameErr = await nameIsForbidden(name);
    if (nameErr) return { ok: false, error: nameErr };
  }

  const { error } = await supabase
    .from("exam_templates")
    .update({ name })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  return { ok: true };
}

export async function deleteTemplate(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing template id." };

  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  // Find every assignment currently bound to this template and unassign
  // it first. setAssignmentAgent({agent:null}) also removes the Canvas
  // card — same invariant as everywhere else: cards and agents are paired,
  // so deleting a template that's in use leaves no orphan cards in Canvas.
  //
  // ORDER BY canvas_assignment_id makes the loop deterministic on retry:
  // if it bails partway through, the same prefix processes the same way
  // on the next click.
  const admin = createAdminClient();
  const { data: boundRows } = await admin
    .from("exam_template_bindings")
    .select("canvas_course_id, canvas_assignment_id")
    .eq("teacher_id", auth.teacher.id)
    .eq("exam_template_id", id)
    .order("canvas_assignment_id");
  const bindings = (boundRows ?? []) as {
    canvas_course_id: string;
    canvas_assignment_id: string;
  }[];
  const failures: string[] = [];
  let removed = 0;
  for (const b of bindings) {
    const r = await setAssignmentAgent({
      canvasCourseId: b.canvas_course_id,
      canvasAssignmentId: b.canvas_assignment_id,
      agent: null,
    });
    if (r.ok) removed++;
    else failures.push(`${b.canvas_assignment_id}: ${r.error}`);
  }
  if (failures.length > 0) {
    const removedNote =
      removed > 0
        ? `Removed ${removed} of ${bindings.length} Canvas card${bindings.length === 1 ? "" : "s"} first; `
        : "";
    return {
      ok: false,
      error: `${removedNote}${failures.length} failed: ${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? "…" : ""}`,
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("exam_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(AGENTS_PATH);
  revalidatePath("/dashboard");
  return { ok: true };
}
