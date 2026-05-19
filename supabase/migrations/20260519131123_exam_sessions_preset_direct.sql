-- Oral Examiner v2 — M2b.5c.4 follow-up — let exam_sessions point at
-- EITHER a teacher's exam_template OR directly at a system personality_preset.
--
-- Mirrors the same shape exam_template_bindings adopted in the
-- 20260518022646 migration. Without this, a binding that points at a
-- preset (no teacher customization) would force the student-flow start
-- action to materialize a teacher-owned exam_templates row on the fly,
-- which would re-introduce the "your templates" hub pollution that the
-- 2026-05-18 design feedback explicitly avoided.
--
-- Also re-keys the partial unique index from (exam_template_id,
-- student_id) → (canvas_assignment_id, student_id). The Canvas
-- assignment is the unit a student takes once — two different
-- assignments using the same preset are two separate exams.
--
-- Zero rows in exam_sessions at migration time (verified 2026-05-19) so
-- no backfill — canvas_assignment_id lands as NOT NULL immediately.

alter table exam_sessions
  add column canvas_assignment_id text not null,
  add column personality_preset_id uuid
    references personality_presets (id) on delete set null,
  alter column exam_template_id drop not null;

alter table exam_sessions
  add constraint exam_sessions_exactly_one_agent_chk
    check (
      (exam_template_id is not null and personality_preset_id is null)
      or (exam_template_id is null and personality_preset_id is not null)
    );

drop index if exists exam_sessions_template_student_live_uniq;

create unique index exam_sessions_assignment_student_live_uniq
  on exam_sessions (canvas_assignment_id, student_id)
  where state <> 'excluded';

create index exam_sessions_preset_idx
  on exam_sessions (personality_preset_id);

comment on column exam_sessions.canvas_assignment_id is
  'M2b.5c.4: which Canvas assignment this session was taken for. The semantic uniqueness key — a student takes each assignment once.';
comment on column exam_sessions.personality_preset_id is
  'M2b.5c.4: alt to exam_template_id. Set when the session was conducted against a preset directly (no teacher customization on the binding).';
comment on constraint exam_sessions_exactly_one_agent_chk on exam_sessions is
  'Exactly one of (exam_template_id, personality_preset_id) must be set on each session — mirrors exam_template_bindings.';
comment on index exam_sessions_assignment_student_live_uniq is
  'M2b.5c.3+5c.4: exactly one non-excluded session per (assignment, student). Excluded rows accumulate as the audit trail.';
