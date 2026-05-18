-- M2b.5b dashboard refactor: templates become standalone (reusable across
-- Canvas assignments), with a separate bindings table mapping which template
-- is used for which assignment.
--
-- Today: exam_templates has (canvas_course_id, canvas_assignment_id, exam_token)
-- columns and is 1:1 with a Canvas assignment. After this migration:
--   - bindings table carries the (course, assignment, token, template_id)
--     mapping; one template can be bound to many assignments
--   - exam_templates columns canvas_course_id / canvas_assignment_id /
--     exam_token become nullable for one transition cycle; new templates
--     leave them NULL.
--
-- Existing rows migrate 1:1: each exam_templates row gets one binding row
-- pointing at itself, preserving the current exam_token URL slugs.

create table exam_template_bindings (
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_course_id text not null,
  canvas_assignment_id text not null,
  exam_template_id uuid not null references exam_templates (id) on delete cascade,
  exam_token text not null unique,
  bound_at timestamptz not null default now(),
  primary key (teacher_id, canvas_assignment_id)
);

create index exam_template_bindings_template_idx
  on exam_template_bindings (exam_template_id);
create index exam_template_bindings_course_idx
  on exam_template_bindings (teacher_id, canvas_course_id);

-- Carry existing per-assignment templates over as 1:1 bindings.
insert into exam_template_bindings (
  teacher_id, canvas_course_id, canvas_assignment_id,
  exam_template_id, exam_token, bound_at
)
select teacher_id, canvas_course_id, canvas_assignment_id,
       id, exam_token, created_at
from exam_templates
where canvas_assignment_id is not null
  and canvas_course_id is not null
  and exam_token is not null;

-- Loosen the now-redundant columns on exam_templates. Keep them for one
-- cycle so legacy code paths don't crash; new code reads from the bindings
-- table.
alter table exam_templates
  alter column canvas_assignment_id drop not null,
  alter column canvas_course_id drop not null,
  alter column exam_token drop not null;

-- RLS — bindings inherit teacher_id ownership.
alter table exam_template_bindings enable row level security;

create policy exam_template_bindings_teacher_all on exam_template_bindings
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

create policy exam_template_bindings_admin_read on exam_template_bindings
  for select using (is_admin());

comment on table exam_template_bindings is
  'M2b.5b: which exam_template a Canvas assignment uses, with the per-assignment exam_token URL slug. One template can be bound to multiple assignments.';
comment on column exam_templates.canvas_assignment_id is
  'DEPRECATED M2b.5b — moved to exam_template_bindings. Kept nullable for one transition cycle.';
comment on column exam_templates.canvas_course_id is
  'DEPRECATED M2b.5b — moved to exam_template_bindings.';
comment on column exam_templates.exam_token is
  'DEPRECATED M2b.5b — moved to exam_template_bindings.';
