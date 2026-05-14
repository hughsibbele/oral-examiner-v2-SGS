import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacher } from "./teacher";

export type Admin = {
  email: string;
  created_at: string;
  created_by_email: string | null;
};

/**
 * Is the current authed user an admin?
 *
 * Cheap: a single COUNT against `admins` joined against the current teacher.
 * Uses the cookie client; the is_admin() SECURITY DEFINER helper in Postgres
 * mirrors this logic for use inside other tables' RLS policies.
 */
export async function isAdmin(): Promise<boolean> {
  const result = await getTeacher();
  if (!result) return false;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("admins")
    .select("email")
    .eq("email", result.teacher.email)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

/**
 * Bootstrap the first admin row.
 *
 * Self-promotes the authed teacher if (a) no admins exist AND (b) the teacher's
 * email matches `INITIAL_ADMIN_EMAIL`. Idempotent — if an admin row already
 * exists for any email, this is a no-op.
 *
 * Called from `/admin` on first visit (page-level), not from the auth callback
 * — keeps the bootstrap path visible and intentional.
 */
export async function bootstrapAdminIfNeeded(): Promise<{
  promoted: boolean;
  reason?: string;
}> {
  const initial = process.env.INITIAL_ADMIN_EMAIL?.toLowerCase();
  if (!initial) {
    return { promoted: false, reason: "INITIAL_ADMIN_EMAIL not set" };
  }

  const result = await getTeacher();
  if (!result) {
    return { promoted: false, reason: "not signed in" };
  }

  const admin = createAdminClient();
  const { count, error: countErr } = await admin
    .from("admins")
    .select("email", { count: "exact", head: true });
  if (countErr) {
    return { promoted: false, reason: `admins count failed: ${countErr.message}` };
  }
  if ((count ?? 0) > 0) {
    return { promoted: false, reason: "admins already exist" };
  }

  if (result.teacher.email.toLowerCase() !== initial) {
    return {
      promoted: false,
      reason: `current teacher ${result.teacher.email} != INITIAL_ADMIN_EMAIL ${initial}`,
    };
  }

  const { error: insertErr } = await admin.from("admins").insert({
    email: result.teacher.email.toLowerCase(),
    created_by_email: null,
  });
  if (insertErr) {
    return { promoted: false, reason: `admin insert failed: ${insertErr.message}` };
  }

  return { promoted: true };
}

/**
 * Gate a page on admin status. Returns the teacher record if the caller is
 * an admin; throws otherwise.
 *
 * Pages should call `bootstrapAdminIfNeeded()` first, then `requireAdmin()`,
 * so the first-ever sign-in promotes Hugh into the admin role and then
 * passes the check.
 */
export async function requireAdmin() {
  const ok = await isAdmin();
  if (!ok) {
    throw new Error("Admin access required.");
  }
  const result = await getTeacher();
  if (!result) {
    throw new Error("Not signed in.");
  }
  return result;
}
