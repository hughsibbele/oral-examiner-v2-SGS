-- M2b.1l — lock exam_templates when a student session starts.
--
-- Adds a single UPDATE to begin_exam_session: set locked_at = now() on the
-- template row (if template-backed, not preset-direct) when it's still
-- unlocked. Idempotent — the WHERE locked_at IS NULL guard means second+
-- students hitting the same template are a no-op.
--
-- The editor already rejects writes to locked templates
-- (loadTemplateContext checks locked_at); the clone-on-edit UI ships in
-- the same commit's TypeScript side.

-- DROP before redefine: the prior version of this function declared its OUT
-- column as `archived_prior_id`; this redefinition uses `archived_id`. PG
-- 42P13 ("cannot change return type of existing function") fires on a bare
-- CREATE OR REPLACE across that rename, so we drop first. No callers read
-- the field by name (only `data.length` is consulted in start-exam.ts), so
-- the rename is caller-safe.
drop function if exists begin_exam_session(text, uuid, jsonb);

create or replace function begin_exam_session(
  p_canvas_assignment_id text,
  p_student_id uuid,
  p_selected_questions jsonb
)
returns table (session_id uuid, classification text, archived_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_binding record;
  v_template_row record;
  v_preset_row record;
  v_template_loaded boolean := false;
  v_preset_loaded boolean := false;
  v_prior record;
  v_classification text;
  v_archived_id uuid;
  v_session_id uuid;
  v_roster_jsonb jsonb;
  v_persona_name text;
  v_eval_prompt_body text;
  v_rubric_body text;
  v_short_attempt_threshold_sec int := 60;
begin
  -- 3a. Binding lookup. If no binding for this assignment, raise.
  select * into v_binding
  from exam_template_bindings
  where canvas_assignment_id = p_canvas_assignment_id;
  if not found then
    raise exception 'no_binding' using errcode = 'P0001';
  end if;

  -- 3b. Agent lookup. Exactly one of template or preset is set (CHECK).
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

  -- 3c. Roster.
  select students into v_roster_jsonb
  from course_rosters
  where teacher_id = v_binding.teacher_id
    and canvas_course_id = v_binding.canvas_course_id;
  if v_roster_jsonb is null
     or jsonb_typeof(v_roster_jsonb) <> 'array'
     or jsonb_array_length(v_roster_jsonb) = 0 then
    raise exception 'roster_missing' using errcode = 'P0001';
  end if;

  -- 3d. Serialization.
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

  -- 3e. Compose snapshot values.
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

  -- 3f. Insert session.
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

  -- M2b.1l — lock the template after the first session starts against it.
  -- Idempotent: only writes when locked_at IS NULL (first student).
  if v_template_loaded and v_template_row.locked_at is null then
    update exam_templates
      set locked_at = now()
      where id = v_template_row.id
        and locked_at is null;
  end if;

  return query select v_session_id, v_classification, v_archived_id;
end;
$$;

comment on function begin_exam_session(text, uuid, jsonb) is
  'Atomically classify any prior session, archive if applicable, INSERT a new exam_sessions row with snapshots, and lock the template on first use. Raises P0001 with message in {no_binding, no_agent, roster_missing, completion_blocked, unknown_prior_state}.';
