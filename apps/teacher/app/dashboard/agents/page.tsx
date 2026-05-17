import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  live_voice_name: string | null;
  rubric_body: string | null;
  default_question_set_id: string | null;
};

type BucketSummary = { question_set_id: string; select_count: number; question_count: number };

export default async function TeacherAgentsPage() {
  // Auth-gated by /dashboard/layout.tsx (getTeacher + redirect).
  const supabase = await createServerSupabase();

  const { data: agentsData, error: agentsErr } = await supabase
    .from("personality_presets")
    .select("id, name, description, live_voice_name, rubric_body, default_question_set_id")
    .is("teacher_id", null)
    .order("name");
  if (agentsErr) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Agents</h1>
        <p className="text-sm">Failed to load agents: {agentsErr.message}</p>
      </div>
    );
  }
  const agents = (agentsData ?? []) as AgentRow[];

  // For each agent, count questions in its default set so the card surfaces
  // "asks N of M per session" — useful preview.
  const qsetIds = agents
    .map((a) => a.default_question_set_id)
    .filter((x): x is string => !!x);
  const { data: bucketsData } =
    qsetIds.length > 0
      ? await supabase
          .from("question_buckets")
          .select("question_set_id, select_count, id")
          .in("question_set_id", qsetIds)
      : { data: [] };
  const bucketIds = (bucketsData ?? []).map((b) => b.id);
  const { data: qCounts } =
    bucketIds.length > 0
      ? await supabase
          .from("questions")
          .select("question_bucket_id")
          .in("question_bucket_id", bucketIds)
      : { data: [] };

  const bucketsBySet = new Map<string, BucketSummary[]>();
  const setQuestionCount = new Map<string, number>();
  const bucketToSet = new Map<string, string>();
  for (const b of bucketsData ?? []) {
    bucketToSet.set(b.id, b.question_set_id);
    const list = bucketsBySet.get(b.question_set_id) ?? [];
    list.push({
      question_set_id: b.question_set_id,
      select_count: b.select_count,
      question_count: 0,
    });
    bucketsBySet.set(b.question_set_id, list);
  }
  for (const q of qCounts ?? []) {
    const setId = bucketToSet.get(q.question_bucket_id);
    if (!setId) continue;
    setQuestionCount.set(setId, (setQuestionCount.get(setId) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Agents</h1>
        <p className="muted text-sm mt-1">
          Try out any of the school&apos;s oral-examination agents. Click an
          agent to start a voice conversation; the agent picks a fresh random
          set of questions and you play the student. Cap: a few minutes per day
          per teacher to keep costs in check.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {agents.map((a) => {
          const totalQs = a.default_question_set_id
            ? setQuestionCount.get(a.default_question_set_id) ?? 0
            : 0;
          const totalSelected = a.default_question_set_id
            ? (bucketsBySet.get(a.default_question_set_id) ?? []).reduce(
                (sum, b) => sum + b.select_count,
                0,
              )
            : 0;
          const ungraded = !a.rubric_body;
          return (
            <Link
              key={a.id}
              href={`/dashboard/agents/${a.id}/try`}
              className="surface p-5 block no-underline text-ink hover:border-maroon"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="heading text-lg">{a.name}</h2>
                {a.live_voice_name && (
                  <span className="muted text-xs">voice: {a.live_voice_name}</span>
                )}
              </div>
              {a.description && (
                <p className="muted text-sm mt-1">{a.description}</p>
              )}
              <div className="muted text-xs mt-3 flex gap-3 flex-wrap">
                <span>{ungraded ? "Ungraded" : "Graded"}</span>
                {a.default_question_set_id && (
                  <span>
                    asks {totalSelected} of {totalQs} questions per session
                  </span>
                )}
              </div>
              <div className="text-sm text-maroon mt-3">Try it out →</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
