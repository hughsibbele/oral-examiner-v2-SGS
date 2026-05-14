# Oral Examiner v2 — Working Notes

The canonical plan lives in [super-grader's planning folder](../../Super%20Grader/planning/oral-examiner-v2.md) — that's the source of truth for scope, architecture, and design. This file holds only the working notes that don't fit there (gotchas hit during the build, in-progress sequencing).

## How to read this repo

- **What's it doing?** → `planning/oral-examiner-v2.md` in super-grader. Refinements section captures the post-AI-Documenter patterns this build inherits.
- **What's built locally?** → `BUILD_PLAN.md` (status snapshot, phase tracker).
- **What's the data shape?** → `supabase/migrations/` (initial schema is one big migration; deltas land as new dated files).

## Conventions inherited from sibling projects

- pnpm workspaces; package name format `@oral-examiner/<name>`.
- Migrations dated `YYYYMMDDHHMMSS_*.sql` so they sort lexicographically.
- Cookie-based `@supabase/ssr` everywhere; no `@supabase/supabase-js` browser-client + localStorage contortions (lesson from AI Documenter's iframe debacle).
- Anonymizer salt is `SUPER_GRADER_SALT`, must match super-grader's value byte-for-byte. PII never reaches Gemini.
- `is_admin()` is `SECURITY DEFINER` to avoid RLS recursion (HAH pattern, AI Doc adopted).
- `_arg` underscore-prefixed args/vars are intentional placeholders for not-yet-consumed plumbing; eslint warns are suppressed for that pattern.

## Status

See [`../BUILD_PLAN.md`](../BUILD_PLAN.md) for ecosystem-wide milestones and current state. M2b covers the remaining Oral Examiner work (template editor, branded-card install, roster sync, Gemini Live, exam flow, super-grader webhook).

## Gotchas worth remembering

- **Dev runs on port 3001, not 3000.** Super-grader takes 3000. `dev` script in `apps/teacher/package.json` is `next dev -p 3001`. If you change this, update `NEXT_PUBLIC_BASE_URL` and the Supabase redirect-URL allowlist (next gotcha) in lockstep.
- **Supabase Auth → URL Configuration → Redirect URLs must include `http://localhost:3001/**`** (and any other dev origin you use). Without it, the OAuth round-trip falls back to Site URL on completion and the `next` param is silently dropped — sign-in *appears* to work but lands on the wrong page. AI Doc hit this; we hit it again. Direct link: <https://supabase.com/dashboard/project/fxkorwqdibnukuernntq/auth/url-configuration>.
- **`.env.example` is the canonical filename** (matches super-grader / AI Doc / Handwritten), not `.env.local.example`. Workspace policy is "`.env.example` is canonical; code and Vercel conform to it." Keep these consistent across the ecosystem.
- **Modern Supabase key name: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_*` value).** Legacy JWT-style `ANON_KEY` still works but the new format is the AI-Doc-onwards standard. Both browser + server clients in `lib/supabase/` read the new var name.
- **Service role key isn't surfacable via MCP.** `get_publishable_keys` returns the anon JWT and the publishable key, never the service role. Pull manually from the dashboard.
- **`pbcopy` swallows stdout.** Generation commands like `node -e "..." | pbcopy` print nothing in the terminal — the value goes straight to the macOS clipboard. Not a failure mode; just paste.
- **Restart `pnpm dev` after editing `.env.local`.** Next.js dev only re-reads env vars on server start, not on hot-reload. If you set an env var and the app still acts like it's missing, that's the cause.
- **Server-action unhandled rejections vanish silently in the browser.** If a server action throws uncaught, the form's `startTransition` callback's `await` rejects, the rest of the callback doesn't run, no status message renders, and the button just re-enables. Diagnostic: check the terminal where `pnpm dev` is running — server-side throws log there.
- **Asymmetric vs symmetric token names.** OE v2's `SUPER_GRADER_INGEST_TOKEN` = super-grader's `ORAL_EXAMINER_INGEST_TOKEN` (asymmetric: each side names after who it's talking to). OE v2's `ORAL_EXAMINER_API_TOKEN` = super-grader's `ORAL_EXAMINER_API_TOKEN` (symmetric: same name both sides). The mental model is in README.md → Secrets.
