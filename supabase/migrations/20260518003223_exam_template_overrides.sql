-- Oral Examiner v2 — M2b.5b.1 — per-template nullable overrides
--
-- Lets a teacher override every per-agent knob on a per-Canvas-assignment
-- basis. Existing columns on exam_templates already cover persona_body /
-- flow_body / opening_text / closing_text / question_set_id / intake_config
-- (from 20260516210000_template_composition). This migration fills in the
-- remaining persona-row knobs as nullable columns:
--
--   - eval_prompt_body       (per-template post-session evaluation prompt)
--   - rubric_body            (per-template rubric; null = ungraded)
--   - live_voice_name        (per-template Gemini Live voice pick)
--   - follow_up_depth        (per-template light/medium/deep tempo knob)
--   - personalization_enabled (per-template student-name/context toggle)
--
-- All five default to NULL — the runtime assembler falls back to the linked
-- personality_preset's value when the override is null. This is the same
-- pattern the prose fields already use.

alter table exam_templates
  add column eval_prompt_body text,
  add column rubric_body text,
  add column live_voice_name text,
  add column follow_up_depth text
    check (follow_up_depth is null or follow_up_depth in ('light', 'medium', 'deep')),
  add column personalization_enabled boolean;

comment on column exam_templates.eval_prompt_body is
  'M2b.5b.1: optional per-template override of personality_presets.eval_prompt_body.';
comment on column exam_templates.rubric_body is
  'M2b.5b.1: optional per-template override of personality_presets.rubric_body. Null = inherit (which may itself be null = ungraded).';
comment on column exam_templates.live_voice_name is
  'M2b.5b.1: optional per-template override of personality_presets.live_voice_name (Gemini Live prebuilt voice).';
comment on column exam_templates.follow_up_depth is
  'M2b.5b.1: optional per-template override of personality_presets.follow_up_depth (light/medium/deep).';
comment on column exam_templates.personalization_enabled is
  'M2b.5b.1: optional per-template override of personality_presets.personalization_enabled.';
