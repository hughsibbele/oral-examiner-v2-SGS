import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();

  const [
    { count: promptCount },
    { count: adminCount },
    { count: teacherCount },
    { count: personaCount },
    { count: qsetCount },
    { count: questionCount },
  ] = await Promise.all([
    supabase.from("prompts").select("id", { count: "exact", head: true }),
    supabase.from("admins").select("email", { count: "exact", head: true }),
    supabase.from("teachers").select("id", { count: "exact", head: true }),
    supabase
      .from("personality_presets")
      .select("id", { count: "exact", head: true })
      .is("teacher_id", null),
    supabase
      .from("question_sets")
      .select("id", { count: "exact", head: true })
      .is("teacher_id", null),
    supabase.from("questions").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Admin</h1>
        <p className="muted text-sm mt-1">
          School-wide configuration and diagnostics.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Tile
          label="Personality presets"
          value={personaCount ?? 0}
          href="/admin/personas"
          hint="System personas (ChekhovBot, Book Club, Researcher, Study Partner)"
        />
        <Tile
          label="Question sets"
          value={qsetCount ?? 0}
          href="/admin/question-sets"
          hint={`${questionCount ?? 0} questions across all system sets`}
        />
        <Tile
          label="System prompts"
          value={promptCount ?? 0}
          href="/admin/prompts"
          hint="Grading/summary/eval prompts (read-only for now)"
        />
        <Tile
          label="Admins"
          value={adminCount ?? 0}
          href="/admin/admins"
          hint="Add or revoke ecosystem admins"
        />
        <Tile
          label="Teachers"
          value={teacherCount ?? 0}
          href="#"
          hint="Visible to admins; no actions yet"
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number;
  href: string;
  hint: string;
}) {
  return (
    <Link href={href} className="surface p-4 block no-underline text-ink hover:border-maroon">
      <div className="muted text-xs uppercase tracking-wider">{label}</div>
      <div className="heading text-3xl mt-1">{value}</div>
      <div className="muted text-xs mt-2">{hint}</div>
    </Link>
  );
}
