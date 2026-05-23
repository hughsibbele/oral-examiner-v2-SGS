-- M7.1 — encrypt OE's Google OAuth tokens at rest.
--
-- Closes the suite-wide drift: HH M6.22 Phase 0b + AID M7.3 ship
-- encrypted Google tokens; OE was the laggard with plaintext columns
-- (added by 20260517000000_teacher_google_tokens). This brings OE in
-- line.
--
-- Dual-read pattern mirroring HH M6.22 Phase 0b shape:
--   - Add `*_encrypted text` columns alongside the existing plaintext.
--   - Application code writes encrypted-only on every callback + refresh,
--     nulls the plaintext on the same write.
--   - Reads prefer encrypted; fall back to legacy plaintext for un-
--     backfilled rows.
--   - A follow-up migration drops the plaintext columns once the
--     operator confirms backfill is complete and `google_access_token
--     IS NULL AND google_refresh_token IS NULL` holds across the table.
--
-- Key source: TEACHER_GTOKEN_ENC_KEY env var (matches HH + AID naming
-- for cross-app rotation alignment). Until set, writes throw and the
-- auth callback surfaces an error — reads continue via plaintext
-- fallback so existing teachers stay functional.

alter table teachers
  add column google_access_token_encrypted text,
  add column google_refresh_token_encrypted text;

comment on column teachers.google_access_token_encrypted is
  'M7.1 — AES-256-GCM envelope of Google OAuth access_token. base64(iv '
  '|| authTag || ciphertext). Key: TEACHER_GTOKEN_ENC_KEY (matches HH/'
  'AID naming).';
comment on column teachers.google_refresh_token_encrypted is
  'M7.1 — AES-256-GCM envelope of Google OAuth refresh_token. Same '
  'shape as google_access_token_encrypted. Only returned on first '
  'consent (LoginForm sets prompt=consent + access_type=offline).';
