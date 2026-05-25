import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import { NewCustomTemplateForm } from "./NewCustomTemplateForm";
import { CustomTemplateRow } from "./CustomTemplateRow";
import { DefaultAgentCard } from "./DefaultAgentCard";

type PresetRow = {
  id: string;
  name: string;
  description: string | null;
  live_voice_name: string | null;
  rubric_body: string | null;
  default_question_set_id: string | null;
};

type BucketRow = { id: string; question_set_id: string; select_count: number };
type QuestionCountRow = { question_bucket_id: string };

type TemplateRowDB = {
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
  updated_at: string;
};

type BindingDB = {
  exam_template_id: string | null;
  personality_preset_id: string | null;
  canvas_course_id: string;
  canvas_assignment_id: string;
};

type CoursePayload = { name?: string };
type AssignmentPayload = { name?: string };

/**
 * Agent Templates hub (M2b.5b dashboard refactor v2, 2026-05-18).
 *
 * Layout:
 *   1. **Default agent templates** — the 4 system presets. Read-only.
 *      "Clone & customize" forces a new name and creates a teacher-owned
 *      template seeded from the preset.
 *   2. **Your custom templates** — teacher-owned exam_templates rows. These
 *      are the rows the teacher consciously cloned + named. Editable.
 *      Defaults are NOT here.
 *   3. **+ New custom template** — pick a source (default or another
 *      custom) + required new name (rejected if it matches any default).
 */
export default async function AgentTemplatesPage() {
  const ctx = await getTeacher();
  if (!ctx) return null;
  const supabase = await createServerSupabase();

  const [presetsRes, templatesRes, bindingsRes] = await Promise.all([
    supabase
      .from("personality_presets")
      .select(
        "id, name, description, live_voice_name, rubric_body, default_question_set_id",
      )
      .is("teacher_id", null)
      .order("name"),
    supabase
      .from("exam_templates")
      .select(
        "id, name, personality_preset_id, persona_body, flow_body, opening_text, closing_text, live_voice_name, follow_up_depth, personalization_enabled, eval_prompt_body, rubric_body, updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("exam_template_bindings")
      .select(
        "exam_template_id, personality_preset_id, canvas_course_id, canvas_assignment_id",
      ),
  ]);
  if (presetsRes.error) {
    return (
      <div className="bg-white border border-light-blue rounded p-5">
        <h1 className="heading text-2xl mb-2">Agent Templates</h1>
        <p className="text-sm">
          Failed to load defaults: {presetsRes.error.message}
        </p>
      </div>
    );
  }
  const presets = (presetsRes.data ?? []) as PresetRow[];
  const templates = (templatesRes.data ?? []) as TemplateRowDB[];
  const bindings = (bindingsRes.data ?? []) as BindingDB[];

  // Question-set summary per default preset
  const qsetIds = presets
    .map((a) => a.default_question_set_id)
    .filter((x): x is string => !!x);
  const { data: bucketsData } =
    qsetIds.length > 0
      ? await supabase
          .from("question_buckets")
          .select("id, question_set_id, select_count")
          .in("question_set_id", qsetIds)
      : { data: [] };
  const buckets = (bucketsData ?? []) as BucketRow[];
  const bucketIds = buckets.map((b) => b.id);
  const { data: qCounts } =
    bucketIds.length > 0
      ? await supabase
          .from("questions")
          .select("question_bucket_id")
          .in("question_bucket_id", bucketIds)
      : { data: [] };
  const bucketToSet = new Map(buckets.map((b) => [b.id, b.question_set_id]));
  const setQuestionCount = new Map<string, number>();
  for (const q of (qCounts ?? []) as QuestionCountRow[]) {
    const setId = bucketToSet.get(q.question_bucket_id);
    if (!setId) continue;
    setQuestionCount.set(setId, (setQuestionCount.get(setId) ?? 0) + 1);
  }
  const selectCountBySet = new Map<string, number>();
  for (const b of buckets) {
    selectCountBySet.set(
      b.question_set_id,
      (selectCountBySet.get(b.question_set_id) ?? 0) + b.select_count,
    );
  }

  // Binding counts: how many Canvas assignments use each preset / template?
  const bindingsByPreset = new Map<string, BindingDB[]>();
  const bindingsByTemplate = new Map<string, BindingDB[]>();
  for (const b of bindings) {
    if (b.exam_template_id) {
      const list = bindingsByTemplate.get(b.exam_template_id) ?? [];
      list.push(b);
      bindingsByTemplate.set(b.exam_template_id, list);
    } else if (b.personality_preset_id) {
      const list = bindingsByPreset.get(b.personality_preset_id) ?? [];
      list.push(b);
      bindingsByPreset.set(b.personality_preset_id, list);
    }
  }

  // Name caches for the binding lists in expanded rows.
  const courseIds = Array.from(new Set(bindings.map((b) => b.canvas_course_id)));
  const assignmentIds = Array.from(
    new Set(bindings.map((b) => b.canvas_assignment_id)),
  );
  const [courseCache, assignmentCache] = await Promise.all([
    courseIds.length > 0
      ? supabase
          .from("canvas_course_cache")
          .select("canvas_course_id, payload")
          .in("canvas_course_id", courseIds)
      : Promise.resolve({ data: [] }),
    assignmentIds.length > 0
      ? supabase
          .from("canvas_assignment_cache")
          .select("canvas_assignment_id, payload")
          .in("canvas_assignment_id", assignmentIds)
      : Promise.resolve({ data: [] }),
  ]);
  const courseNameById = new Map<string, string>(
    ((courseCache.data ?? []) as { canvas_course_id: string; payload: CoursePayload }[])
      .map((c) => [c.canvas_course_id, c.payload?.name ?? c.canvas_course_id]),
  );
  const assignmentNameById = new Map<string, string>(
    ((assignmentCache.data ?? []) as { canvas_assignment_id: string; payload: AssignmentPayload }[])
      .map((a) => [a.canvas_assignment_id, a.payload?.name ?? a.canvas_assignment_id]),
  );

  const presetNameById = new Map(presets.map((p) => [p.id, p.name]));

  const sourceOptions: {
    kind: "preset" | "template" | "blank";
    id: string;
    label: string;
  }[] = [
    ...presets.map((p) => ({
      kind: "preset" as const,
      id: p.id,
      label: `Default ${p.name}`,
    })),
    ...templates.map((t) => ({
      kind: "template" as const,
      id: t.id,
      label: `Clone of ${t.name}`,
    })),
    {
      kind: "blank",
      id: "",
      label: "Start from scratch (blank slate — write everything)",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="heading text-2xl">Agent Templates</h1>
        <p className="muted text-sm mt-1">
          Defaults are maintained by school admins and used by assignments
          out-of-the-box. To customize, clone one into a custom template — you
          must give your custom a different name.
        </p>
      </div>

      {/* New custom template */}
      <section className="bg-white border border-light-blue rounded p-5">
        <h2 className="heading text-lg mb-2">+ New custom template</h2>
        <NewCustomTemplateForm
          sources={sourceOptions}
          defaultNames={presets.map((p) => p.name)}
        />
      </section>

      {/* Your custom templates */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="heading text-lg">Your custom templates</h2>
          <span className="muted text-xs">
            Per-customization, not per-assignment. Apply to assignments from{" "}
            <Link href="/dashboard" className="text-maroon no-underline hover:underline">
              your courses
            </Link>
            .
          </span>
        </div>

        {templates.length === 0 ? (
          <div className="rounded border border-light-blue bg-white p-5 text-sm muted">
            No custom templates yet. Clone a default above to start customizing.
          </div>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => {
              const overrides = countOverrides(t);
              const tplBindings = bindingsByTemplate.get(t.id) ?? [];
              return (
                <CustomTemplateRow
                  key={t.id}
                  template={{
                    id: t.id,
                    name: t.name,
                    presetName: t.personality_preset_id
                      ? presetNameById.get(t.personality_preset_id) ?? null
                      : null,
                    overrideCount: overrides,
                  }}
                  bindings={tplBindings.map((b) => ({
                    canvas_course_id: b.canvas_course_id,
                    canvas_assignment_id: b.canvas_assignment_id,
                    course_name: courseNameById.get(b.canvas_course_id) ?? null,
                    assignment_name: assignmentNameById.get(b.canvas_assignment_id) ?? null,
                  }))}
                />
              );
            })}
          </ul>
        )}
      </section>

      {/* Default agent templates */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="heading text-lg">Default agent templates</h2>
          <span className="muted text-xs">
            Admin-maintained. Read-only — clone to customize.
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {presets.map((p) => {
            const totalQs = p.default_question_set_id
              ? setQuestionCount.get(p.default_question_set_id) ?? 0
              : 0;
            const totalSelected = p.default_question_set_id
              ? selectCountBySet.get(p.default_question_set_id) ?? 0
              : 0;
            return (
              <DefaultAgentCard
                key={p.id}
                preset={{
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  live_voice_name: p.live_voice_name,
                  ungraded: !p.rubric_body,
                  totalQuestions: totalQs,
                  totalSelected,
                }}
                inUseCount={(bindingsByPreset.get(p.id) ?? []).length}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function countOverrides(t: TemplateRowDB): number {
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
