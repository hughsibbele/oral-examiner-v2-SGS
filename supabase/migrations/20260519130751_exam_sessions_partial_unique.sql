-- Oral Examiner v2 — M2b.5c.3 follow-up — partial unique index on
-- (exam_template_id, student_id) limited to non-excluded states.
--
-- The original unique constraint (initial schema) enforced "one row per
-- (template, student)" globally, but the M2b.5c.3 retake-with-grace flow
-- soft-deletes prior attempts (state='excluded' + excluded_reason) rather
-- than hard-deleting them. Audit trail wants the archived rows preserved,
-- so the constraint needs to allow multiple excluded rows alongside the
-- one live row.
--
-- Drop the table-level unique constraint, replace with a partial unique
-- index that only enforces uniqueness when state <> 'excluded'.

alter table exam_sessions
  drop constraint if exists exam_sessions_exam_template_id_student_id_key;

create unique index exam_sessions_template_student_live_uniq
  on exam_sessions (exam_template_id, student_id)
  where state <> 'excluded';

comment on index exam_sessions_template_student_live_uniq is
  'M2b.5c.3: exactly one non-excluded session per (template, student) at a time. Excluded rows accumulate as the soft-delete audit trail.';
