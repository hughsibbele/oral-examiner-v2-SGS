/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/* ---------- inline Google mark SVG --------- */

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

/* ---------- error copy --------- */

const ERROR_MESSAGES: Record<string, { title: string; detail?: string }> = {
  exchange_failed: {
    title: "Sign-in handshake failed — this is usually temporary.",
  },
  student_wrong_domain: {
    title: "This exam is for EHS students only.",
    detail: "Sign in with your @episcopalhighschool.org Google account.",
  },
};

/* ---------- page --------- */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; next?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const { error, reason, next: rawNext } = await searchParams;
  const next = rawNext ?? "/dashboard";
  const isStudentPath = next.startsWith("/exam/");

  const loginHref = `/auth/login?next=${encodeURIComponent(next)}`;

  /* Resolve error display */
  const errorKey =
    reason === "student_wrong_domain" ? "student_wrong_domain" : error;
  const errorInfo = errorKey ? ERROR_MESSAGES[errorKey] : null;

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
              {errorInfo?.title ?? `Sign-in error: ${error}`}
            </div>
            {errorInfo?.detail && (
              <div className="mt-1 text-xs text-red-800">
                {errorInfo.detail}
              </div>
            )}
            {error === "exchange_failed" && (
              <Link
                href="/login"
                className="mt-1 inline-block text-xs font-medium text-red-800 underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </Link>
            )}
          </div>
        )}

        <div className="space-y-3">
          <Link
            href={loginHref}
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-sm bg-maroon px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-maroon-dark"
          >
            <GoogleMark />
            Sign in with EHS Google
          </Link>
          <p className="text-center text-xs italic text-cool-gray">
            EHS Workspace accounts only.
          </p>
        </div>
      </div>
    </div>
  );
}
