"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// `drive.file` lets the teacher attach files to exam templates (intake
// attachments + save-template-to-Drive). Non-sensitive scope; per-file
// authorization (Google only exposes files the user explicitly opens in our
// app's Picker).
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

export function LoginForm() {
  const params = useSearchParams();
  const error = params.get("error");
  const reason = params.get("reason");
  const next = params.get("next") ?? "/dashboard";
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: SCOPES,
        queryParams: {
          access_type: "offline",
          // `prompt=consent` forces Google to re-show the consent screen.
          // Without it, Google silently skips consent when a sibling app on
          // the same OAuth client (the converged suite client) has already
          // been authorized — and skipping consent also skips refresh-token
          // issuance, leaving the server unable to refresh the access token
          // when it expires an hour later. HK / HH hit this; we inherit.
          prompt: "consent",
          hd: "episcopalhighschool.org",
        },
      },
    });
    if (error) {
      setBusy(false);
      alert(`Sign-in failed: ${error.message}`);
    }
  }

  const isStudentPath = next.startsWith("/exam/");

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-sm w-full space-y-6">
        <div>
          <h1 className="heading text-3xl">Oral Examiner</h1>
          <p className="muted mt-1 text-sm">
            {isStudentPath
              ? "Sign in to begin your oral defense."
              : "Sign in to manage exams and review sessions."}
          </p>
        </div>

        {error && (
          <div className="surface p-3 text-sm border-maroon">
            <div className="font-medium text-maroon">Sign-in error: {error}</div>
            {reason && <div className="muted mt-1 text-xs">{reason}</div>}
          </div>
        )}

        <button
          onClick={signIn}
          disabled={busy}
          className="btn btn-primary w-full justify-center py-2"
        >
          {busy ? "Redirecting…" : "Continue with Google"}
        </button>

        <p className="muted text-xs">
          Restricted to @episcopalhighschool.org accounts.
        </p>
      </div>
    </main>
  );
}
