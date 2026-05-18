-- M2b.5b dashboard refactor v2: a binding can point at EITHER a teacher's
-- custom exam_template OR directly at a system personality_preset. Picking
-- "the default ChekhovBot" no longer auto-creates a teacher-owned
-- exam_template row (per teacher feedback 2026-05-18) — that pollutes the
-- "your templates" list with rows the teacher never customized.
--
-- After: a binding is a tuple (canvas_assignment_id, [preset OR template]).
-- The runtime treats a preset binding as "run the default verbatim"; a
-- template binding is "run the teacher's customized version".

alter table exam_template_bindings
  add column personality_preset_id uuid
    references personality_presets (id) on delete set null,
  alter column exam_template_id drop not null,
  add constraint exam_template_bindings_exactly_one_agent_chk
    check (
      (exam_template_id is not null and personality_preset_id is null)
      or (exam_template_id is null and personality_preset_id is not null)
    );

create index exam_template_bindings_preset_idx
  on exam_template_bindings (personality_preset_id);

-- Migrate existing "default pointer" templates: any teacher-owned
-- exam_template whose name matches its preset's name and has zero overrides
-- represents "I'm using the default {preset}". Rewrite the binding to
-- target the preset directly; delete the now-orphan template. Templates
-- with overrides or non-default names stay as-is.
do $$
declare
  ptr record;
begin
  for ptr in
    select t.id as template_id, t.personality_preset_id, p.name as preset_name
    from exam_templates t
    join personality_presets p on p.id = t.personality_preset_id
    where t.teacher_id is not null
      and t.name = p.name
      and t.persona_body is null
      and t.flow_body is null
      and t.opening_text is null
      and t.closing_text is null
      and t.live_voice_name is null
      and t.follow_up_depth is null
      and t.personalization_enabled is null
      and t.eval_prompt_body is null
      and t.rubric_body is null
  loop
    update exam_template_bindings
       set personality_preset_id = ptr.personality_preset_id,
           exam_template_id = null
     where exam_template_id = ptr.template_id;
    delete from exam_templates where id = ptr.template_id;
  end loop;
end;
$$;

comment on column exam_template_bindings.personality_preset_id is
  'M2b.5b: alt to exam_template_id. Set when the assignment uses a default agent directly (no teacher customization).';
comment on constraint exam_template_bindings_exactly_one_agent_chk on exam_template_bindings is
  'Exactly one of (exam_template_id, personality_preset_id) must be set on each binding.';
