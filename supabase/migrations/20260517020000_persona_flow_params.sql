-- Flow parameters: structured knobs the runtime prompt assembler injects
-- alongside the prose flow_body. Three knobs that teachers commonly tune —
-- target duration, follow-up depth, personalization. Everything else stays
-- in flow_body as editable prose.
--
-- The columns live on personality_presets (admin defaults); teachers will
-- override per-template in M2b.5 via the cloned exam_templates row (same
-- column names land there too in a follow-up migration when that flow lands).

alter table personality_presets
  add column target_duration_min int not null default 15
    check (target_duration_min between 3 and 60),
  add column follow_up_depth text not null default 'medium'
    check (follow_up_depth in ('light', 'medium', 'deep')),
  add column personalization_enabled boolean not null default true;

comment on column personality_presets.target_duration_min is
  'Target exam duration in minutes. The agent paces within this budget; runtime composer inlines this into the flow section.';
comment on column personality_presets.follow_up_depth is
  'How aggressively the agent probes vague answers: light (one pass), medium (probe key claims once), deep (2–3 levels on important claims).';
comment on column personality_presets.personalization_enabled is
  'When true, the agent uses student name + course context in greetings/transitions. When false, conversation stays generic.';

-- Seed per-agent defaults that match each persona's tempo:
--   ChekhovBot Essay Defense       15 min, medium depth, personalized
--   The Book Club Host             15 min, medium depth, personalized
--   The Senior Researcher          20 min, deep depth,   personalized (rigorous probe)
--   The Study Partner              10 min, light depth,  personalized (encouraging, brief)
update personality_presets
  set target_duration_min = 20, follow_up_depth = 'deep'
  where name = 'The Senior Researcher';

update personality_presets
  set target_duration_min = 10, follow_up_depth = 'light'
  where name = 'The Study Partner';
-- ChekhovBot + Book Club Host keep the column defaults (15min / medium / on).
