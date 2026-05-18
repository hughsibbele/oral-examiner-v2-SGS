/** Shared knobs for the dry-run try-out flow. Auth-token mint, refund
 *  endpoint, and any future per-session bookkeeping read from here. */

/**
 * Default daily cap when a teacher doesn't have a per-row override on
 * `teachers.gemini_live_dryrun_daily_cap_minutes`. Raised from 15 → 30 in
 * M2b.5b.10 once the refund endpoint shipped — teachers iterating on
 * custom templates were running the cap dry in 3-4 try-outs before refund
 * landed, because each session pre-reserves SESSION_RESERVATION_MINUTES
 * regardless of how long the conversation actually runs.
 */
export const DEFAULT_DRYRUN_CAP_MINUTES = Number(
  process.env.GEMINI_LIVE_DRYRUN_DEFAULT_DAILY_CAP_MINUTES ?? "30",
);

/** Minutes the auth-token mint reserves up front. The refund endpoint
 *  credits back any unused portion (clamped at 0) once the session
 *  closes. */
export const SESSION_RESERVATION_MINUTES = 4;
