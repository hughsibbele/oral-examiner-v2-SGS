import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import { selectQuestionsForSet } from "@/lib/runtime/select-questions";
import { assembleSystemPrompt } from "@/lib/runtime/assemble-prompt";
import { TryItOut } from "../../../[id]/try/TryItOut";

type FollowUpDepth = "light" | "medium" | "deep";

/**
 * Custom-template dry run (M2b.5b.10). Mirrors `/dashboard/agents/[id]/try`
 * but loads an `exam_templates` row, composes effective values from
 * template-overrides + preset-fallback, and reuses the same TryItOut
 * component. Blank-slate templates (no linked preset) compose purely from
 * their own columns — required fields are flagged as errors here rather
 * than at session start so the teacher knows which gap to fill before
 * spending a dry-run reservation.
 */
export default async function TemplateTryItOutPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const teacherCtx = await getTeacher();
  if (!teacherCtx) redirect("/login");
  const { templateId } = await params;
  const supabase = await createServerSupabase();

  const [
    { data: templateData, error: templateErr },
    { data: envelopeData, error: envelopeErr },
    { data: summaryPromptData },
  ] = await Promise.all([
    supabase
      .from("exam_templates")
      .select(
        "id, name, personality_preset_id, question_set_id, persona_body, flow_body, follow_up_depth, personalization_enabled, live_voice_name, opening_text, closing_text, eval_prompt_body, rubric_body",
      )
      .eq("id", templateId)
      .maybeSingle(),
    supabase.from("safety_envelope").select("body").eq("id", 1).maybeSingle(),
    supabase
      .from("prompts")
      .select("body")
      .eq("scope", "system")
      .eq("purpose", "student_summary")
      .maybeSingle(),
  ]);
  const summaryPromptBody = (summaryPromptData as { body: string } | null)?.body ?? "";

  if (templateErr) {
    return (
      <div className="bg-white border border-stone-200 rounded p-5">
        <p className="text-sm">Failed to load template: {templateErr.message}</p>
      </div>
    );
  }
  if (!templateData) notFound();
  if (envelopeErr || !envelopeData) {
    return (
      <div className="bg-white border border-stone-200 rounded p-5">
        <p className="text-sm">
          Failed to load safety envelope: {envelopeErr?.message ?? "missing row"}
        </p>
      </div>
    );
  }

  const template = templateData as {
    id: string;
    name: string;
    personality_preset_id: string | null;
    question_set_id: string | null;
    persona_body: string | null;
    flow_body: string | null;
    follow_up_depth: FollowUpDepth | null;
    personalization_enabled: boolean | null;
    live_voice_name: string | null;
    opening_text: string | null;
    closing_text: string | null;
    eval_prompt_body: string | null;
    rubric_body: string | null;
  };

  // Pull the linked preset for fallback values. Null for blank-slate
  // templates (no personality_preset_id) — in that case every field has
  // to come from the template's own columns.
  const { data: presetData } = template.personality_preset_id
    ? await supabase
        .from("personality_presets")
        .select(
          "name, persona_body, flow_body, follow_up_depth, personalization_enabled, live_voice_name, opening_text, closing_text, eval_prompt_body, rubric_body",
        )
        .eq("id", template.personality_preset_id)
        .maybeSingle()
    : { data: null };
  const preset = presetData as {
    name: string;
    persona_body: string;
    flow_body: string;
    follow_up_depth: FollowUpDepth;
    personalization_enabled: boolean;
    live_voice_name: string | null;
    opening_text: string | null;
    closing_text: string | null;
    eval_prompt_body: string | null;
    rubric_body: string | null;
  } | null;

  // Effective values — template overrides win; otherwise preset; otherwise
  // blank for the prose fields (caught below).
  const effective = {
    persona_body: template.persona_body ?? preset?.persona_body ?? "",
    flow_body: template.flow_body ?? preset?.flow_body ?? "",
    follow_up_depth: (template.follow_up_depth ??
      preset?.follow_up_depth ??
      "medium") as FollowUpDepth,
    personalization_enabled:
      template.personalization_enabled ??
      preset?.personalization_enabled ??
      true,
    live_voice_name: template.live_voice_name ?? preset?.live_voice_name ?? null,
    opening_text: template.opening_text ?? preset?.opening_text ?? null,
    closing_text: template.closing_text ?? preset?.closing_text ?? null,
  };

  const missing: string[] = [];
  if (!effective.persona_body.trim()) missing.push("persona body");
  if (!effective.flow_body.trim()) missing.push("flow body");
  if (missing.length > 0) {
    return (
      <div className="space-y-5">
        <Link
          href={`/dashboard/agents/templates/${template.id}/edit`}
          className="text-sm text-maroon no-underline hover:underline"
        >
          ← Edit template
        </Link>
        <div className="bg-white border border-stone-200 rounded p-5 border-l-4 border-red-700 space-y-2">
          <p className="text-sm font-medium">
            Can&apos;t try this template yet — required field
            {missing.length === 1 ? "" : "s"} blank: {missing.join(", ")}.
          </p>
          <p className="text-stone-500 text-sm">
            Blank-slate templates don&apos;t inherit anything; fill in the
            missing prose on the edit page and come back.
          </p>
        </div>
      </div>
    );
  }

  const selected = template.question_set_id
    ? await selectQuestionsForSet(template.question_set_id, supabase)
    : [];

  const systemPrompt = assembleSystemPrompt({
    envelope_body: envelopeData.body,
    persona_body: effective.persona_body,
    flow_body: effective.flow_body,
    flow_parameters: {
      follow_up_depth: effective.follow_up_depth,
      personalization_enabled: effective.personalization_enabled,
    },
    selected_questions: selected,
    opening_text: effective.opening_text,
    closing_text: effective.closing_text,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/agents/templates/${template.id}/edit`}
            className="text-sm text-maroon no-underline hover:underline"
          >
            ← Edit template
          </Link>
          <h1 className="font-medium text-ink text-2xl mt-2">
            Try it out — {template.name}
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            Custom template dry run. {preset ? <>Based on <strong>{preset.name}</strong>; template overrides applied.</> : "Blank-slate template (no preset)."}{" "}
            Each page load picks a fresh random question set.
          </p>
        </div>
      </div>

      <details className="bg-white border border-stone-200 rounded p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Assembled system prompt ({systemPrompt.length.toLocaleString()} chars) —
          click to view
        </summary>
        <pre className="mt-3 text-xs whitespace-pre-wrap font-mono bg-stone-50 border border-stone-200 rounded p-3 leading-relaxed max-h-[60vh] overflow-y-auto">
          {systemPrompt}
        </pre>
      </details>

      <details className="bg-white border border-stone-200 rounded p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Selected questions this session ({selected.length})
        </summary>
        <ul className="mt-3 space-y-1 text-sm">
          {selected.map((q, i) => (
            <li key={q.question_id}>
              <span className="text-stone-500 text-xs font-mono mr-2">
                [{q.bucket_name}]
              </span>
              {i + 1}. {q.text}
            </li>
          ))}
          {selected.length === 0 && (
            <li className="text-stone-500 text-xs">
              No questions selected — this template has no linked question
              set. Pick one (or clone-to-mine) on the edit page.
            </li>
          )}
        </ul>
      </details>

      <TryItOut
        systemPrompt={systemPrompt}
        agentName={template.name}
        voiceName={effective.live_voice_name}
        evalPromptBody={template.eval_prompt_body ?? preset?.eval_prompt_body ?? null}
        rubricBody={template.rubric_body ?? preset?.rubric_body ?? null}
        summaryPromptBody={summaryPromptBody}
      />
    </div>
  );
}
