import { createClient } from "@supabase/supabase-js";
import type { Database } from "@oral-examiner/db";

/**
 * Service-role client. Bypasses RLS. Server-side only.
 *
 * Use for: bootstrapping teacher/admin rows on first sign-in, webhook
 * pushes to super-grader, cron-driven Canvas syncs, and the
 * pull-on-view prompt endpoint that super-grader hits.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
