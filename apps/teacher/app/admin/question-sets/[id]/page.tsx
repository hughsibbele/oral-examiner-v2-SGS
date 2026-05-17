import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { QuestionSetEditor } from "./QuestionSetEditor";

type QSet = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  updated_at: string;
};

type Bucket = {
  id: string;
  question_set_id: string;
  name: string;
  position: number;
  select_count: number;
};

type Question = {
  id: string;
  question_bucket_id: string;
  position: number;
  text: string;
  reference_snippet: string | null;
};

export default async function AdminQuestionSetEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createServerSupabase();

  const { data: setData, error: setErr } = await supabase
    .from("question_sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (setErr) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Question set</h1>
        <p className="text-sm">Failed to load set: {setErr.message}</p>
      </div>
    );
  }
  if (!setData) notFound();
  const qset = setData as QSet;

  const { data: bucketsData, error: bucketsErr } = await supabase
    .from("question_buckets")
    .select("*")
    .eq("question_set_id", qset.id)
    .order("position");
  if (bucketsErr) {
    return (
      <div className="surface p-5">
        <p className="text-sm">Failed to load buckets: {bucketsErr.message}</p>
      </div>
    );
  }
  const buckets = (bucketsData ?? []) as Bucket[];

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
  const questions = (questionsData ?? []) as Question[];
  const questionsByBucket = new Map<string, Question[]>();
  for (const q of questions) {
    const list = questionsByBucket.get(q.question_bucket_id) ?? [];
    list.push(q);
    questionsByBucket.set(q.question_bucket_id, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link
            href="/admin/question-sets"
            className="text-sm text-maroon no-underline hover:underline"
          >
            ← All question sets
          </Link>
          <h1 className="heading text-2xl mt-2">{qset.name}</h1>
          <p className="muted text-sm mt-1">
            {qset.teacher_id === null
              ? "System set — editable by admins."
              : "Teacher-owned set."}
          </p>
        </div>
        <span className="muted text-xs">
          Updated {new Date(qset.updated_at).toLocaleString()}
        </span>
      </div>

      <QuestionSetEditor
        qset={qset}
        buckets={buckets}
        questionsByBucket={Object.fromEntries(questionsByBucket)}
      />
    </div>
  );
}
