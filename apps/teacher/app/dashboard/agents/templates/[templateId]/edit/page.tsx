import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import { parseIntakeConfig } from "@/lib/intake/types";
import type { Json } from "@oral-examiner/db";
import { getTemplateIntakeTotalCapBytes } from "./actions";
import { TemplateEditor, type TemplateEditorData } from "./TemplateEditor";

type FollowUpDepth = "light" | "medium" | "deep";

type TemplateRow = {
  id: string;
  teacher_id: string;
  name: string;
  personality_preset_id: string | null;
  question_set_id: string | null;
  persona_body: string | null;
  flow_body: string | null;
  follow_up_depth: FollowUpDepth | null;
  personalization_enabled: boolean | null;
  eval_prompt_body: string | null;
  rubric_body: string | null;
  live_voice_name: string | null;
  opening_text: string | null;
  closing_text: string | null;
  intake_config: Json;
  locked_at: string | null;
  updated_at: string;
};

type PresetRow = {
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
  intake_config: Json;
};

type QSetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  updated_at: string;
};

type AvailableSetRow = QSetRow;

type BucketRow = {
  id: string;
  question_set_id: string;
  name: string;
  position: number;
  select_count: number;
};

type QuestionRow = {
  id: string;
  question_bucket_id: string;
  position: number;
  text: string;
  reference_snippet: string | null;
};

type BindingRow = {
  canvas_course_id: string;
  canvas_assignment_id: string;
  exam_token: string;
};

type CoursePayload = { name?: string };
type AssignmentPayload = { name?: string };

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const auth = await getTeacher();
  if (!auth) redirect("/login");
  const { templateId } = await params;
  const supabase = await createServerSupabase();

  // RLS scopes by teacher_id; if missing, the row's not ours.
  const { data: templateData, error: templateErr } = await supabase
    .from("exam_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (templateErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load template: {templateErr.message}</p>
      </div>
    );
  }
  if (!templateData) notFound();
  const template = templateData as unknown as TemplateRow;
  const intakeCapBytes = await getTemplateIntakeTotalCapBytes();

  const { data: presetData } = template.personality_preset_id
    ? await supabase
        .from("personality_presets")
        .select(
          "id, name, description, persona_body, flow_body, follow_up_depth, personalization_enabled, eval_prompt_body, rubric_body, live_voice_name, opening_text, closing_text, intake_config",
        )
        .eq("id", template.personality_preset_id)
        .maybeSingle()
    : { data: null };
  const preset = (presetData as unknown as PresetRow | null) ?? null;

  const { data: qsetData } = template.question_set_id
    ? await supabase
        .from("question_sets")
        .select("id, teacher_id, name, description, updated_at")
        .eq("id", template.question_set_id)
        .maybeSingle()
    : { data: null };
  const qset = (qsetData as unknown as QSetRow | null) ?? null;

  // Available sets for the M2b.5b.5 picker: every system set + every set
  // this teacher owns. RLS already scopes the read, but we ask for both
  // shapes explicitly so the optgroups in the picker render correctly.
  const { data: availableSetsData } = await supabase
    .from("question_sets")
    .select("id, teacher_id, name, description, updated_at")
    .or(`teacher_id.is.null,teacher_id.eq.${template.teacher_id}`)
    .order("name");
  const availableSets =
    (availableSetsData as unknown as AvailableSetRow[] | null) ?? [];

  // How many templates reference the current set? Drives the "shared across
  // X templates" warning in the picker + (later) the inline editor.
  let sharedAcrossTemplates = 0;
  if (qset) {
    const { count } = await supabase
      .from("exam_templates")
      .select("id", { count: "exact", head: true })
      .eq("question_set_id", qset.id)
      .eq("teacher_id", template.teacher_id);
    sharedAcrossTemplates = count ?? 0;
  }

  let buckets: BucketRow[] = [];
  let questions: QuestionRow[] = [];
  if (qset) {
    const { data: bucketsData } = await supabase
      .from("question_buckets")
      .select("*")
      .eq("question_set_id", qset.id)
      .order("position");
    buckets = (bucketsData as unknown as BucketRow[] | null) ?? [];
    if (buckets.length > 0) {
      const { data: questionsData } = await supabase
        .from("questions")
        .select("*")
        .in("question_bucket_id", buckets.map((b) => b.id))
        .order("position");
      questions = (questionsData as unknown as QuestionRow[] | null) ?? [];
    }
  }
  const questionsByBucket: Record<string, QuestionRow[]> = {};
  for (const b of buckets) questionsByBucket[b.id] = [];
  for (const q of questions) {
    (questionsByBucket[q.question_bucket_id] ??= []).push(q);
  }

  // Bindings: which Canvas assignments use this template?
  const { data: bindingsData } = await supabase
    .from("exam_template_bindings")
    .select("canvas_course_id, canvas_assignment_id, exam_token")
    .eq("exam_template_id", templateId);
  const bindings = (bindingsData as unknown as BindingRow[] | null) ?? [];

  // Names for the bound-assignments list
  const assignmentIds = bindings.map((b) => b.canvas_assignment_id);
  const courseIds = Array.from(new Set(bindings.map((b) => b.canvas_course_id)));
  const [assignmentCache, courseCache] = await Promise.all([
    assignmentIds.length > 0
      ? supabase
          .from("canvas_assignment_cache")
          .select("canvas_assignment_id, canvas_course_id, payload")
          .in("canvas_assignment_id", assignmentIds)
      : Promise.resolve({ data: [] }),
    courseIds.length > 0
      ? supabase
          .from("canvas_course_cache")
          .select("canvas_course_id, payload")
          .in("canvas_course_id", courseIds)
      : Promise.resolve({ data: [] }),
  ]);
  const assignmentNameById = new Map<string, string>(
    ((assignmentCache.data ?? []) as { canvas_assignment_id: string; payload: AssignmentPayload }[])
      .map((a) => [a.canvas_assignment_id, a.payload?.name ?? a.canvas_assignment_id]),
  );
  const courseNameById = new Map<string, string>(
    ((courseCache.data ?? []) as { canvas_course_id: string; payload: CoursePayload }[])
      .map((c) => [c.canvas_course_id, c.payload?.name ?? c.canvas_course_id]),
  );

  const data: TemplateEditorData = {
    template: {
      id: template.id,
      name: template.name,
      updated_at: template.updated_at,
      persona_body: template.persona_body,
      flow_body: template.flow_body,
      follow_up_depth: template.follow_up_depth,
      personalization_enabled: template.personalization_enabled,
      eval_prompt_body: template.eval_prompt_body,
      rubric_body: template.rubric_body,
      live_voice_name: template.live_voice_name,
      opening_text: template.opening_text,
      closing_text: template.closing_text,
      intake_config: parseIntakeConfig(template.intake_config),
    },
    preset: preset
      ? {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          persona_body: preset.persona_body,
          flow_body: preset.flow_body,
          follow_up_depth: preset.follow_up_depth,
          personalization_enabled: preset.personalization_enabled,
          eval_prompt_body: preset.eval_prompt_body,
          rubric_body: preset.rubric_body,
          live_voice_name: preset.live_voice_name,
          opening_text: preset.opening_text,
          closing_text: preset.closing_text,
          intake_config: parseIntakeConfig(preset.intake_config),
        }
      : null,
    qset,
    buckets,
    questionsByBucket,
    availableSets,
    sharedAcrossTemplates,
    bindings: bindings.map((b) => ({
      canvas_course_id: b.canvas_course_id,
      canvas_assignment_id: b.canvas_assignment_id,
      exam_token: b.exam_token,
      assignment_name: assignmentNameById.get(b.canvas_assignment_id) ?? null,
      course_name: courseNameById.get(b.canvas_course_id) ?? null,
    })),
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/agents" className="muted text-sm">
          ← Agent hub
        </Link>
        <h1 className="heading text-2xl mt-2">{template.name}</h1>
        <p className="muted text-sm mt-1">
          {preset ? (
            <>
              Based on <strong>{preset.name}</strong>. Each field below
              inherits from the preset by default — typing overrides just
              that field; the &ldquo;reset to default&rdquo; link clears it.
            </>
          ) : (
            <>Blank-slate template — fill in persona, flow, and eval below.</>
          )}
        </p>
        <p className="muted text-xs mt-2">
          {bindings.length === 0
            ? "Not yet attached to any Canvas assignment. Open an assignment from your dashboard and pick this template."
            : `Attached to ${bindings.length} Canvas assignment${bindings.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      <TemplateEditor data={data} intakeCapBytes={intakeCapBytes} />
    </div>
  );
}
