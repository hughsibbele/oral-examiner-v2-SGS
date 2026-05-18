-- Oral Examiner v2 — M2b.5b.10 — refund unused dry-run minutes
--
-- Pair to check_and_increment_gemini_live_minutes. When a Live session
-- closes earlier than the full SESSION_RESERVATION_MINUTES it pre-reserved,
-- the client calls /api/try-out/refund with how many minutes were actually
-- spent, and we credit the unused portion back to today's row. Lets us
-- raise the cap to 30 min/day without burning it in 3-4 failed connects.
--
-- Floors at zero so an over-refund (clock skew, double-call) can't push
-- live_minutes negative.

create or replace function refund_gemini_live_minutes(
  p_teacher_id uuid,
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

  update gemini_usage_daily
    set live_minutes = greatest(0, live_minutes - p_minutes),
        updated_at = now()
    where teacher_id = p_teacher_id
      and date = current_date;
end;
$$;

revoke all on function refund_gemini_live_minutes(uuid, numeric) from public;
grant execute on function refund_gemini_live_minutes(uuid, numeric)
  to authenticated, service_role;
