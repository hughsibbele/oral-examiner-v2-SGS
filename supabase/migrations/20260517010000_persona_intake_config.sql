-- Per-agent intake configuration: which Canvas surfaces to read, plus any
-- admin-attached reference materials (PDFs, paste-text, Drive docs).
--
-- Lives on personality_presets because admins set the default shape here;
-- when teachers clone an agent into an exam_template (M2b.5), the same
-- shape lands on exam_templates.intake_config and is teacher-overridable.
--
-- Shape:
--   {
--     "use_canvas_description": bool,    -- include Canvas assignment description in intake_pack
--     "use_canvas_submission":  bool,    -- include the student's submission body in intake_pack
--     "attachments": [                   -- admin-staged reference materials
--       {
--         "id":             uuid string,
--         "kind":           "drive" | "upload" | "paste",
--         "name":           string,      -- displayed label + composes into intake_pack heading
--         "content":        string,      -- extracted plain text (cached at add-time)
--         "byte_size":      integer,
--         "drive_file_id":  string|null, -- only set when kind='drive'
--         "drive_mime_type": string|null,
--         "created_at":     ISO timestamp
--       }
--     ]
--   }

alter table personality_presets
  add column intake_config jsonb not null default jsonb_build_object(
    'use_canvas_description', false,
    'use_canvas_submission',  false,
    'attachments',            '[]'::jsonb
  );

comment on column personality_presets.intake_config is
  'Admin-default intake configuration. Teachers clone into exam_templates.intake_config; the same shape applies at both levels.';

-- Seed agent-appropriate defaults. ChekhovBot defends an essay → the essay
-- IS the submission, so include it. Senior Researcher hears about a project
-- whose framing lives in the assignment description, so include the
-- description. Book Club Host + Study Partner are content-agnostic
-- starting points (teachers will customize per template).
update personality_presets
  set intake_config = jsonb_build_object(
    'use_canvas_description', false,
    'use_canvas_submission',  true,
    'attachments',            '[]'::jsonb
  )
  where name = 'ChekhovBot';

update personality_presets
  set intake_config = jsonb_build_object(
    'use_canvas_description', true,
    'use_canvas_submission',  false,
    'attachments',            '[]'::jsonb
  )
  where name in ('The Senior Researcher', 'The Study Partner');
-- Book Club Host stays on the all-false default — the book itself isn't on
-- Canvas, and the teacher will typically attach the reading list or
-- chapter excerpt as a Drive doc.
