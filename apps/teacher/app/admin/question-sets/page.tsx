import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

type QSetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  updated_at: string;
};

type BucketCount = { question_set_id: string; bucket_count: number; question_count: number };

export default async function AdminQuestionSetsPage() {
  await requireAdmin();

  const supabase = await createServerSupabase();

  const [{ data: setsData, error: setsErr }, { data: bucketsData, error: bucketsErr }] =
    await Promise.all([
      supabase
        .from("question_sets")
        .select("*")
        .is("teacher_id", null)
        .order("name"),
      supabase
        .from("question_buckets")
        .select("id, question_set_id, select_count, name"),
    ]);

  if (setsErr || bucketsErr) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Question sets</h1>
        <p className="text-sm">
          Failed to load: {setsErr?.message ?? bucketsErr?.message}
        </p>
      </div>
    );
  }

  // Count questions per set by walking buckets
  const bucketIds = (bucketsData ?? []).map((b) => b.id);
  const { data: qCounts } = await supabase
    .from("questions")
    .select("question_bucket_id")
    .in("question_bucket_id", bucketIds.length > 0 ? bucketIds : ["00000000-0000-0000-0000-000000000000"]);

  const bucketToSet = new Map<string, string>(
    (bucketsData ?? []).map((b) => [b.id, b.question_set_id])
  );
  const setQuestionCount = new Map<string, number>();
  for (const q of qCounts ?? []) {
    const setId = bucketToSet.get(q.question_bucket_id);
    if (!setId) continue;
    setQuestionCount.set(setId, (setQuestionCount.get(setId) ?? 0) + 1);
  }

  const sets = (setsData ?? []) as QSetRow[];
  const counts: Record<string, BucketCount> = {};
  for (const s of sets) {
    counts[s.id] = {
      question_set_id: s.id,
      bucket_count: (bucketsData ?? []).filter((b) => b.question_set_id === s.id).length,
      question_count: setQuestionCount.get(s.id) ?? 0,
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Question sets</h1>
        <p className="muted text-sm mt-1">
          System question banks teachers clone when building an exam template.
          Each set is one or more buckets; each bucket has a{" "}
          <code>select_count</code> that determines how many questions the
          server picks (cryptographically random) at session start.
        </p>
      </div>

      <div className="surface">
        <table className="w-full text-sm">
          <thead className="border-b border-rule">
            <tr>
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-left p-3 font-medium">Buckets</th>
              <th className="text-left p-3 font-medium">Questions</th>
              <th className="text-left p-3 font-medium">Updated</th>
              <th className="text-left p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => {
              const c = counts[s.id];
              return (
                <tr key={s.id} className="border-b border-rule last:border-0">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 muted text-xs">{s.description}</td>
                  <td className="p-3 muted text-xs">{c.bucket_count}</td>
                  <td className="p-3 muted text-xs">{c.question_count}</td>
                  <td className="p-3 muted text-xs">
                    {new Date(s.updated_at).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/admin/question-sets/${s.id}`}
                      className="text-maroon no-underline hover:underline"
                    >
                      Edit →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {sets.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 muted text-center text-xs">
                  No system question sets seeded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
