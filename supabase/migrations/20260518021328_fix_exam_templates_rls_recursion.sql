-- M2b.5b: fix the long-standing mutual recursion between
--   exam_templates_student_by_session (queries exam_sessions)
--   exam_sessions_teacher_all       (queries exam_templates)
-- Postgres flags this as "infinite recursion detected in policy for
-- relation exam_templates" the first time both policies are evaluated.
--
-- Standard Supabase fix: SECURITY DEFINER helper functions that bypass
-- RLS, called from the policies in place of the cross-table subselects.

create or replace function current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from teachers where auth_user_id = auth.uid() limit 1;
$$;

revoke execute on function current_teacher_id() from public;
grant execute on function current_teacher_id() to authenticated, service_role;

create or replace function current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from students where auth_user_id = auth.uid() limit 1;
$$;

revoke execute on function current_student_id() from public;
grant execute on function current_student_id() to authenticated, service_role;

create or replace function teacher_owns_exam_template(t_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from exam_templates
    where id = t_id and teacher_id = current_teacher_id()
  );
$$;

revoke execute on function teacher_owns_exam_template(uuid) from public;
grant execute on function teacher_owns_exam_template(uuid) to authenticated, service_role;

-- Rewrite the four affected policies to call the helpers.

drop policy if exists exam_templates_teacher_all on exam_templates;
create policy exam_templates_teacher_all on exam_templates
  for all using (teacher_id = current_teacher_id())
  with check (teacher_id = current_teacher_id());

drop policy if exists exam_template_bindings_teacher_all on exam_template_bindings;
create policy exam_template_bindings_teacher_all on exam_template_bindings
  for all using (teacher_id = current_teacher_id())
  with check (teacher_id = current_teacher_id());

drop policy if exists exam_sessions_teacher_all on exam_sessions;
create policy exam_sessions_teacher_all on exam_sessions
  for all using (teacher_owns_exam_template(exam_template_id))
  with check (teacher_owns_exam_template(exam_template_id));

-- Student-side policy on exam_templates closed the recursion loop. The
-- M2b.5d student flow isn't built yet, so dropping is fine for now; when
-- /exam/<token> ships, students read via the binding via service-role.
drop policy if exists exam_templates_student_by_session on exam_templates;
