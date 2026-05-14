# Oral Examiner v2 — Build Plan

Companion to [`planning/oral-examiner-v2.md` in super-grader](../../Super%20Grader/planning/oral-examiner-v2.md), which is the canonical plan. This doc tracks what's actually built locally.

## Status snapshot — 2026-05-13

| Phase | Description | Status |
|---|---|---|
| **1** | Scaffolding, schema, anonymizer + crypto, cookie auth, admin layer | ✅ done (verified end-to-end in browser) |
| **2** | Teacher template authoring + branded Canvas card install | 🟡 in progress — first chunk done (Canvas client + token setup + course/assignment cache, verified); template editor + branded-card install + roster sync pending |
| **3** | Student exam flow + Canvas writes on completion | ⏳ not started |
| **4** | Admin tier (prompt management, retention, diagnostics) | ⏳ not started |
| **5** | Hardening (rate-limit tune, Sentry, retention CSV) | ⏳ not started |

**Live Supabase project:** `fxkorwqdibnukuernntq` (us-east-1, Postgres 17.6.1.121). All 4 migrations applied: initial schema (12 tables, RLS on every one, `is_admin()` SECURITY DEFINER); prompts table + 5 seeded system prompts; `gemini_usage_daily` ledger + atomic `check_and_increment_*` functions; security hardening (search_path pin + explicit anon revoke). `apps/teacher/.env.local` fully populated (URL + publishable key + service role key).

**Live walkthrough — 2026-05-13.** Cookie auth verified: Google SSO with `hd=episcopalhighschool.org` enforced; `/auth/callback` exchanges code → upserts teacher row → redirects. Canvas-token setup verified: paste host + token → `getSelf()` round-trip → AES-256-GCM encrypt at rest → persist on teacher row. Dev runs on **port 3001** (super-grader takes 3000); `next dev -p 3001` configured in the dev script.

## Phase 1 — what's landed

### Workspace + tooling
- pnpm workspace skeleton, `tsconfig.base.json`, root `package.json` with workspace scripts.
- `.env.example` at workspace root is the canonical source of truth (matches super-grader / AI Doc / Handwritten convention). `apps/teacher/.env.local` is the local-dev copy. Both use the modern `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_*`) instead of the legacy `ANON_KEY` (JWT).
- Asymmetric ingest-token naming model documented in README.md → Secrets: this side's `SUPER_GRADER_INGEST_TOKEN` equals super-grader's `ORAL_EXAMINER_INGEST_TOKEN` (same value, named after who you're talking to). Symmetric `ORAL_EXAMINER_API_TOKEN` (same name both sides).
- `.gitignore` mirrors super-grader's conventions.

### Schema (four migrations, all applied to live project)
1. **`20260513000001_initial.sql`** — `teachers`, `admins`, `is_admin()` SECURITY DEFINER helper, `students`, `exam_templates`, `exam_sessions`, `course_rosters`, `canvas_course_cache`, `canvas_assignment_cache`, `course_install_policies`, `submission_attempts`. Full RLS scoped to teacher-own-data + admin-bypass for system-scoped reads.
2. **`20260513000002_prompts.sql`** — `prompts` table with `scope` (system | template) + `purpose` enum + per-teacher key/body/version. Seed inserts five system prompts as placeholders (`voice_agent`, `student_summary`, `eval_generation`, `rubric`, `transcription`).
3. **`20260513000003_gemini_usage.sql`** — `gemini_usage_daily` ledger + `check_and_increment_gemini_live_minutes()` and `check_and_increment_gemini_text_calls()` SECURITY DEFINER functions with `FOR UPDATE` row lock.
4. **`20260513000004_security_hardening.sql`** — search_path pinned on `set_updated_at`; explicit `revoke execute … from anon` on the three SECURITY DEFINER functions (defense-in-depth after the advisor flagged the implicit anon executability).

### Packages
- `@oral-examiner/anonymizer` — token generation (HMAC-SHA256 against `SUPER_GRADER_SALT`), name-redaction scrubber with longest-first roster compilation, de-anonymizer. Mirrors super-grader's implementation; tests not yet ported.
- `@oral-examiner/crypto` — AES-256-GCM helper for at-rest Canvas token storage. Same shape as super-grader.
- `@oral-examiner/db` — Supabase types generated from the live project, committed to `src/generated.ts`. Re-run via MCP `generate_typescript_types` after every schema change.

### App skeleton (`apps/teacher`)
- Next.js 16 + React 19 + Tailwind v4 + cookie-based `@supabase/ssr`.
- Routes: `/` (redirect), `/login`, `/auth/callback`, `/auth/signout`, `/dashboard`, `/admin`, `/exam/[token]` (placeholder).
- `lib/supabase/{server,client,admin}.ts` for cookie / browser / service-role clients.
- `lib/auth/teacher.ts` — `ensureTeacherForUser()` upsert on sign-in, domain-gated to `@episcopalhighschool.org`.
- `lib/auth/admin.ts` — `isAdmin()`, `requireAdmin()`, `bootstrapAdminIfNeeded()` self-promotes the `INITIAL_ADMIN_EMAIL` on first `/admin` visit if no admins exist yet.
- EHS-brand globals.css (maroon, dark-blue, paper, ink palette) — matches AI Documenter's brand layer.
- Unified `/auth/callback` routes by `next` prefix: `/exam/*` → student path (stub upsert deferred until Canvas roster lands in Phase 2); else → teacher upsert.

## Phase 2 — what's landed

### `@oral-examiner/canvas`
- `normalizeHost`, `canvasFetch` (internal), `paginate` (internal) with Link-header pagination.
- `getSelf` — token verification.
- `listTeachingCourses` — with `include[]=term` so we can active-term filter.
- `listCourseAssignments` — published only, with `submission_types` included.
- `getAssignment` — single fetch, used by the branded-card install path (next chunk).
- Typed `CanvasError` with status + body.

### Canvas token setup flow
- `/dashboard/canvas` — `CanvasTokenForm` (host + token paste fields).
- `saveCanvasToken` server action — verifies via `getSelf`, encrypts via `@oral-examiner/crypto`, persists `canvas_token_encrypted` + `canvas_host` on the `teachers` row. Service-role write (defense in depth — the blob shouldn't leak through stale RLS misconfig).
- `lib/canvas/server.ts` — `getCanvasConfigForTeacher()` decrypts and resolves the config for whoever's currently authed.

### Dashboard course list
- `/dashboard` reads `canvas_course_cache` and renders one row per course (name + course_code + term + workflow_state). Falls back to a "connect Canvas" CTA if no token.
- `RefreshCoursesButton` triggers `refreshCourses` server action: pulls `listTeachingCourses`, applies the **active-term filter** (AI Doc pattern — current academic-year prefix derived from today, ~10x sync-time reduction), upserts into `canvas_course_cache`. Fails open: if no course matches the prefix, all are cached (so a teacher mid-summer isn't locked out).

### Per-course assignment list
- `/dashboard/courses/[id]` reads `canvas_assignment_cache` filtered to that course; shows name, due date, points, submission_types.
- `RefreshAssignmentsButton` triggers `refreshAssignments` server action: pulls `listCourseAssignments`, filters to `published`, upserts into `canvas_assignment_cache`.

## What's deferred from Phases 1 + 2

- Anonymizer + crypto tests (port from super-grader once the salt path is verified end-to-end with a real Gemini call).
- `packages/gemini` wrapper around `@google/genai` — Phase 3, when there's a real call site.
- Sentry `instrumentation.ts` + `instrumentation-client.ts` — env vars wired, init deferred.
- `/admin/prompts` and `/admin/admins` rich UIs — stub pages render; CRUD actions land when the schema is verified migration-clean.
- `/exam/[token]` is a placeholder; full intake → live call → completion pipeline is Phase 3.
- **Template editor** (per-template question bank, reference texts, topic context) — Phase 2 second chunk.
- **Branded card install** (`updateAssignmentDescription` + marker block + idempotent reinstall) — Phase 2 second chunk.
- **Roster sync** (Canvas `/courses/:id/users` → `course_rosters` jsonb) — Phase 2 second chunk; needed for the anonymizer regex.
- **Auto-install policy + nightly cron** — Phase 5 hardening.

## Next steps

The dev loop is unblocked: sign-in and Canvas-token setup both work. Remaining sequence:

1. **Smoke-test the cached course + assignment views** end-to-end (refresh courses → click into one → refresh assignments). Should be immediate now that the token is saved.
2. **Phase 2 second chunk** — template editor + branded-card install (`updateAssignmentDescription` with marker block, idempotent reinstall) + roster sync (Canvas `/courses/:id/users` → `course_rosters` jsonb, feeds the anonymizer regex).
3. **Phase 3** — Gemini Live relay, anonymizer-scrubbed prompts, post-completion Canvas writes (body via masquerade + draft eval comment via teacher token).
4. **Phase 4** — admin tier rich UIs (prompts CRUD, admins manage, retention sweep) + diagnostic session view.
5. **Phase 5** — Sentry instrumentation, retention CSV export, auto-install policy + nightly cron, active-term-filter tightening.

## Open follow-ups (don't block any specific phase)

- **Performance advisors flagged but deferred.** `auth_rls_initplan` lint suggests wrapping `auth.uid()` calls in RLS policies as `(select auth.uid())` for per-query memoization. Unindexed foreign keys on `course_install_policies.default_exam_template_id` and `exam_sessions.student_id` — both have low cardinality at this stage. Revisit when query volume is real.
- **Symlink `.env.local` to a workspace-root copy** so all packages share env vars (super-grader pattern). Currently only `apps/teacher` reads its own copy; packages don't need env vars yet.
- **`saveCanvasToken` doesn't surface every error to the form.** `readKeyFromEnv()` and `encryptSecret()` throw uncaught if the encryption key is missing or malformed; the form silently re-enables. Acceptable while only Hugh runs it locally; harden before multi-teacher rollout.
