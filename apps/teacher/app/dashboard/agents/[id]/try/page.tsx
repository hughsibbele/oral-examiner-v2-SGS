import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getTeacher } from "@/lib/auth/teacher";
import { selectQuestionsForSet } from "@/lib/runtime/select-questions";
import { assembleSystemPrompt } from "@/lib/runtime/assemble-prompt";
import { TryItOut } from "./TryItOut";

export default async function TryItOutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const teacherCtx = await getTeacher();
  if (!teacherCtx) redirect("/login");
  const { id } = await params;
  const supabase = await createServerSupabase();

  const [
    { data: personaData, error: personaErr },
    { data: envelopeData, error: envelopeErr },
  ] = await Promise.all([
    supabase
      .from("personality_presets")
      .select("id, name, persona_body, flow_body, default_question_set_id, live_voice_name")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("safety_envelope").select("body").eq("id", 1).maybeSingle(),
  ]);
  // opening_text / closing_text live on exam_templates (per-assignment), not
  // on personality_presets — so they're undefined here. Teacher-side dry-run
  // will pull them from the template row.

  if (personaErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load persona: {personaErr.message}</p>
      </div>
    );
  }
  if (!personaData) notFound();
  if (envelopeErr || !envelopeData) {
    return (
      <div className="surface p-5">
        <p className="text-sm">
          Failed to load safety envelope: {envelopeErr?.message ?? "missing row"}
        </p>
      </div>
    );
  }

  const persona = personaData as {
    id: string;
    name: string;
    persona_body: string;
    flow_body: string;
    default_question_set_id: string | null;
    live_voice_name: string | null;
  };

  const selected = persona.default_question_set_id
    ? await selectQuestionsForSet(persona.default_question_set_id, supabase)
    : [];

  const systemPrompt = assembleSystemPrompt({
    envelope_body: envelopeData.body,
    persona_body: persona.persona_body,
    flow_body: persona.flow_body,
    selected_questions: selected,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/dashboard/agents" className="text-sm text-maroon no-underline hover:underline">
            ← All agents
          </Link>
          <h1 className="heading text-2xl mt-2">Try it out — {persona.name}</h1>
          <p className="muted text-sm mt-1">
            Text-only dry run via Gemini Flash. You play the student; the
            agent reads from the same assembled prompt it would see in a real
            session (minus live audio). Each page load picks a fresh random
            question set.
          </p>
        </div>
      </div>

      <details className="surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Assembled system prompt ({systemPrompt.length.toLocaleString()} chars) —
          click to view
        </summary>
        <pre className="mt-3 text-xs whitespace-pre-wrap font-mono bg-paper border border-rule rounded p-3 leading-relaxed max-h-[60vh] overflow-y-auto">
          {systemPrompt}
        </pre>
      </details>

      <details className="surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Selected questions this session ({selected.length})
        </summary>
        <ul className="mt-3 space-y-1 text-sm">
          {selected.map((q, i) => (
            <li key={q.question_id}>
              <span className="muted text-xs font-mono mr-2">
                [{q.bucket_name}]
              </span>
              {i + 1}. {q.text}
            </li>
          ))}
          {selected.length === 0 && (
            <li className="muted text-xs">
              No questions selected — the agent has no default question set
              linked. Set <code>default_question_set_id</code> on this persona.
            </li>
          )}
        </ul>
      </details>

      <TryItOut
        systemPrompt={systemPrompt}
        agentName={persona.name}
        voiceName={persona.live_voice_name}
      />
    </div>
  );
}
