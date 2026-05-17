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

See [`../BUILD_PLAN.md`](../BUILD_PLAN.md) ([on GitHub](https://github.com/hughsibbele/super-grader-suite/blob/main/BUILD_PLAN.md)) for ecosystem-wide milestones and current state. M2b covers the remaining Oral Examiner work (template editor, branded-card install, roster sync, Gemini Live, exam flow, super-grader webhook).

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

## Gemini Live (gotchas from M2b.1j build, 2026-05-17)

The audio dry-run at `/dashboard/agents/[id]/try` runs against Gemini Live via `@google/genai`. Several non-obvious things that cost an hour each:

- **Use `gemini-3.1-flash-live-preview` (March 2026), not `gemini-2.5-flash-preview-native-audio-dialog`.** The 2.5 native-audio dialog model was **removed by Google on 2026-03-19**. Symptoms: `models/<old-name> is not found`. Default env: `GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview`. Same per-token price as 2.5 (~$3/M input, $12/M output → ~$0.17 per 15-min session), better quality, supports `thinkingConfig.thinkingLevel`.

- **`apiVersion` is nested under `httpOptions`, not at the top level of the `GoogleGenAI` constructor.** Wrong: `new GoogleGenAI({ apiKey, apiVersion: "v1alpha" })` — silently ignored, falls back to `v1main` (GA). Right: `new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } })`. v1alpha is REQUIRED for ephemeral tokens + preview Live models. Symptom: `models/<correct-name> is not found for API version v1main, or is not supported for bidiGenera`.

- **Use `audio` not `media` in `sendRealtimeInput`.** v1alpha deprecated the generic `media` chunk field in favor of typed `audio` / `video` / `text`. Wrong: `{ media: { data, mimeType } }` → server rejects with `realtime_input.media_chunks is deprecated`. Right: `{ audio: { data, mimeType: "audio/pcm;rate=16000" } }`.

- **`ThinkingLevel` is an exported enum, not a string.** Use `ThinkingLevel.LOW`, not `"low"`. TypeScript will catch this, but the suggested fix in the error message is the right one.

- **Live API doesn't auto-greet on connect.** The model only speaks in response to a user turn. To have the agent open the conversation, fire `session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "(hidden cue…)" }] }], turnComplete: true })` right after `ai.live.connect()` resolves. The cue won't appear in `inputAudioTranscription` (that only fires for audio turns), so it stays out of the visible transcript.

- **`onopen` callback fires *before* `ai.live.connect()` resolves.** So `sessionRef.current` is still null inside `onopen`. Capture the session via the local variable returned by the awaited `connect()` instead, and trigger post-open work from there.

- **Ephemeral auth tokens via `ai.authTokens.create()` need `liveConnectConstraints`** to pin model + system instruction + voice + modality on the server side. Browser receives the short-lived token, opens Live directly. Long-lived API key never reaches the client. Server route at `app/api/try-out/auth-token/route.ts`.

- **Live audio I/O sample rates are asymmetric.** Input: 16 kHz PCM 16-bit mono (mic side). Output: 24 kHz PCM 16-bit mono (playback side). Use two separate `AudioContext`s.

- **Built-in `silenceDurationMs` VAD is symmetric** (same wait before AND after speech). For an oral exam you want asymmetric — patient before speech (student is thinking), snappy after (they've finished). Solution: disable Gemini's auto-VAD via `realtimeInputConfig.automaticActivityDetection.disabled: true` and run a client-side state machine that sends `{ activityStart: {} }` / `{ activityEnd: {} }` based on local RMS energy detection. See `TryItOut.tsx` — the constants `RMS_THRESHOLD`, `SPEECH_ONSET_MS`, `TRAILING_MS` at top of file are the tuning knobs.

- **Pre-reservation pattern is wasteful.** Each Live session reserves the full `SESSION_RESERVATION_MINUTES` (4) up front against `gemini_usage_daily.live_minutes` regardless of how long the conversation actually runs. Three failed-connect retries during the model-name debug pass burned through 12 of the 15-min daily cap before any audio flowed. **Admins bypass the cap entirely** via `isAdmin()` check in the auth-token route; non-admin teachers stay capped. Long-term fix: track actual usage via session-close callback and refund unused minutes.

- **Voice list is hardcoded in `AgentsEditor.tsx`** (`LIVE_VOICES` const). Current: Aoede / Charon / Fenrir / Kore / Leda / Puck / Orus / Zephyr. Update when Google ships new voices. Per-agent voice via `personality_presets.live_voice_name`.

- **Field-sizing for compact textareas.** `[field-sizing:content]` Tailwind arbitrary class auto-grows a textarea to its content. Works in Chrome/Safari, falls back gracefully to fixed rows in Firefox. Used in the question-bank row layout to keep the editor spreadsheet-tight without per-row scroll bars.
