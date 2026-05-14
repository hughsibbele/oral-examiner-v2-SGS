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
