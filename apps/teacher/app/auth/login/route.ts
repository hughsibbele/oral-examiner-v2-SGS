import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const cookieStore = await cookies();
  const hasRefreshToken = cookieStore.get("_grt")?.value === "1";

  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const callbackUrl = new URL("/auth/callback", request.nextUrl.origin);
  callbackUrl.searchParams.set("next", next);

  const SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/documents",
  ].join(" ");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      scopes: SCOPES,
      queryParams: {
        hd: "episcopalhighschool.org",
        prompt: hasRefreshToken ? "select_account" : "consent",
        access_type: "offline",
      },
    },
  });

  if (error || !data.url) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", error?.message ?? "oauth_init_failed");
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(data.url);
}
