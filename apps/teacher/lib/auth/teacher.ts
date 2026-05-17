import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Teacher = {
  id: string;
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  canvas_token_encrypted: string | null;
  canvas_host: string | null;
  gemini_live_daily_cap_minutes: number | null;
  gemini_live_dryrun_daily_cap_minutes: number | null;
  gemini_text_daily_cap: number | null;
  created_at: string;
  updated_at: string;
};

const ALLOWED_DOMAIN = process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";

/**
 * Resolve the current authed teacher, or null if not signed in.
 *
 * RLS scopes teachers to `auth_user_id = auth.uid()`, so the cookie client
 * just works without service-role escalation.
 */
export async function getTeacher(): Promise<{
  authUser: { id: string; email: string };
  teacher: Teacher;
} | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  const { data: teacher } = await supabase
    .from("teachers")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!teacher) return null;

  return {
    authUser: { id: user.id, email: user.email },
    teacher: teacher as unknown as Teacher,
  };
}

export type GoogleProviderTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
};

/**
 * Upsert the teacher row on sign-in. Multi-teacher (no single-tenant gate —
 * OE v2 is school-wide via admins layer). Domain-gated to
 * @episcopalhighschool.org.
 *
 * Uses the service-role client because RLS would block the initial insert
 * before the row exists.
 *
 * `tokens` carries the Google OAuth `provider_token` / `provider_refresh_token`
 * captured from `auth.exchangeCodeForSession`. We persist them so server-side
 * Drive calls (Picker token mint, Save-to-Drive, PDF intake) can refresh
 * without a fresh browser sign-in. Google only issues a refresh_token on first
 * consent — `prompt=consent` in LoginForm forces it. If this sign-in didn't
 * yield a refresh_token, we preserve whatever's already on the row.
 */
export async function ensureTeacherForUser(
  user: {
    id: string;
    email: string;
    user_metadata?: { full_name?: string; name?: string; sub?: string };
  },
  tokens?: GoogleProviderTokens,
): Promise<Teacher> {
  if (!user.email) {
    throw new Error("ensureTeacherForUser: no email on the auth user.");
  }

  const lowerEmail = user.email.toLowerCase();
  if (!lowerEmail.endsWith(`@${ALLOWED_DOMAIN}`)) {
    throw new Error(
      `ensureTeacherForUser: ${user.email} is not in @${ALLOWED_DOMAIN} workspace.`,
    );
  }

  const googleSub = user.user_metadata?.sub ?? user.id;
  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email.split("@")[0]!;

  // Google access tokens are 1h; expire ours at 55min so the refresh helper
  // kicks in a comfortable margin before Google's boundary.
  const tokenUpdates: Record<string, string> = {};
  if (tokens?.access_token) {
    tokenUpdates.google_access_token = tokens.access_token;
    tokenUpdates.google_token_expires_at = new Date(
      Date.now() + 55 * 60 * 1000,
    ).toISOString();
  }
  if (tokens?.refresh_token) {
    tokenUpdates.google_refresh_token = tokens.refresh_token;
  }

  const admin = createAdminClient();

  const { data: existing, error: existingErr } = await admin
    .from("teachers")
    .select("*")
    .eq("email", lowerEmail)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const ex = existing as unknown as Teacher;
    const identityChanged =
      ex.auth_user_id !== user.id ||
      ex.google_sub !== googleSub ||
      ex.display_name !== displayName;
    const tokensChanged = Object.keys(tokenUpdates).length > 0;
    if (identityChanged || tokensChanged) {
      const { data: updated, error: upErr } = await admin
        .from("teachers")
        .update({
          auth_user_id: user.id,
          google_sub: googleSub,
          display_name: displayName,
          ...tokenUpdates,
        })
        .eq("id", ex.id)
        .select("*")
        .single();
      if (upErr) throw upErr;
      return updated as unknown as Teacher;
    }
    return ex;
  }

  const { data: created, error: insertErr } = await admin
    .from("teachers")
    .insert({
      auth_user_id: user.id,
      google_sub: googleSub,
      email: lowerEmail,
      display_name: displayName,
      ...tokenUpdates,
    })
    .select("*")
    .single();
  if (insertErr) throw insertErr;

  return created as unknown as Teacher;
}
