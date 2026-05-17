import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@oral-examiner/db";

export type SelectedQuestion = {
  bucket_name: string;
  bucket_position: number;
  question_id: string;
  text: string;
  reference_snippet: string | null;
};

/**
 * Pick the questions an agent will ask in a single exam session.
 *
 * For each bucket (in `position` order), randomly select `select_count`
 * questions using crypto-strength RNG (Node's `crypto.randomInt`). Return
 * them as a flat ordered list — buckets in order, questions within a bucket
 * are unordered (the agent receives them as a fixed list and reads them in
 * the order returned).
 *
 * Never asks the LLM to randomize. Selection is deterministic given the same
 * RNG seed; in production the RNG is unseeded crypto entropy so each call
 * produces independent picks.
 */
export async function selectQuestionsForSet(
  questionSetId: string,
  supabase: SupabaseClient<Database>,
): Promise<SelectedQuestion[]> {
  const { data: buckets, error: bucketsErr } = await supabase
    .from("question_buckets")
    .select("id, name, position, select_count")
    .eq("question_set_id", questionSetId)
    .order("position");
  if (bucketsErr) throw new Error(`load buckets: ${bucketsErr.message}`);
  if (!buckets || buckets.length === 0) return [];

  const bucketIds = buckets.map((b) => b.id);
  const { data: questions, error: questionsErr } = await supabase
    .from("questions")
    .select("id, question_bucket_id, text, reference_snippet")
    .in("question_bucket_id", bucketIds);
  if (questionsErr) throw new Error(`load questions: ${questionsErr.message}`);
  const questionsByBucket = new Map<string, typeof questions>();
  for (const q of questions ?? []) {
    const list = questionsByBucket.get(q.question_bucket_id) ?? [];
    list.push(q);
    questionsByBucket.set(q.question_bucket_id, list);
  }

  const selected: SelectedQuestion[] = [];
  for (const b of buckets) {
    const pool = questionsByBucket.get(b.id) ?? [];
    const picked = pickRandomDistinct(pool, b.select_count);
    for (const q of picked) {
      selected.push({
        bucket_name: b.name,
        bucket_position: b.position,
        question_id: q.id,
        text: q.text,
        reference_snippet: q.reference_snippet,
      });
    }
  }
  return selected;
}

/**
 * Pick `n` distinct elements from `pool` using crypto-RNG. If `n >= pool.length`,
 * returns the whole pool (in original order is fine; agent reads as a fixed list).
 * Implementation: partial Fisher–Yates with crypto.randomInt.
 */
function pickRandomDistinct<T>(pool: T[], n: number): T[] {
  if (n <= 0 || pool.length === 0) return [];
  if (n >= pool.length) return [...pool];

  const arr = [...pool];
  // Walk first `n` positions; for each, swap with a random position in [i, len)
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(arr.length - i); // [i, arr.length)
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}
