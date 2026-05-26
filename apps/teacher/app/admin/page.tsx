import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();

  const [
    { count: adminCount },
    { count: teacherCount },
    { count: agentCount },
    { count: questionCount },
  ] = await Promise.all([
    supabase.from("admins").select("email", { count: "exact", head: true }),
    supabase.from("teachers").select("id", { count: "exact", head: true }),
    supabase
      .from("personality_presets")
      .select("id", { count: "exact", head: true })
      .is("teacher_id", null),
    supabase.from("questions").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-medium text-ink text-2xl">Admin</h1>
        <p className="text-stone-500 text-sm mt-1">
          School-wide configuration and diagnostics.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Tile
          label="Agents"
          value={agentCount ?? 0}
          href="/admin/agents"
          hint={`Persona + eval + question set per agent · ${questionCount ?? 0} questions · safety envelope + system prompts also here`}
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
    <Link href={href} className="bg-white border border-stone-200 rounded-md p-4 block no-underline text-ink hover:border-dark-blue/40 hover:bg-stone-50">
      <div className="text-stone-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="font-medium text-ink text-3xl mt-1">{value}</div>
      <div className="text-stone-500 text-xs mt-2">{hint}</div>
    </Link>
  );
}
