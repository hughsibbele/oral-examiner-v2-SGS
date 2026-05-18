-- Reviewer-flagged: ON DELETE SET NULL on personality_preset_id breaks the
-- CHECK constraint when a preset is deleted (both FKs become NULL → CHECK
-- fails → delete aborts). Switch to CASCADE so deleting a preset drops the
-- bindings that depend on it, mirroring exam_template_id's behavior.
--
-- Defaults are never deleted in practice (no UI surface), but this closes
-- the future hole if admin tooling adds a delete-preset action.

alter table exam_template_bindings
  drop constraint exam_template_bindings_personality_preset_id_fkey;

alter table exam_template_bindings
  add constraint exam_template_bindings_personality_preset_id_fkey
  foreign key (personality_preset_id)
  references personality_presets (id)
  on delete cascade;
