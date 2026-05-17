-- Per-teacher Google OAuth tokens for server-side Drive access.
--
-- The initial schema added `teachers.google_oauth_tokens jsonb` for this
-- purpose but no code path ever wrote to it. HK / HH ship discrete columns
-- so the same googleapis SDK helper (lib/google/auth.ts) works across the
-- suite without per-app shape divergence. Mirror that here.
--
-- The legacy jsonb column stays for one cycle; drop in a follow-up after
-- this lands and the new columns prove out.

alter table teachers
  add column google_access_token text,
  add column google_refresh_token text,
  add column google_token_expires_at timestamptz;

comment on column teachers.google_access_token is
  'Google OAuth access token. Refreshed server-side ≤5min before expiry.';
comment on column teachers.google_refresh_token is
  'Google OAuth refresh token. Issued on first consent only — preserve across re-sign-ins.';
comment on column teachers.google_token_expires_at is
  'When google_access_token expires. Pessimistic — set to now()+55min on issue (Google access tokens live ~1h).';
