import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();

  const [{ count: promptCount }, { count: adminCount }, { count: teacherCount }] =
    await Promise.all([
      supabase.from("prompts").select("id", { count: "exact", head: true }),
      supabase.from("admins").select("email", { count: "exact", head: true }),
      supabase.from("teachers").select("id", { count: "exact", head: true }),
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
          label="System prompts"
          value={promptCount ?? 0}
          href="/admin/prompts"
          hint="voice_agent, summary, eval, rubric, transcription"
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

      <section className="surface p-5">
        <h2 className="heading text-lg mb-3">Phase A admin surface</h2>
        <p className="text-sm leading-relaxed">
          Prompt editing, admin management, and retention sweeps are all wired
          into the schema and route shells. The full CRUD UI ships in Phase D
          alongside the diagnostic session view. For now this surface exists
          so the admin layer is real (and self-bootstrap is verified).
        </p>
      </section>
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
