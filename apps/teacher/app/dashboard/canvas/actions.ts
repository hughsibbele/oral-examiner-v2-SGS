"use server";

import { getSelf, normalizeHost, CanvasError } from "@oral-examiner/canvas";
import { encryptSecret, readKeyFromEnv } from "@oral-examiner/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacher } from "@/lib/auth/teacher";
import { revalidatePath } from "next/cache";

type SaveResult =
  | { ok: true; canvasUserName: string; canvasUserId: number }
  | { ok: false; error: string };

/**
 * Verify a Canvas token by calling /users/self, then encrypt + persist on the
 * teacher row. Service-role client because RLS would forbid the teacher from
 * writing canvas_token_encrypted directly (defense in depth — the token
 * blob shouldn't leak via stale RLS misconfig).
 */
export async function saveCanvasToken({
  host,
  token,
}: {
  host: string;
  token: string;
}): Promise<SaveResult> {
  const result = await getTeacher();
  if (!result) return { ok: false, error: "Not signed in." };

  let normalizedHost: string;
  try {
    normalizedHost = normalizeHost(host);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Bad host." };
  }

  // Verify the token works before persisting.
  let canvasUser;
  try {
    canvasUser = await getSelf({ host: normalizedHost, token });
  } catch (err) {
    if (err instanceof CanvasError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Canvas error." };
  }

  const encrypted = encryptSecret(token, readKeyFromEnv());

  const admin = createAdminClient();
  const { error: upErr } = await admin
    .from("teachers")
    .update({
      canvas_token_encrypted: encrypted,
      canvas_host: normalizedHost,
    })
    .eq("id", result.teacher.id);

  if (upErr) {
    return { ok: false, error: `Persist failed: ${upErr.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/canvas");

  return {
    ok: true,
    canvasUserName: canvasUser.name,
    canvasUserId: canvasUser.id,
  };
}

// =========================================================================
// Card text overrides (M2b.5b.9) — per-teacher global overrides on the 5
// strings inside the branded Canvas card. Effective value at install time
// is `teachers.card_<field> ?? card_text_defaults.<field>`.
// =========================================================================

type CardActionResult = { ok: true } | { ok: false; error: string };

const CARD_FIELDS = [
  "card_kicker",
  "card_title",
  "card_body",
  "card_cta_label",
  "card_footnote",
] as const;

type CardField = (typeof CARD_FIELDS)[number];

/**
 * Save the teacher's per-field overrides. Each form field is plain text;
 * empty submissions land as NULL so the field re-inherits the admin
 * default. Any field whose value matches the current admin default also
 * collapses to NULL (so a teacher who hits "use default" by retyping the
 * same string doesn't accidentally pin an override that decays if the
 * admin later changes the default).
 */
export async function updateMyCardOverrides(
  formData: FormData,
): Promise<CardActionResult> {
  const result = await getTeacher();
  if (!result) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  // Fetch current defaults so we can collapse exact-matches to NULL.
  const { data: defaultsRow } = await admin
    .from("card_text_defaults")
    .select("kicker, title, body, cta_label, footnote")
    .eq("id", 1)
    .maybeSingle();
  const defaults = {
    card_kicker: (defaultsRow?.kicker as string | undefined) ?? "",
    card_title: (defaultsRow?.title as string | undefined) ?? "",
    card_body: (defaultsRow?.body as string | undefined) ?? "",
    card_cta_label: (defaultsRow?.cta_label as string | undefined) ?? "",
    card_footnote: (defaultsRow?.footnote as string | undefined) ?? "",
  } satisfies Record<CardField, string>;

  const patch: Record<CardField, string | null> = {
    card_kicker: null,
    card_title: null,
    card_body: null,
    card_cta_label: null,
    card_footnote: null,
  };
  for (const field of CARD_FIELDS) {
    const submitted = String(formData.get(field) ?? "").trim();
    if (submitted === "") {
      patch[field] = null;
    } else if (submitted === defaults[field]) {
      patch[field] = null;
    } else {
      patch[field] = submitted;
    }
  }

  const { error } = await admin
    .from("teachers")
    .update(patch)
    .eq("id", result.teacher.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/canvas");
  return { ok: true };
}

/** Clear a single override → re-inherit the admin default. */
export async function resetMyCardOverride(
  formData: FormData,
): Promise<CardActionResult> {
  const result = await getTeacher();
  if (!result) return { ok: false, error: "Not signed in." };

  const field = String(formData.get("field") ?? "");
  if (!CARD_FIELDS.includes(field as CardField)) {
    return { ok: false, error: `Field "${field}" can't be reset.` };
  }

  const admin = createAdminClient();
  const patch = { [field]: null } as Record<CardField, null>;
  const { error } = await admin
    .from("teachers")
    .update(patch)
    .eq("id", result.teacher.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/canvas");
  return { ok: true };
}
