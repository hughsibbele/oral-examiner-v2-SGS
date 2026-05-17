// Mint a short-lived Google OAuth access token for the browser-side Drive
// Picker. The long-lived refresh_token never leaves the server.
//
// The Picker also needs an `appId` (Google Cloud project number) and a
// `developerKey` (Google Cloud API key). Both are public-by-design and ship
// via NEXT_PUBLIC_GOOGLE_APP_ID + NEXT_PUBLIC_GOOGLE_PICKER_API_KEY.

import { NextResponse } from "next/server";
import { getTeacher } from "@/lib/auth/teacher";
import { getTeacherAccessToken, GoogleAuthError } from "@/lib/google/auth";

export const runtime = "nodejs";

export async function POST() {
  const teacherCtx = await getTeacher();
  if (!teacherCtx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const { access_token, expires_at } = await getTeacherAccessToken(
      teacherCtx.teacher.id,
    );
    return NextResponse.json({ access_token, expires_at });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "missing_refresh_token" ? 401 : 500 },
      );
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
