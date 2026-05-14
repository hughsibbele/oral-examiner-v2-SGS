import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@oral-examiner/db";
import { ensureTeacherForUser } from "@/lib/auth/teacher";

/**
 * OAuth callback. Unified across teacher + student paths.
 *
 * Routes by `next` prefix:
 *   - /exam/<token>  → student path (student session resolution is deferred
 *                      until Phase B's Canvas roster lands; for now we just
 *                      complete the auth exchange and redirect)
 *   - anything else  → teacher upsert via ensureTeacherForUser()
 *
 * AI Documenter learned (and we inherit): explicitly capture every cookie
 * Supabase wants to set during the exchange and re-apply them onto the
 * redirect response. Some Next.js + cookieStore.set() interactions in route
 * handlers don't reliably propagate cookies to a freshly-constructed
 * NextResponse.redirect(), so we do it by hand.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = await cookies();
  const captured: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const c of cookiesToSet) {
            captured.push(c);
            try {
              cookieStore.set(c.name, c.value, c.options);
            } catch {
              // Best-effort; we replay onto the response below.
            }
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return redirectWithCookies(`${origin}/login?error=exchange_failed`, captured);
  }

  const user = data.session.user;
  if (!user.email) {
    await supabase.auth.signOut();
    return redirectWithCookies(`${origin}/login?error=no_email`, captured);
  }

  const isStudentPath = next.startsWith("/exam/");

  if (isStudentPath) {
    // Student-side upsert is deferred — needs Canvas roster cache (Phase B)
    // to resolve canvas_user_id from email. For now, just complete auth and
    // let /exam/<token> handle the rest when it actually exists.
    return redirectWithCookies(`${origin}${next}`, captured);
  }

  // Teacher path.
  try {
    await ensureTeacherForUser({
      id: user.id,
      email: user.email,
      user_metadata: user.user_metadata as {
        full_name?: string;
        name?: string;
        sub?: string;
      },
    });
  } catch (err) {
    await supabase.auth.signOut();
    const reason = err instanceof Error ? err.message : "policy";
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "not_authorized");
    url.searchParams.set("reason", reason);
    return redirectWithCookies(url.toString(), captured);
  }

  return redirectWithCookies(`${origin}${next}`, captured);
}

function redirectWithCookies(
  url: string,
  cookies: Array<{ name: string; value: string; options: CookieOptions }>,
) {
  const response = NextResponse.redirect(url);
  for (const c of cookies) {
    response.cookies.set(c.name, c.value, c.options);
  }
  return response;
}
