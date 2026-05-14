import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@oral-examiner/db";

/**
 * Cookie-based server client. Use in Server Components, server actions, and
 * route handlers. Respects RLS — reads/writes scoped to the authed user.
 *
 * AI Documenter learned the hard way that the iframe path doesn't work for
 * this client (third-party cookies blocked); OE v2 is standalone-only, so
 * cookies work cleanly everywhere.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can be called from Server Components where cookies
            // can't be set. The proxy handles refresh, so this is safe.
          }
        },
      },
    },
  );
}
