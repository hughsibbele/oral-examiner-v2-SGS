-- Oral Examiner v2 — M2b.5b.11.c — drop dead exam_templates columns
--
-- exam_templates.canvas_assignment_id / canvas_course_id / exam_token
-- were the original (pre-bindings) way an exam_template pointed at one
-- Canvas assignment 1:1. Since the 20260518014646_exam_template_bindings
-- migration introduced exam_template_bindings, the template ↔ assignment
-- relationship moved into the bindings table, and these columns on
-- exam_templates haven't been written or read in the runtime since.
--
-- Audited 2026-05-18: no remaining readers in apps/teacher (only
-- exam_template_bindings rows are read for the per-assignment cache
-- joins; the page.tsx and TemplateEditor.tsx references all key off the
-- bindings table, not exam_templates).

alter table exam_templates
  drop column if exists canvas_assignment_id,
  drop column if exists canvas_course_id,
  drop column if exists exam_token;
