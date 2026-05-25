"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
].join(" ");

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 18 18"
      className="rounded-full bg-white p-0.5"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86a5.27 5.27 0 0 1-4.96-3.66H.96v2.3A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M4.04 10.76A5.4 5.4 0 0 1 3.76 9c0-.61.1-1.2.28-1.76V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06l3.08-2.3z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.08 2.3A5.27 5.27 0 0 1 9 3.58z"
      />
    </svg>
  );
}

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
    <div className="flex min-h-dvh items-center justify-center bg-paper p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl bg-white px-8 py-10 shadow-sm ring-1 ring-ink/10">
        <div className="space-y-3 text-center">
          <img
            src="/brand/ehs-horizontal.webp"
            alt="Episcopal High School"
            className="mx-auto h-12 w-auto"
          />
          <h1 className="heading text-2xl">Oral Examiner</h1>
          <p className="text-sm text-cool-gray">
            {isStudentPath
              ? "Sign in to begin your oral defense."
              : "Manage exams and review student sessions."}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <div className="font-medium">
              {reason === "student_wrong_domain"
                ? "This exam is for EHS students only."
                : `Sign-in error: ${error}`}
            </div>
            {reason === "student_wrong_domain" && (
              <div className="mt-1 text-xs text-red-800">
                Sign in with your @episcopalhighschool.org Google account.
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={signIn}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-sm bg-maroon px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-maroon-dark disabled:opacity-50"
          >
            <GoogleMark />
            {busy ? "Redirecting…" : "Sign in with EHS Google"}
          </button>
          <p className="text-center text-xs italic text-cool-gray">
            EHS Workspace accounts only.
          </p>
        </div>
      </div>
    </div>
  );
}
