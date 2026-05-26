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
    console.error("[auth/callback] exchangeCodeForSession failed:", error?.message ?? "no session returned", { status: error?.status, code: error?.code });
    return redirectWithCookies(`${origin}/login?error=exchange_failed`, captured);
  }

  const user = data.session.user;
  if (!user.email) {
    await supabase.auth.signOut();
    return redirectWithCookies(`${origin}/login?error=no_email`, captured);
  }

  const isStudentPath = next.startsWith("/exam/");

  if (isStudentPath) {
    // Domain gate students to @episcopalhighschool.org. Mirrors the
    // teacher-side check in ensureTeacherForUser. The Google `hd` hint in
    // the /auth/login route handler restricts the account picker, but a determined user can
    // bypass it via direct OAuth URL — this is the server-side enforcement.
    // Roster check (must be enrolled in the specific course) happens later
    // in /exam/[token]'s resolver; this catches the wrong-domain case early
    // so non-EHS users see a clear error instead of "not enrolled."
    const allowedDomain =
      process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";
    if (!user.email.toLowerCase().endsWith(`@${allowedDomain}`)) {
      await supabase.auth.signOut();
      const url = new URL(`${origin}/login`);
      url.searchParams.set("error", "not_authorized");
      url.searchParams.set("reason", "student_wrong_domain");
      url.searchParams.set("next", next);
      return redirectWithCookies(url.toString(), captured);
    }

    // Student-row resolution (anonymized roster lookup) is deferred to
    // /exam/[token]'s page handler — needs the canvas_assignment_id from
    // the URL to scope the roster check to the right course.
    return redirectWithCookies(`${origin}${next}`, captured);
  }

  // Teacher path.
  // Google OAuth tokens come back on the Supabase session — capture them so
  // server-side Drive calls (Picker token, Save-to-Drive, PDF intake) work
  // without a fresh sign-in. refresh_token only on first consent / when
  // prompt=consent is set on the sign-in (it is — see /auth/login route).
  try {
    await ensureTeacherForUser(
      {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata as {
          full_name?: string;
          name?: string;
          sub?: string;
        },
      },
      {
        access_token: data.session.provider_token,
        refresh_token: data.session.provider_refresh_token,
      },
    );
  } catch (err) {
    await supabase.auth.signOut();
    const reason = err instanceof Error ? err.message : "policy";
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "not_authorized");
    url.searchParams.set("reason", reason);
    return redirectWithCookies(url.toString(), captured);
  }

  const response = redirectWithCookies(`${origin}${next}`, captured);
  if (data.session.provider_refresh_token) {
    response.cookies.set("_grt", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
  }
  return response;
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
