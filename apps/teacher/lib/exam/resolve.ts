// M2b.5c.2 — binding + student resolution for /exam/[token].
//
// Uses the service-role admin client because the recursion-fix migration
// (20260518021328) dropped the only student-RLS path on exam_templates.
// See apps/teacher/lib/supabase/admin.ts for the rationale.

import { anonToken, readSaltFromEnv } from "@oral-examiner/anonymizer";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@oral-examiner/db";

type Preset = Database["public"]["Tables"]["personality_presets"]["Row"];
type Template = Database["public"]["Tables"]["exam_templates"]["Row"];

export type ResolvedBinding = {
  teacher_id: string;
  canvas_course_id: string;
  canvas_assignment_id: string;
  exam_template_id: string | null;
  personality_preset_id: string | null;
  exam_token: string;
};

export type ResolvedStudent = {
  id: string;
  canvas_user_id: string;
  email: string;
  display_name: string;
  anon_token: string;
};

export type ResolvedAgent =
  | { kind: "preset"; preset: Preset }
  | { kind: "template"; template: Template; preset: Preset | null };

export type ExamResolution =
  | { kind: "no_binding" }
  | { kind: "no_agent" }
  | { kind: "not_on_roster" }
  | {
      kind: "ok";
      binding: ResolvedBinding;
      student: ResolvedStudent;
      agent: ResolvedAgent;
      assignmentTitle: string | null;
    };

type RosterStudent = {
  canvas_user_id: string;
  display_name: string;
  email: string;
  anon_token: string;
};

/**
 * Resolve everything `/exam/[token]` needs to render the ready screen + later
 * create an exam_sessions row.
 *
 * Failure modes are discriminated rather than thrown so the page handler can
 * render the right error UI (no binding → "teacher hasn't configured yet";
 * not on roster → "you're not enrolled"). Throws only for true system errors
 * (missing env, DB failures, anonymizer salt unset) since those want a 500.
 */
export async function resolveExamContext({
  canvasAssignmentId,
  studentEmail,
  studentAuthUserId,
}: {
  canvasAssignmentId: string;
  studentEmail: string;
  studentAuthUserId: string;
}): Promise<ExamResolution> {
  const admin = createAdminClient();
  const lowerEmail = studentEmail.toLowerCase();

  const { data: bindingRow, error: bindingErr } = await admin
    .from("exam_template_bindings")
    .select(
      "teacher_id, canvas_course_id, canvas_assignment_id, exam_template_id, personality_preset_id, exam_token",
    )
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();

  if (bindingErr) {
    throw new Error(`Binding lookup failed: ${bindingErr.message}`);
  }
  if (!bindingRow) {
    return { kind: "no_binding" };
  }

  const binding: ResolvedBinding = bindingRow;

  // CHECK constraint on the bindings table enforces exactly-one-of, but the
  // types from the generator allow both null so we re-narrow here.
  if (!binding.exam_template_id && !binding.personality_preset_id) {
    return { kind: "no_agent" };
  }

  const { data: roster, error: rosterErr } = await admin
    .from("course_rosters")
    .select("students")
    .eq("teacher_id", binding.teacher_id)
    .eq("canvas_course_id", binding.canvas_course_id)
    .maybeSingle();

  if (rosterErr) {
    throw new Error(`Roster lookup failed: ${rosterErr.message}`);
  }
  if (!roster) {
    return { kind: "not_on_roster" };
  }

  const rosterStudents = (roster.students as RosterStudent[]) ?? [];
  const rosterMatch = rosterStudents.find(
    (s) => s.email?.toLowerCase() === lowerEmail,
  );
  if (!rosterMatch) {
    return { kind: "not_on_roster" };
  }

  // Defense in depth: the roster jsonb carries a pre-computed anon_token
  // from the most recent roster sync, but salt rotation or roster drift
  // could make it stale. Recompute and prefer the live value; warn (not
  // fail) if they diverge so future maintenance has a breadcrumb.
  const salt = readSaltFromEnv();
  const liveAnonToken = anonToken(
    rosterMatch.canvas_user_id,
    rosterMatch.email,
    salt,
  );
  if (liveAnonToken !== rosterMatch.anon_token) {
    console.warn(
      `[resolveExamContext] anon_token drift for canvas_user_id=${rosterMatch.canvas_user_id}: roster=${rosterMatch.anon_token} live=${liveAnonToken}. Using live value.`,
    );
  }

  // Upsert the canonical students row. The roster-sync flow seeds it already,
  // but cover the case where a student signs in to an exam before the
  // teacher's latest roster sync flushed into students. Also opportunistically
  // link auth_user_id on every student sign-in so future RLS paths can join.
  const { data: studentRow, error: studentErr } = await admin
    .from("students")
    .upsert(
      {
        canvas_user_id: rosterMatch.canvas_user_id,
        email: rosterMatch.email,
        display_name: rosterMatch.display_name,
        anon_token: liveAnonToken,
        auth_user_id: studentAuthUserId,
      },
      { onConflict: "canvas_user_id" },
    )
    .select("id, canvas_user_id, email, display_name, anon_token")
    .single();

  if (studentErr || !studentRow) {
    throw new Error(
      `Students upsert failed: ${studentErr?.message ?? "no row returned"}`,
    );
  }

  const agent = await loadAgent(admin, binding);

  const { data: assignmentCache } = await admin
    .from("canvas_assignment_cache")
    .select("payload")
    .eq("teacher_id", binding.teacher_id)
    .eq("canvas_assignment_id", binding.canvas_assignment_id)
    .maybeSingle();

  const assignmentTitle =
    extractAssignmentTitle(assignmentCache?.payload ?? null) ?? null;

  return {
    kind: "ok",
    binding,
    student: studentRow as ResolvedStudent,
    agent,
    assignmentTitle,
  };
}

async function loadAgent(
  admin: ReturnType<typeof createAdminClient>,
  binding: ResolvedBinding,
): Promise<ResolvedAgent> {
  if (binding.exam_template_id) {
    const { data: template, error: tErr } = await admin
      .from("exam_templates")
      .select("*")
      .eq("id", binding.exam_template_id)
      .single();
    if (tErr || !template) {
      throw new Error(
        `Template load failed: ${tErr?.message ?? "no row returned"}`,
      );
    }
    let preset: Preset | null = null;
    if (template.personality_preset_id) {
      const { data: p } = await admin
        .from("personality_presets")
        .select("*")
        .eq("id", template.personality_preset_id)
        .maybeSingle();
      preset = (p as Preset) ?? null;
    }
    return { kind: "template", template: template as Template, preset };
  }

  // Preset-direct binding.
  const { data: preset, error: pErr } = await admin
    .from("personality_presets")
    .select("*")
    .eq("id", binding.personality_preset_id!)
    .single();
  if (pErr || !preset) {
    throw new Error(
      `Preset load failed: ${pErr?.message ?? "no row returned"}`,
    );
  }
  return { kind: "preset", preset: preset as Preset };
}

function extractAssignmentTitle(payload: Json | null): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const name = (payload as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}
