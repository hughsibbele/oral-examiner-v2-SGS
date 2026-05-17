import Link from "next/link";
import { notFound } from "next/navigation";
import { hasExamCardMarkerBlock } from "@oral-examiner/canvas";
import { createServerSupabase } from "@/lib/supabase/server";
import { InstallCardButton } from "../../InstallCardButton";
import { ClonePresetButton } from "./ClonePresetButton";
import { ChangeAgentButton } from "./ChangeAgentButton";

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
  default_question_set_id: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  exam_token: string;
  personality_preset_id: string | null;
  question_set_id: string | null;
  persona_body: string | null;
};

export default async function AssignmentConfigurePage({
  params,
}: {
  params: Promise<{ id: string; aid: string }>;
}) {
  const { id: canvasCourseId, aid: canvasAssignmentId } = await params;
  const supabase = await createServerSupabase();

  const { data: assignmentRow } = await supabase
    .from("canvas_assignment_cache")
    .select("payload")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (!assignmentRow) notFound();
  const assignment = assignmentRow.payload as unknown as AssignmentPayload;

  const installed = hasExamCardMarkerBlock(assignment.description ?? "");

  const { data: presetRows } = await supabase
    .from("personality_presets")
    .select("id, name, description, default_question_set_id")
    .is("teacher_id", null)
    .order("name");
  const presets = (presetRows ?? []) as unknown as PresetRow[];

  const { data: templateRow } = await supabase
    .from("exam_templates")
    .select("id, name, exam_token, personality_preset_id, question_set_id, persona_body")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  const template = (templateRow as unknown as TemplateRow | null) ?? null;
  const activePresetId = template?.personality_preset_id ?? null;
  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/courses/${canvasCourseId}`}
          className="muted text-sm"
        >
          ← Course
        </Link>
        <h1 className="heading text-2xl mt-2">{assignment.name}</h1>
        <p className="muted text-sm mt-1">
          Canvas assignment {canvasAssignmentId}
        </p>
      </div>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-lg">Canvas card</h2>
          <InstallCardButton
            canvasCourseId={canvasCourseId}
            canvasAssignmentId={canvasAssignmentId}
            installed={installed}
          />
        </div>
        <p className="text-sm muted">
          {installed
            ? "The branded EHS oral-exam card is in this assignment's description. Students click it to land on the exam."
            : "Install paints a branded card into the Canvas assignment description; re-install is idempotent."}
        </p>
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="heading text-lg">Examiner agent</h2>
          {template && (
            <span className="text-xs muted">
              Template {template.exam_token.slice(0, 8)}…
            </span>
          )}
        </div>

        {template && activePreset ? (
          <div className="space-y-3">
            <p className="text-sm">
              Configured as <strong>{activePreset.name}</strong>.
              {template.persona_body
                ? " Persona has teacher overrides."
                : " Persona falls back to the system default."}
            </p>
            <p className="muted text-xs">
              Per-template prose editing ships in M2b.5b. For now, this
              assignment runs with the system agent&rsquo;s persona, flow,
              voice, opening, closing, and question set.
            </p>
            <div className="border-t border-rule pt-3">
              <p className="text-sm font-medium mb-2">Switch to a different agent</p>
              <div className="grid gap-2">
                {presets
                  .filter((p) => p.id !== activePresetId)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-baseline justify-between gap-4 p-2 rounded border border-rule"
                    >
                      <div>
                        <div className="font-medium text-sm">{p.name}</div>
                        {p.description && (
                          <div className="muted text-xs mt-0.5">{p.description}</div>
                        )}
                      </div>
                      <ChangeAgentButton
                        canvasCourseId={canvasCourseId}
                        canvasAssignmentId={canvasAssignmentId}
                        presetId={p.id}
                        presetName={p.name}
                      />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Pick a system agent to run this oral exam. You can switch
              agents later, and (once M2b.5b ships) override the persona,
              flow, opening, closing, and question set per-template.
            </p>
            <div className="grid gap-3">
              {presets.length === 0 ? (
                <p className="muted text-xs">
                  No personality presets are seeded. Run the migrations.
                </p>
              ) : (
                presets.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-baseline justify-between gap-4 p-3 rounded border border-rule"
                  >
                    <div>
                      <div className="font-medium">{p.name}</div>
                      {p.description && (
                        <div className="muted text-xs mt-0.5">{p.description}</div>
                      )}
                    </div>
                    <ClonePresetButton
                      canvasCourseId={canvasCourseId}
                      canvasAssignmentId={canvasAssignmentId}
                      presetId={p.id}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
