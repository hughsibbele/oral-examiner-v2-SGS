"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/admin";

export type UpdatePersonaResult = { ok: true } | { ok: false; error: string };

export async function updatePersona(formData: FormData): Promise<UpdatePersonaResult> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const persona_body = String(formData.get("persona_body") ?? "").trim();
  const flow_body = String(formData.get("flow_body") ?? "").trim();

  if (!id) return { ok: false, error: "Missing preset id." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!persona_body) return { ok: false, error: "Persona body is required." };
  if (!flow_body) return { ok: false, error: "Flow body is required." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("personality_presets")
    .update({
      name,
      description: description || null,
      persona_body,
      flow_body,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/personas");
  revalidatePath(`/admin/personas/${id}`);
  return { ok: true };
}
