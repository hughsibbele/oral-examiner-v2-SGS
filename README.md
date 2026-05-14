# Oral Examiner v2

Replaces ChekhovExaminer (Apps Script, in the parent directory). v1 stays in production until v2 is proven on a real assignment.

Planning lives in [super-grader's `planning/oral-examiner-v2.md`](../../Super%20Grader/planning/oral-examiner-v2.md). That file is the source of truth for scope, architecture, and what's currently designed but unbuilt. The `Refinements since 2026-05-05` section folds in the patterns AI Documenter forged (admin layer, prompt-ownership inversion, scrub-at-Gemini-boundary, per-teacher rate limits, branded Canvas entry).

## Status

Phase 1 ✅ done · Phase 2 🟡 in progress — see `BUILD_PLAN.md` for what's been built locally vs. what's still mocked / deferred.

## Local dev

```sh
pnpm install
cp .env.example apps/teacher/.env.local
# Fill in values; see "Secrets" below for the cross-project mapping
pnpm dev
```

The teacher + admin + student-facing exam UI all live in the single `@oral-examiner/teacher` app (`apps/teacher/`). Route groups handle the student/teacher/admin split. Student-facing exam at `/exam/<token>`; teacher at `/dashboard`; admin at `/admin`.

## Stack

- Next.js 16 + React 19 + TypeScript
- Supabase (Postgres + auth + storage) — cookie-based `@supabase/ssr` everywhere
- Tailwind v4
- Gemini via `@google/genai` (text) and Gemini Live (audio) — Phase C wiring
- Anonymizer + AES-256-GCM ecosystem packages, shared salt with super-grader / AI Documenter / Handwritten Helper

## Cross-tool integration

OE v2 receives ingest webhooks from no one and pushes results to **super-grader** at `<SUPER_GRADER_API_URL>/api/ingest/oral_examiner`. Super-grader pulls OE v2's read-only prompt mirrors from `/api/super-grader/prompts/<key>`. See `planning/integration-contract.md` in super-grader for the full contract.

## Secrets

> **Policy: `.env.example` is the canonical source of truth.** If you
> add a new env var in code, add it there in the same PR. If you rename one
> on Vercel, rename it there too. When the two disagree, `.env.example`
> wins — Vercel and code should be brought in line, not the other way around.

### Shared-ecosystem secrets

OE v2 is one of several "satellite" tools that integrate with the Super
Grader project. Some secret *values* are **shared** across projects, but
each project names them after who it's talking to.

| Value | Where it lives | What it does |
|---|---|---|
| **Anonymization salt** | `SUPER_GRADER_SALT` in **OE v2**, **Super Grader**, **AI Documenter**, **Handwritten Helper**, **Harkness Helper** | HMAC salt for the `anon_token`s. Same name everywhere. Never regenerate — invalidates every stored token across all peers. |
| **OE v2 inbound bearer** | `ORAL_EXAMINER_API_TOKEN` in both **OE v2** and **Super Grader** | Same name on both sides. OE v2 accepts requests carrying this bearer; Super Grader presents it on outbound GETs to `/api/super-grader/*`. |
| **OE v2 outbound bearer** | `SUPER_GRADER_INGEST_TOKEN` in **OE v2**, but `ORAL_EXAMINER_INGEST_TOKEN` in **Super Grader** | Asymmetric: we name after who we're authing TO; SG names after who's authing IN. Same value, two perspectives. |
| **Gemini API key** | `GEMINI_API_KEY` everywhere | One key, central billing, same name in every project. |

**Mental model.** The name on **your side** describes who **you** are talking
to. The name on **the other side** describes who **they** are listening to.
That's why the same bearer is `SUPER_GRADER_INGEST_TOKEN` in OE v2 (the
token I present to Super Grader) and `ORAL_EXAMINER_INGEST_TOKEN` in Super
Grader (the token I expect from Oral Examiner).

### Cross-project setup order

When provisioning a fresh deployment, set secrets in this order to avoid
"why is the other tool 401-ing me?" debugging:

1. `SUPER_GRADER_SALT` — copy from a sibling project's env (don't regenerate).
2. Inbound bearer (`ORAL_EXAMINER_API_TOKEN`) — generate fresh, set on both
   this project and Super Grader.
3. Outbound bearer (`SUPER_GRADER_INGEST_TOKEN` here = Super Grader's
   `ORAL_EXAMINER_INGEST_TOKEN`) — generate fresh, set on both sides.
4. `SUPER_GRADER_API_URL` — set once super-grader has a URL.

### When you add a new secret

1. Add the var to `.env.example` with a comment explaining what it
   is, where to get the value from, and what happens if it's missing
2. Read it via `process.env.VAR_NAME`; fail loudly when required and unset
3. Run `vercel env add VAR_NAME production` (and `preview`, `development`
   if the value differs across environments)
4. If shared with another project in this ecosystem, update both sides +
   the cross-project mapping above
