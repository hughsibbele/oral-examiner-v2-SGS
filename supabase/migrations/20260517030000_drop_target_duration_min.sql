-- Drop target_duration_min — added in 20260517020000 a few minutes ago but
-- never used in real data. Design pivot 2026-05-17: duration is computed
-- from sum(question_buckets.select_count) × time-per-question (which
-- scales with follow_up_depth). The slider was creating a contradiction
-- vector with the prose flow_body; removing the source of truth-of-time
-- to live only on the question set is cleaner.
--
-- The runtime composer (lib/runtime/flow-parameters.ts) now takes the
-- selected-question count as input and computes the duration inline.

alter table personality_presets
  drop column target_duration_min;
