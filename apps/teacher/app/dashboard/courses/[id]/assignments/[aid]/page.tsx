import Link from "next/link";
import { notFound } from "next/navigation";
import { hasExamCardBlock } from "@oral-examiner/canvas";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import { resolveCardTextForTeacher } from "@/lib/card-text/resolve";
import { InstallCardButton } from "../../InstallCardButton";
import { CardPreview } from "./CardPreview";
import { SessionsList } from "./SessionsList";
import {
  TemplatePicker,
  type AgentOption,
  type CurrentBinding,
} from "./TemplatePicker";

function readAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

type AssignmentPayload = {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
};

type PresetRow = {
  id: string;
  name: string;
  description: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  personality_preset_id: string | null;
  persona_body: string | null;
  flow_body: string | null;
  opening_text: string | null;
  closing_text: string | null;
  live_voice_name: string | null;
  follow_up_depth: string | null;
  personalization_enabled: boolean | null;
  eval_prompt_body: string | null;
  rubric_body: string | null;
};

type BindingRow = {
  exam_template_id: string | null;
  personality_preset_id: string | null;
  exam_token: string;
};

export default async function AssignmentConfigurePage({
  params,
}: {
  params: Promise<{ id: string; aid: string }>;
}) {
  const auth = await getTeacher();
  const { id: canvasCourseId, aid: canvasAssignmentId } = await params;
  const supabase = await createServerSupabase();
  const cardText = auth
    ? await resolveCardTextForTeacher(auth.teacher.id)
    : undefined;

  const { data: assignmentRow } = await supabase
    .from("canvas_assignment_cache")
    .select("payload")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (!assignmentRow) notFound();
  const assignment = assignmentRow.payload as unknown as AssignmentPayload;

  const installed = hasExamCardBlock(
    assignment.description ?? "",
    canvasAssignmentId,
  );

  const [presetsRes, templatesRes, bindingRes] = await Promise.all([
    supabase
      .from("personality_presets")
      .select("id, name, description")
      .is("teacher_id", null)
      .order("name"),
    supabase
      .from("exam_templates")
      .select(
        "id, name, personality_preset_id, persona_body, flow_body, opening_text, closing_text, live_voice_name, follow_up_depth, personalization_enabled, eval_prompt_body, rubric_body",
      )
      .order("name"),
    supabase
      .from("exam_template_bindings")
      .select("exam_template_id, personality_preset_id, exam_token")
      .eq("canvas_assignment_id", canvasAssignmentId)
      .maybeSingle(),
  ]);
  const presets = (presetsRes.data ?? []) as PresetRow[];
  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const binding = bindingRes.data as unknown as BindingRow | null;

  const presetNameById = new Map(presets.map((p) => [p.id, p.name]));

  const options: AgentOption[] = [
    ...presets.map(
      (p): AgentOption => ({
        kind: "preset",
        id: p.id,
        name: p.name,
        description: p.description,
      }),
    ),
    ...templates.map(
      (t): AgentOption => ({
        kind: "template",
        id: t.id,
        name: t.name,
        presetName: t.personality_preset_id
          ? presetNameById.get(t.personality_preset_id) ?? null
          : null,
        overrideCount: countOverrides(t),
      }),
    ),
  ];

  let current: CurrentBinding = null;
  if (binding?.exam_template_id) {
    const t = templates.find((x) => x.id === binding.exam_template_id);
    if (t) {
      current = {
        kind: "template",
        templateId: t.id,
        templateName: t.name,
        presetName: t.personality_preset_id
          ? presetNameById.get(t.personality_preset_id) ?? null
          : null,
        overrideCount: countOverrides(t),
      };
    }
  } else if (binding?.personality_preset_id) {
    const name = presetNameById.get(binding.personality_preset_id);
    if (name) {
      current = {
        kind: "preset",
        presetId: binding.personality_preset_id,
        presetName: name,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="muted text-sm">
          ← Dashboard
        </Link>
        <h1 className="heading text-2xl mt-2">{assignment.name}</h1>
        <p className="muted text-sm mt-1">Canvas assignment {canvasAssignmentId}</p>
      </div>

      <section className="bg-white border border-light-blue rounded p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-lg">Agent template</h2>
          {binding && (
            <span className="text-xs muted">
              Student URL: <code>/exam/{binding.exam_token.slice(0, 8)}…</code>
            </span>
          )}
        </div>

        <TemplatePicker
          canvasCourseId={canvasCourseId}
          canvasAssignmentId={canvasAssignmentId}
          options={options}
          current={current}
          defaultNames={presets.map((p) => p.name)}
        />
      </section>

      {current && (
        <section className="bg-white border border-stone-200 rounded p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Preview this agent</p>
            <p className="text-xs muted mt-0.5">
              Run a live Gemini conversation as if you were the student (burns
              ~$0.17 per session).
            </p>
          </div>
          <Link
            href={
              current.kind === "template"
                ? `/dashboard/agents/templates/${current.templateId}/try`
                : `/dashboard/agents/${current.presetId}/try`
            }
            className="rounded border border-maroon px-3 py-1.5 text-xs font-medium text-maroon hover:bg-maroon hover:text-white transition-colors"
          >
            Try it out →
          </Link>
        </section>
      )}

      <section className="bg-white border border-light-blue rounded p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="heading text-lg">Canvas card</h2>
          <InstallCardButton
            canvasCourseId={canvasCourseId}
            canvasAssignmentId={canvasAssignmentId}
            installed={installed}
            agentAssigned={current !== null}
          />
        </div>
        <p className="text-sm muted">
          {installed
            ? "The branded EHS oral-exam card is in this assignment's description. Students click it to land on the exam."
            : "Installs a branded card into the Canvas assignment description; re-install is idempotent. Card and agent are paired — uninstalling removes both."}
        </p>
        <CardPreview
          appBaseUrl={readAppBaseUrl()}
          canvasAssignmentId={canvasAssignmentId}
          text={cardText}
        />
      </section>

      <SessionsList
        canvasCourseId={canvasCourseId}
        canvasAssignmentId={canvasAssignmentId}
      />
    </div>
  );
}

function countOverrides(t: TemplateRow): number {
  let n = 0;
  if (t.persona_body !== null) n++;
  if (t.flow_body !== null) n++;
  if (t.opening_text !== null) n++;
  if (t.closing_text !== null) n++;
  if (t.live_voice_name !== null) n++;
  if (t.follow_up_depth !== null) n++;
  if (t.personalization_enabled !== null) n++;
  if (t.eval_prompt_body !== null) n++;
  if (t.rubric_body !== null) n++;
  return n;
}
