-- Phase 1 of REMEDIATION_PLAN.md — snapshot semantics + atomic start.
--
-- Three goals:
--   1. Add snapshot columns to exam_sessions so eval grades against the
--      template/rubric/roster the student was actually examined under —
--      mid-flight teacher edits no longer change what an in-flight or
--      already-completed exam means.
--   2. Flip FK behavior on exam_template_id / personality_preset_id from
--      data-destroying (CASCADE / SET NULL) to RESTRICT. Deleting a
--      template or preset that has session rows now fails loudly instead
--      of silently obliterating student work or violating the exactly-
--      one-of CHECK.
--   3. Add a begin_exam_session SECURITY DEFINER RPC that atomically does
--      classify-prior → archive-if-short → snapshot-read → insert-new in
--      a single FOR UPDATE-serialized transaction. Replaces the race-prone
--      multi-step flow in lib/exam/start-exam.ts.
--
-- Background gotchas this addresses (from the 2026-05-21 audit):
--   - cross-system #1: exam_sessions.exam_template_id ON DELETE CASCADE
--     silently hard-deletes student work on template delete.
--   - cross-system #2: personality_preset_id ON DELETE SET NULL violates
--     the exactly-one-of CHECK if a preset is ever deleted.
--   - cross-system #3 + #5: eval re-fetches template + roster live, so a
--     mid-exam edit can grade against a different rubric than the student
--     heard, and a roster sync mid-session can leak names.
--   - cross-system #6 / state-machine #3: start-exam is classify + archive
--     + insert without a transaction; race produces cryptic dup-key error.

-- 1. Snapshot columns. All nullable on the column itself (sessions created
--    before this migration won't have them populated; new sessions populate
--    them via begin_exam_session). scrub_status is NOT NULL with a default.

alter table exam_sessions
  add column eval_prompt_body_snapshot text,
  add column rubric_body_snapshot      text,
  add column persona_name_snapshot     text,
  add column roster_snapshot           jsonb,
  add column scrub_status              text not null default 'ok'
    check (scrub_status in ('ok','failed','skipped'));

comment on column exam_sessions.eval_prompt_body_snapshot is
  'Phase 1: eval_prompt_body frozen at session start. evaluate-exam reads from here, never from live template + preset, so mid-flight teacher edits do not change the rubric the student is graded against.';
comment on column exam_sessions.rubric_body_snapshot is
  'Phase 1: rubric_body frozen at session start. See eval_prompt_body_snapshot.';
comment on column exam_sessions.persona_name_snapshot is
  'Phase 1: persona display name frozen at session start. Used by eval/summary prompts that reference the examiner by name.';
comment on column exam_sessions.roster_snapshot is
  'Phase 1: subset of course_rosters.students used for transcript scrubbing throughout the session lifecycle (flush, end, eval defensive re-scrub). Frozen at session start so roster sync mid-exam cannot widen the scrub gap.';
comment on column exam_sessions.scrub_status is
  'Phase 1: ok = transcript writes ran under a valid roster; failed = a scrub fail-closed event fired (Phase 0 should prevent these landing in DB but exposed for monitoring); skipped = legacy session predating snapshot.';

-- 2. FK behavior flip. RESTRICT means a delete of the referenced row fails
--    with a foreign-key violation (SQLSTATE 23503) if any session rows
--    reference it. deleteTemplate in apps/teacher/app/dashboard/agents/
--    actions.ts catches and surfaces "this template has student sessions —
--    archive instead" rather than silently obliterating work.

alter table exam_sessions
  drop constraint exam_sessions_exam_template_id_fkey;

alter table exam_sessions
  add constraint exam_sessions_exam_template_id_fkey
    foreign key (exam_template_id) references exam_templates (id)
    on delete restrict;

alter table exam_sessions
  drop constraint exam_sessions_personality_preset_id_fkey;

alter table exam_sessions
  add constraint exam_sessions_personality_preset_id_fkey
    foreign key (personality_preset_id) references personality_presets (id)
    on delete restrict;

-- 3. begin_exam_session — atomic classify + archive + snapshot + insert.
--
--    Called from lib/exam/start-exam.ts. SECURITY DEFINER because student
--    callers run through the service-role admin client (no student RLS path
--    on exam_templates after the recursion-fix migration 20260518021328).
--
--    Selected questions are passed in as jsonb because the caller computes
--    them with Node's crypto.randomInt — CSPRNG > Postgres's random() for
--    exam question selection. The rest (binding lookup, agent load, roster
--    read, prior-row lock, classification, archive, insert with snapshots)
--    happens here so the entire transition is one transaction.
--
--    On semantic failure (no binding, no agent on the binding, missing
--    roster, prior session already completed) raises P0001 with the failure
--    name as the message so the caller can pattern-match by error.message.

create or replace function begin_exam_session(
  p_canvas_assignment_id  text,
  p_student_id            uuid,
  p_selected_questions    jsonb
)
returns table (
  session_id        uuid,
  classification    text,
  archived_prior_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_binding              record;
  v_template_row         exam_templates%rowtype;
  v_preset_row           personality_presets%rowtype;
  v_template_loaded      boolean := false;
  v_preset_loaded        boolean := false;
  v_roster_jsonb         jsonb;
  v_prior                record;
  v_archived_id          uuid := null;
  v_classification       text;
  v_session_id           uuid;
  v_short_attempt_threshold_sec int := 60;
  v_persona_name         text;
  v_eval_prompt_body     text;
  v_rubric_body          text;
begin
  -- 3a. Binding (inside the transaction so a concurrent unassign surfaces
  --     as no_binding rather than a partial-success).
  select teacher_id, canvas_course_id, exam_template_id, personality_preset_id
  into v_binding
  from exam_template_bindings
  where canvas_assignment_id = p_canvas_assignment_id;
  if not found then
    raise exception 'no_binding' using errcode = 'P0001';
  end if;

  -- 3b. Resolve template + preset. Exactly-one-of enforced by the bindings
  --     table's own CHECK, but we narrow defensively here too.
  if v_binding.exam_template_id is not null then
    select * into v_template_row
    from exam_templates
    where id = v_binding.exam_template_id;
    if not found then
      raise exception 'no_agent' using errcode = 'P0001';
    end if;
    v_template_loaded := true;
    if v_template_row.personality_preset_id is not null then
      select * into v_preset_row
      from personality_presets
      where id = v_template_row.personality_preset_id;
      if found then
        v_preset_loaded := true;
      end if;
    end if;
  elsif v_binding.personality_preset_id is not null then
    select * into v_preset_row
    from personality_presets
    where id = v_binding.personality_preset_id;
    if not found then
      raise exception 'no_agent' using errcode = 'P0001';
    end if;
    v_preset_loaded := true;
  else
    raise exception 'no_agent' using errcode = 'P0001';
  end if;

  -- 3c. Roster. Phase 1 snapshot — scrubbing during the live session reads
  --     from exam_sessions.roster_snapshot, not course_rosters, so a roster
  --     sync mid-exam cannot change the scrub pattern.
  select students into v_roster_jsonb
  from course_rosters
  where teacher_id = v_binding.teacher_id
    and canvas_course_id = v_binding.canvas_course_id;
  if v_roster_jsonb is null
     or jsonb_typeof(v_roster_jsonb) <> 'array'
     or jsonb_array_length(v_roster_jsonb) = 0 then
    raise exception 'roster_missing' using errcode = 'P0001';
  end if;

  -- 3d. Serialization. FOR UPDATE locks any prior non-excluded row for
  --     this (assignment, student) so two concurrent begin_exam_session
  --     calls don't both classify-then-archive in parallel and race past
  --     each other into a duplicate insert. The partial unique index is
  --     still belt-and-braces.
  select id, state, call_duration_sec, completed_at
  into v_prior
  from exam_sessions
  where canvas_assignment_id = p_canvas_assignment_id
    and student_id = p_student_id
    and state <> 'excluded'
  order by created_at desc
  limit 1
  for update;

  if not found then
    v_classification := 'fresh';
  elsif v_prior.state in ('started', 'in_progress') then
    -- Existing live session; reuse its id. Caller redirects to /run.
    return query select v_prior.id, 'live_session'::text, null::uuid;
    return;
  elsif v_prior.state = 'completed' then
    if coalesce(v_prior.call_duration_sec, 0) < v_short_attempt_threshold_sec then
      v_classification := 'short_attempt';
      update exam_sessions
        set state = 'excluded',
            excluded_reason = 'short_attempt_auto'
        where id = v_prior.id;
      v_archived_id := v_prior.id;
    else
      raise exception 'completion_blocked' using errcode = 'P0001';
    end if;
  elsif v_prior.state = 'failed' then
    v_classification := 'failed_prior';
    update exam_sessions
      set state = 'excluded',
          excluded_reason = 'failed_eval'
      where id = v_prior.id;
    v_archived_id := v_prior.id;
  elsif v_prior.state = 'scheduled' then
    v_classification := 'scheduled_orphan';
    update exam_sessions
      set state = 'excluded',
          excluded_reason = 'abandoned_resume'
      where id = v_prior.id;
    v_archived_id := v_prior.id;
  else
    raise exception 'unknown_prior_state: %', v_prior.state
      using errcode = 'P0001';
  end if;

  -- 3e. Compose snapshot values via the template-overrides-preset pattern
  --     (mirrors lib/runtime/assemble-prompt.ts).
  v_persona_name := coalesce(
    case when v_template_loaded then v_template_row.name end,
    case when v_preset_loaded   then v_preset_row.name   end
  );
  v_eval_prompt_body := coalesce(
    case when v_template_loaded then v_template_row.eval_prompt_body end,
    case when v_preset_loaded   then v_preset_row.eval_prompt_body   end
  );
  v_rubric_body := coalesce(
    case when v_template_loaded then v_template_row.rubric_body end,
    case when v_preset_loaded   then v_preset_row.rubric_body   end
  );

  -- 3f. Insert. CHECK enforces exactly-one-of-agent; the partial unique
  --     index is the last line of defense against a concurrent racer that
  --     beat us through 3d (vanishingly rare but possible).
  insert into exam_sessions (
    exam_template_id,
    personality_preset_id,
    canvas_assignment_id,
    student_id,
    state,
    selected_questions,
    eval_prompt_body_snapshot,
    rubric_body_snapshot,
    persona_name_snapshot,
    roster_snapshot
  )
  values (
    v_binding.exam_template_id,
    case when v_binding.exam_template_id is null
      then v_binding.personality_preset_id
      else null
    end,
    p_canvas_assignment_id,
    p_student_id,
    'started',
    p_selected_questions,
    v_eval_prompt_body,
    v_rubric_body,
    v_persona_name,
    v_roster_jsonb
  )
  returning id into v_session_id;

  return query select v_session_id, v_classification, v_archived_id;
end;
$$;

revoke all on function begin_exam_session(text, uuid, jsonb) from public;
grant execute on function begin_exam_session(text, uuid, jsonb)
  to authenticated, service_role;

comment on function begin_exam_session(text, uuid, jsonb) is
  'Phase 1 of REMEDIATION_PLAN.md: atomically classify any prior session, archive if applicable, and INSERT a new exam_sessions row with eval_prompt / rubric / persona_name / roster snapshot columns populated. Raises P0001 with message in {no_binding, no_agent, roster_missing, completion_blocked, unknown_prior_state} so callers can pattern-match on error.message.';
