import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { AgentsEditor, type AgentData } from "./AgentsEditor";
import { SafetyEnvelopeForm } from "./SafetyEnvelopeForm";

type PresetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
  eval_prompt_body: string | null;
  rubric_body: string | null;
  default_question_set_id: string | null;
  updated_at: string;
};

type QSetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  updated_at: string;
};

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

export default async function AdminAgentsPage() {
  await requireAdmin();
  const supabase = await createServerSupabase();

  // Step 0: the singleton safety envelope
  const { data: envelopeData, error: envelopeErr } = await supabase
    .from("safety_envelope")
    .select("id, body, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (envelopeErr) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Agents</h1>
        <p className="text-sm">Failed to load safety envelope: {envelopeErr.message}</p>
      </div>
    );
  }
  const envelope = envelopeData as
    | { id: number; body: string; updated_at: string }
    | null;

  // Step 1: all system personas, ordered by name (deterministic across reloads)
  const { data: presetsData, error: presetsErr } = await supabase
    .from("personality_presets")
    .select("*")
    .is("teacher_id", null)
    .order("name");
  if (presetsErr) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Agents</h1>
        <p className="text-sm">Failed to load personas: {presetsErr.message}</p>
      </div>
    );
  }
  const presets = (presetsData ?? []) as PresetRow[];

  // Step 2: every default question set referenced by these personas
  const qsetIds = presets.map((p) => p.default_question_set_id).filter((x): x is string => !!x);
  const { data: qsetsData, error: qsetsErr } =
    qsetIds.length > 0
      ? await supabase.from("question_sets").select("*").in("id", qsetIds)
      : { data: [], error: null };
  if (qsetsErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load question sets: {qsetsErr.message}</p>
      </div>
    );
  }
  const qsetsById = new Map<string, QSetRow>(
    ((qsetsData ?? []) as QSetRow[]).map((s) => [s.id, s])
  );

  // Step 3: all buckets for those sets
  const { data: bucketsData, error: bucketsErr } =
    qsetIds.length > 0
      ? await supabase
          .from("question_buckets")
          .select("*")
          .in("question_set_id", qsetIds)
          .order("position")
      : { data: [], error: null };
  if (bucketsErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load buckets: {bucketsErr.message}</p>
      </div>
    );
  }
  const buckets = (bucketsData ?? []) as BucketRow[];

  // Step 4: all questions for those buckets
  const bucketIds = buckets.map((b) => b.id);
  const { data: questionsData, error: questionsErr } =
    bucketIds.length > 0
      ? await supabase
          .from("questions")
          .select("*")
          .in("question_bucket_id", bucketIds)
          .order("position")
      : { data: [], error: null };
  if (questionsErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load questions: {questionsErr.message}</p>
      </div>
    );
  }
  const questions = (questionsData ?? []) as QuestionRow[];

  // Step 5: stitch it into a per-agent shape
  const bucketsBySet = new Map<string, BucketRow[]>();
  for (const b of buckets) {
    const list = bucketsBySet.get(b.question_set_id) ?? [];
    list.push(b);
    bucketsBySet.set(b.question_set_id, list);
  }
  const questionsByBucket = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    const list = questionsByBucket.get(q.question_bucket_id) ?? [];
    list.push(q);
    questionsByBucket.set(q.question_bucket_id, list);
  }

  const agents: AgentData[] = presets.map((p) => {
    const qset = p.default_question_set_id ? qsetsById.get(p.default_question_set_id) ?? null : null;
    const setBuckets = qset ? bucketsBySet.get(qset.id) ?? [] : [];
    return {
      persona: p,
      qset,
      buckets: setBuckets,
      questionsByBucket: Object.fromEntries(
        setBuckets.map((b) => [b.id, questionsByBucket.get(b.id) ?? []])
      ),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Agents</h1>
        <p className="muted text-sm mt-1">
          Each system agent pairs a <strong>persona</strong> (voice, style,
          boundaries, examination flow) with a <strong>default question
          bank</strong> the agent draws from at session start. The server picks{" "}
          <code>select_count</code> questions from each bucket via crypto-RNG —
          the LLM is never asked to randomize.
        </p>
        <p className="muted text-xs mt-2">
          Edits here update the canonical defaults. Templates that already
          cloned an agent are unaffected; new templates pull the latest values.
        </p>
      </div>

      <SafetyEnvelopeForm envelope={envelope} />

      {/* Sticky agent picker */}
      <nav className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-paper border-b border-rule">
        <ul className="flex gap-3 flex-wrap text-sm">
          {agents.map((a) => (
            <li key={a.persona.id}>
              <a
                href={`#agent-${a.persona.id}`}
                className="px-3 py-1.5 border border-rule rounded no-underline text-ink hover:border-maroon"
              >
                {a.persona.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <AgentsEditor agents={agents} />
    </div>
  );
}
