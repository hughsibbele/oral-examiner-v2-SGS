-- Follow-up to M7.1: drop the legacy plaintext Google OAuth token
-- columns from `teachers`.
--
-- DO NOT APPLY until the operator has:
--   1. Set `TEACHER_GTOKEN_ENC_KEY` in Vercel + apps/teacher/.env.local.
--   2. Run `APP=oe node scripts/backfill-teacher-gtoken-encryption.mjs`
--      (suite root) and confirmed the post-run sanity check reports
--      "✅ clean — safe to apply the drop-plaintext follow-up migration."
--   3. Verified manually via:
--        select count(*) from teachers
--          where google_access_token is not null
--             or google_refresh_token is not null;
--      → 0.
--
-- Step 2's idempotent. Step 3 is the audit trail check.
--
-- Once dropped, `lib/google/auth.ts` no longer falls back to the
-- plaintext columns — every teacher row must have valid encrypted
-- tokens or the auth flow throws `missing_refresh_token`. The
-- fallback-removal is a separate code commit landing alongside this
-- migration's apply.
--
-- Note: OE's initial schema (20260513000001_initial.sql) also has
-- `google_oauth_tokens jsonb` which was an even older shape — kept
-- nullable since nothing reads it today. NOT dropped here to keep
-- this migration narrow; can be cleaned up later if/when verified
-- unused.

alter table teachers
  drop column google_access_token,
  drop column google_refresh_token;

comment on table teachers is
  'Google OAuth tokens stored encrypted-only on google_*_encrypted '
  '(M7.1 + 2026-05-24 plaintext-column drop). Decrypt via '
  'lib/google/auth.ts → readEncryptedOrLegacy now reads only the '
  'encrypted columns.';
