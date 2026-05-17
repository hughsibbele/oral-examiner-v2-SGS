import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

type PresetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
  updated_at: string;
};

export default async function AdminPersonasPage() {
  await requireAdmin();

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("personality_presets")
    .select("*")
    .is("teacher_id", null)
    .order("name");

  if (error) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Personality presets</h1>
        <p className="text-sm">Failed to load presets: {error.message}</p>
      </div>
    );
  }

  const presets = (data ?? []) as PresetRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading text-2xl">Personality presets</h1>
        <p className="muted text-sm mt-1">
          System personas teachers clone when building an exam template.
          Editing here updates the canonical default — past templates that
          already cloned this preset are unaffected.
        </p>
      </div>

      <div className="surface">
        <table className="w-full text-sm">
          <thead className="border-b border-rule">
            <tr>
              <th className="text-left p-3 font-medium">Name</th>
              <th className="text-left p-3 font-medium">Description</th>
              <th className="text-left p-3 font-medium">Persona</th>
              <th className="text-left p-3 font-medium">Flow</th>
              <th className="text-left p-3 font-medium">Updated</th>
              <th className="text-left p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {presets.map((p) => (
              <tr key={p.id} className="border-b border-rule last:border-0">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 muted text-xs">{p.description}</td>
                <td className="p-3 muted text-xs">{p.persona_body.length.toLocaleString()} ch</td>
                <td className="p-3 muted text-xs">{p.flow_body.length.toLocaleString()} ch</td>
                <td className="p-3 muted text-xs">
                  {new Date(p.updated_at).toLocaleDateString()}
                </td>
                <td className="p-3">
                  <Link
                    href={`/admin/personas/${p.id}`}
                    className="text-maroon no-underline hover:underline"
                  >
                    Edit →
                  </Link>
                </td>
              </tr>
            ))}
            {presets.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 muted text-center text-xs">
                  No system presets seeded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
