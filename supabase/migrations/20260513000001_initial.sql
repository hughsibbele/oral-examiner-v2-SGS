-- Oral Examiner v2 — initial schema
-- See ../../../Super Grader/planning/oral-examiner-v2.md "Data model" for the design narrative.
--
-- Multi-teacher architecture from day one (admin tier + per-teacher data isolation).
-- Built on the patterns AI Documenter + Handwritten Assignment Helper forged.

create extension if not exists "pgcrypto";

-- =========================================================================
-- teachers
-- =========================================================================

create table teachers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,        -- == auth.users.id
  google_sub text not null unique,
  email text not null unique,               -- lowercased on insert
  display_name text not null,
  canvas_token_encrypted text,              -- AES-256-GCM blob from packages/crypto
  canvas_host text,                          -- e.g. episcopalhighschool.instructure.com
  google_oauth_tokens jsonb,                 -- access + refresh for any Drive-side needs
  gemini_live_daily_cap_minutes numeric,    -- per-teacher override; null → env default
  gemini_text_daily_cap int,                 -- per-teacher override; null → env default
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- admins (HAH / AI-Doc pattern)
-- =========================================================================

create table admins (
  email text primary key,                    -- lowercased; FK to teachers.email by convention, not constraint
  created_at timestamptz not null default now(),
  created_by_email text                       -- who added this admin (null for self-bootstrap)
);

-- SECURITY DEFINER helper that bypasses RLS when called from other tables' policies.
-- Mirrors super-grader's is_the_teacher() pattern and HAH's is_admin().
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from admins a
    join teachers t on t.email = a.email
    where t.auth_user_id = auth.uid()
  );
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated, service_role;

-- =========================================================================
-- students (per-teacher roster snapshot; same student may appear under
-- multiple teachers, joined on canvas_user_id)
-- =========================================================================

create table students (
  id uuid primary key default gen_random_uuid(),
  canvas_user_id text not null,
  email text not null,                       -- @episcopalhighschool.org, lowercased
  display_name text not null,
  anon_token text not null,                  -- Student_xxxxxx, computed from canvas_user_id + email
  auth_user_id uuid unique,                  -- == auth.users.id once the student signs in
  created_at timestamptz not null default now(),
  unique (canvas_user_id),
  unique (email),
  unique (anon_token)
);

create index students_anon_token_idx on students (anon_token);

-- =========================================================================
-- exam_templates — one per Canvas OD assignment
-- =========================================================================

create table exam_templates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_assignment_id text not null,
  canvas_course_id text not null,
  name text not null,
  question_bank jsonb not null default '[]'::jsonb,   -- [{category, question}, ...]
  reference_texts jsonb not null default '[]'::jsonb,  -- [{title, content}, ...]
  topic_context text,                                  -- optional per-template overlay text
  rubric_version text not null default 'v1',
  duration_min_sec int not null default 60,            -- under-this auto-excluded
  duration_max_sec int not null default 900,           -- pre-flight rate-limit estimate
  exam_token text not null unique,                     -- opaque, used in /exam/<token>
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (teacher_id, canvas_assignment_id)
);

create index exam_templates_teacher_idx on exam_templates (teacher_id);

-- =========================================================================
-- exam_sessions — per student attempt
-- =========================================================================

create type exam_session_state as enum (
  'scheduled',
  'started',
  'in_progress',
  'completed',
  'excluded',
  'failed'
);

create type super_grader_post_status as enum (
  'pending',
  'posted',
  'error'
);

create table exam_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_template_id uuid not null references exam_templates (id) on delete cascade,
  student_id uuid not null references students (id) on delete restrict,
  state exam_session_state not null default 'scheduled',
  selected_questions jsonb,                            -- [{category, question}, ...]
  transcript jsonb,                                    -- [{role, text, timestamp}, ...] anonymized at rest
  audio_url text,                                       -- Supabase Storage path
  call_duration_sec int,
  student_summary text,                                 -- de-anonymized; goes to Canvas body
  eval_text text,                                       -- de-anonymized; goes to draft comment
  canvas_submission_id text,                            -- captured after masquerade POST
  canvas_draft_comment_id text,                         -- captured after draft eval comment
  super_grader_post_status super_grader_post_status not null default 'pending',
  super_grader_response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (exam_template_id, student_id)
);

create index exam_sessions_template_idx on exam_sessions (exam_template_id);
create index exam_sessions_state_idx on exam_sessions (state);

-- =========================================================================
-- course_rosters — anonymizer regex source + cached
-- =========================================================================

create table course_rosters (
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_course_id text not null,
  students jsonb not null default '[]'::jsonb,         -- [{canvas_user_id, display_name, email, anon_token}, ...]
  last_synced_at timestamptz not null default now(),
  primary key (teacher_id, canvas_course_id)
);

-- =========================================================================
-- canvas_*_cache — cached-by-default; nightly cron refreshes, manual button forces
-- =========================================================================

create table canvas_course_cache (
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_course_id text not null,
  payload jsonb not null,
  last_synced_at timestamptz not null default now(),
  primary key (teacher_id, canvas_course_id)
);

create table canvas_assignment_cache (
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_assignment_id text not null,
  canvas_course_id text not null,
  payload jsonb not null,
  last_synced_at timestamptz not null default now(),
  primary key (teacher_id, canvas_assignment_id)
);

create index canvas_assignment_cache_course_idx
  on canvas_assignment_cache (teacher_id, canvas_course_id);

-- =========================================================================
-- course_install_policies — auto-install opt-in per course
-- =========================================================================

create table course_install_policies (
  teacher_id uuid not null references teachers (id) on delete cascade,
  canvas_course_id text not null,
  auto_install_new_assignments boolean not null default false,
  default_exam_template_id uuid references exam_templates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (teacher_id, canvas_course_id)
);

-- =========================================================================
-- submission_attempts — audit trail for OE-side Canvas writes
-- =========================================================================

create type submission_attempt_kind as enum (
  'body',
  'draft_eval',
  'comment_fallback'
);

create table submission_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_session_id uuid not null references exam_sessions (id) on delete cascade,
  kind submission_attempt_kind not null,
  success boolean not null,
  canvas_response jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index submission_attempts_session_idx on submission_attempts (exam_session_id);

-- =========================================================================
-- updated_at trigger
-- =========================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger teachers_updated_at before update on teachers
  for each row execute function set_updated_at();
create trigger exam_templates_updated_at before update on exam_templates
  for each row execute function set_updated_at();
create trigger course_install_policies_updated_at before update on course_install_policies
  for each row execute function set_updated_at();

-- =========================================================================
-- Row-level security
-- =========================================================================
-- Multi-teacher app: each teacher sees only their own data. Admins bypass
-- via is_admin() for system-scoped reads (prompts, retention sweeps).
-- Service role bypasses RLS for cron-driven Canvas syncs and webhook ingest.

alter table teachers                  enable row level security;
alter table admins                    enable row level security;
alter table students                  enable row level security;
alter table exam_templates            enable row level security;
alter table exam_sessions             enable row level security;
alter table course_rosters            enable row level security;
alter table canvas_course_cache       enable row level security;
alter table canvas_assignment_cache   enable row level security;
alter table course_install_policies   enable row level security;
alter table submission_attempts       enable row level security;

-- teachers: each teacher reads/writes only their own row. Admins read any.
create policy teachers_self on teachers
  for all using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy teachers_admin_read on teachers
  for select using (is_admin());

-- admins: only admins read; only admins write (write happens via service role
-- in practice — bootstrap flow is admin-checked at the app layer).
create policy admins_read on admins
  for select using (is_admin());

create policy admins_write on admins
  for all using (is_admin())
  with check (is_admin());

-- students: a teacher reads any student that appears in any of their
-- exam_templates' completed sessions, OR appears in their course_rosters.
-- Simplest: any signed-in teacher reads all students. Edits via service role
-- only (roster sync, exam-session creation).
create policy students_teacher_read on students
  for select using (auth.uid() is not null);

create policy students_self on students
  for select using (auth_user_id = auth.uid());

-- exam_templates: teacher-owned.
create policy exam_templates_teacher_all on exam_templates
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

create policy exam_templates_admin_read on exam_templates
  for select using (is_admin());

-- Student needs read on their own template at exam time. Resolved by
-- exam_token via service role; this policy lets the student row read the
-- template metadata it's been issued.
create policy exam_templates_student_by_session on exam_templates
  for select using (
    id in (
      select exam_template_id from exam_sessions
      where student_id in (
        select id from students where auth_user_id = auth.uid()
      )
    )
  );

-- exam_sessions: teacher reads/writes their own; student reads their own.
create policy exam_sessions_teacher_all on exam_sessions
  for all using (
    exam_template_id in (
      select id from exam_templates
      where teacher_id in (select id from teachers where auth_user_id = auth.uid())
    )
  )
  with check (
    exam_template_id in (
      select id from exam_templates
      where teacher_id in (select id from teachers where auth_user_id = auth.uid())
    )
  );

create policy exam_sessions_student_self on exam_sessions
  for select using (
    student_id in (select id from students where auth_user_id = auth.uid())
  );

create policy exam_sessions_admin_read on exam_sessions
  for select using (is_admin());

-- course_rosters: teacher-owned.
create policy course_rosters_teacher_all on course_rosters
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

-- canvas_*_cache: teacher-owned.
create policy canvas_course_cache_teacher_all on canvas_course_cache
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

create policy canvas_assignment_cache_teacher_all on canvas_assignment_cache
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

-- course_install_policies: teacher-owned.
create policy course_install_policies_teacher_all on course_install_policies
  for all using (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  )
  with check (
    teacher_id in (select id from teachers where auth_user_id = auth.uid())
  );

-- submission_attempts: teacher-readable for sessions they own; written by
-- service role from the Canvas-write code path.
create policy submission_attempts_teacher_read on submission_attempts
  for select using (
    exam_session_id in (
      select id from exam_sessions
      where exam_template_id in (
        select id from exam_templates
        where teacher_id in (select id from teachers where auth_user_id = auth.uid())
      )
    )
  );

create policy submission_attempts_admin_read on submission_attempts
  for select using (is_admin());
