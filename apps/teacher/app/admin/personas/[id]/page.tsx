import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";
import { PersonaEditForm } from "./PersonaEditForm";

type PresetRow = {
  id: string;
  teacher_id: string | null;
  name: string;
  description: string | null;
  persona_body: string;
  flow_body: string;
  updated_at: string;
};

export default async function AdminPersonaEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("personality_presets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="surface p-5">
        <h1 className="heading text-2xl mb-2">Persona</h1>
        <p className="text-sm">Failed to load preset: {error.message}</p>
      </div>
    );
  }

  if (!data) notFound();
  const preset = data as PresetRow;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/admin/personas" className="text-sm text-maroon no-underline hover:underline">
            ← All personas
          </Link>
          <h1 className="heading text-2xl mt-2">{preset.name}</h1>
          <p className="muted text-sm mt-1">
            {preset.teacher_id === null
              ? "System preset — editable by admins. Changes apply to the default; past templates are unaffected."
              : "Teacher-owned preset."}
          </p>
        </div>
        <span className="muted text-xs">
          Updated {new Date(preset.updated_at).toLocaleString()}
        </span>
      </div>

      <PersonaEditForm preset={preset} />
    </div>
  );
}
