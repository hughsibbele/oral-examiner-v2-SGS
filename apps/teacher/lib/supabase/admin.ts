import { createClient } from "@supabase/supabase-js";
import type { Database } from "@oral-examiner/db";

/**
 * Service-role client. Bypasses RLS. Server-side only.
 *
 * Use for: bootstrapping teacher/admin rows on first sign-in, webhook
 * pushes to super-grader, cron-driven Canvas syncs, and the
 * pull-on-view prompt endpoint that super-grader hits.
 *
 * **Required for the upcoming M2b.5d student `/exam/[token]` handler.**
 * The `exam_templates_student_by_session` RLS policy was dropped in
 * `20260518021328_fix_exam_templates_rls_recursion`, so no anon/student
 * read path on `exam_templates` exists anymore. The student handler must
 * resolve the binding (by `exam_token` on `exam_template_bindings`) and
 * load the referenced `exam_templates` row via this admin client. Any
 * student-context Supabase query that needs to read across the binding ↔
 * template ↔ preset chain must go through service-role; don't attempt to
 * re-add a student-scoped RLS policy because the recursion-fix migration
 * is what makes the cross-table joins in the rest of the schema work.
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
