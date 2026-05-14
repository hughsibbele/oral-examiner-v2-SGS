-- Security hardening — addresses advisor warnings from the initial schema apply.
-- 1. Pin search_path on set_updated_at (mutable search_path lint).
-- 2. Explicitly revoke EXECUTE on SECURITY DEFINER functions from anon
--    (revoke-from-PUBLIC already done in their original migrations; this is
--    explicit-anon defense-in-depth per the advisor's recommendation).

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function is_admin() from anon;
revoke execute on function check_and_increment_gemini_live_minutes(uuid, numeric, numeric) from anon;
revoke execute on function check_and_increment_gemini_text_calls(uuid, int) from anon;
