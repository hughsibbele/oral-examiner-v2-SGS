-- Oral Examiner v2 — M2b.5c.5 / 5d.1 / 5d.4 — three columns for the
-- student exam flow, bundled into one migration so the schema bumps once.
--
-- 1. exam_sessions.excluded_reason — annotates state='excluded' rows so the
--    audit trail says *why* a row was archived. Soft-delete pattern: rows
--    are excluded rather than hard-deleted to preserve history.
--    Allowlist: 'short_attempt_auto' (call_duration_sec < 60 — assumed tech
--    failure; M2b.5c.3 archives and auto-grants a retry), 'abandoned_resume'
--    (row was in 'started' or 'in_progress' when student returned to the
--    exam URL — assumed crash/refresh; same auto-retry semantics),
--    'teacher_reset' (teacher manually cleared the row via the reset
--    affordance), 'failed_eval' (reserved for future use if eval failures
--    ever warrant invalidating the session).
--
-- 2. exam_sessions.live_minutes_used — per-session Gemini Live quota
--    counter. The teacher dry-run flow tracks minutes against
--    gemini_usage_daily (per-teacher per-day); the student real-exam flow
--    tracks against the session itself because we want a per-session
--    budget that bounds spend per attempt rather than per teacher per day.
--    Pre-reservation pattern from M2b.5b.10 reused: 5d.1 reserves the
--    estimated duration up front, 5d.3 refunds the unused tail when the
--    session ends.
--
-- 3. exam_sessions.eval_error — Inngest evaluate-exam onFailure target.
--    HH's transcribe-discussion uses the same pattern (state='failed' +
--    error_message); we keep the state column reserved for 'failed' but
--    write a free-text reason here so the teacher reset / debug paths
--    have something to surface.

alter table exam_sessions
  add column excluded_reason text,
  add column live_minutes_used integer not null default 0,
  add column eval_error text;

alter table exam_sessions
  add constraint exam_sessions_excluded_reason_chk
    check (
      excluded_reason is null
      or excluded_reason in (
        'short_attempt_auto',
        'abandoned_resume',
        'teacher_reset',
        'failed_eval'
      )
    );

comment on column exam_sessions.excluded_reason is
  'M2b.5c.5: why a state=excluded row was archived. NULL for non-excluded states.';
comment on column exam_sessions.live_minutes_used is
  'M2b.5d.1: Gemini Live minutes consumed by this session (pre-reserved at connect, refunded on close). Per-session quota, not per-teacher.';
comment on column exam_sessions.eval_error is
  'M2b.5d.4: free-text error from the Inngest evaluate-exam onFailure path.';

-- =========================================================================
-- refund_gemini_live_minutes_session — session-scoped sibling of the
-- existing teacher-scoped refund_gemini_live_minutes RPC. Same shape;
-- subtracts from exam_sessions.live_minutes_used clamped at zero.
-- =========================================================================

create or replace function refund_gemini_live_minutes_session(
  p_exam_session_id uuid,
  p_minutes numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_minutes is null or p_minutes <= 0 then
    return;
  end if;

  update exam_sessions
    set live_minutes_used = greatest(0, live_minutes_used - p_minutes::integer)
    where id = p_exam_session_id;
end;
$$;

revoke all on function refund_gemini_live_minutes_session(uuid, numeric) from public;
grant execute on function refund_gemini_live_minutes_session(uuid, numeric)
  to authenticated, service_role;
