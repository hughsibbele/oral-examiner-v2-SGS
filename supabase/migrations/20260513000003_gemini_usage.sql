-- gemini_usage_daily — per-teacher rate-limit ledger.
-- Pattern adapted from AI Documenter, with a separate column for
-- Gemini Live minutes (billed by audio time, not call count).

create table gemini_usage_daily (
  teacher_id uuid not null references teachers (id) on delete cascade,
  date date not null default current_date,
  live_minutes numeric not null default 0,
  text_calls int not null default 0,
  denials int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (teacher_id, date)
);

create index gemini_usage_daily_date_idx on gemini_usage_daily (date);

alter table gemini_usage_daily enable row level security;

create policy gemini_usage_teacher_read on gemini_usage_daily
  for select using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

create policy gemini_usage_admin_read on gemini_usage_daily
  for select using (is_admin());

-- =========================================================================
-- Atomic check-and-increment for Gemini Live audio minutes.
-- SECURITY DEFINER so the check happens under privileged scope; FOR UPDATE
-- row lock prevents two concurrent sessions of the same teacher from
-- both squeaking past the cap.
--
-- Returns true on success (caller may proceed and burn the requested minutes);
-- false on cap exceeded (caller must reject the request with a clear UX).
-- Fails open on DB error — caller catches and proceeds. Better to over-serve
-- a student mid-exam than block them on a rate-limiter glitch.
-- =========================================================================

create or replace function check_and_increment_gemini_live_minutes(
  p_teacher_id uuid,
  p_requested numeric,
  p_default_cap numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap numeric;
  v_used numeric;
begin
  -- Resolve the cap: per-teacher override beats env default.
  select coalesce(t.gemini_live_daily_cap_minutes, p_default_cap)
    into v_cap
    from teachers t
    where t.id = p_teacher_id;

  if v_cap is null then
    -- Teacher row missing or cap not set anywhere. Fail open.
    return true;
  end if;

  -- Lock the row for this teacher+date.
  insert into gemini_usage_daily (teacher_id, date, live_minutes, text_calls)
  values (p_teacher_id, current_date, 0, 0)
  on conflict (teacher_id, date) do nothing;

  select live_minutes
    into v_used
    from gemini_usage_daily
    where teacher_id = p_teacher_id and date = current_date
    for update;

  if v_used + p_requested > v_cap then
    update gemini_usage_daily
      set denials = denials + 1, updated_at = now()
      where teacher_id = p_teacher_id and date = current_date;
    return false;
  end if;

  update gemini_usage_daily
    set live_minutes = live_minutes + p_requested, updated_at = now()
    where teacher_id = p_teacher_id and date = current_date;

  return true;
end;
$$;

revoke all on function check_and_increment_gemini_live_minutes(uuid, numeric, numeric) from public;
grant execute on function check_and_increment_gemini_live_minutes(uuid, numeric, numeric)
  to authenticated, service_role;

-- =========================================================================
-- Same shape for text-call rate limiting (post-call summary + eval prompts).
-- =========================================================================

create or replace function check_and_increment_gemini_text_calls(
  p_teacher_id uuid,
  p_default_cap int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_used int;
begin
  select coalesce(t.gemini_text_daily_cap, p_default_cap)
    into v_cap
    from teachers t
    where t.id = p_teacher_id;

  if v_cap is null then
    return true;
  end if;

  insert into gemini_usage_daily (teacher_id, date, live_minutes, text_calls)
  values (p_teacher_id, current_date, 0, 0)
  on conflict (teacher_id, date) do nothing;

  select text_calls
    into v_used
    from gemini_usage_daily
    where teacher_id = p_teacher_id and date = current_date
    for update;

  if v_used + 1 > v_cap then
    update gemini_usage_daily
      set denials = denials + 1, updated_at = now()
      where teacher_id = p_teacher_id and date = current_date;
    return false;
  end if;

  update gemini_usage_daily
    set text_calls = text_calls + 1, updated_at = now()
    where teacher_id = p_teacher_id and date = current_date;

  return true;
end;
$$;

revoke all on function check_and_increment_gemini_text_calls(uuid, int) from public;
grant execute on function check_and_increment_gemini_text_calls(uuid, int)
  to authenticated, service_role;
