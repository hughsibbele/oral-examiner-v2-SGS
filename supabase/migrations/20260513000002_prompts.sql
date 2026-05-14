-- prompts table: scope + purpose model (AI-Doc pattern).
-- For OE v2 launch, only `scope='system'` rows exist; per-template prompt
-- overlays live in exam_templates.question_bank/reference_texts/topic_context
-- jsonb columns rather than in this table.

create type prompt_scope as enum (
  'system',
  'template'
);

create type prompt_purpose as enum (
  'voice_agent',       -- Gemini Live system instruction
  'student_summary',   -- post-call ~150-word summary for Canvas body
  'eval_generation',   -- post-call ~300-word eval for draft comment
  'rubric',            -- declarative rubric content; composed into eval_generation
  'transcription'      -- optional post-pass audio → text (Gemini Flash with audio)
);

create table prompts (
  id uuid primary key default gen_random_uuid(),
  scope prompt_scope not null,
  purpose prompt_purpose not null,
  key text not null,                 -- stable identifier for pull-on-view fetches
  body text not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_email text,
  unique (scope, purpose, key) deferrable initially deferred
);

create index prompts_scope_purpose_idx on prompts (scope, purpose);

alter table prompts enable row level security;

-- Read: any authenticated user (teachers read; callers read; pull-on-view via
-- service role at the /api/super-grader/prompts/<key> endpoint).
create policy prompts_authenticated_read on prompts
  for select using (auth.uid() is not null);

-- Write: only admins. Bumps version on every save (enforced at the app layer
-- via the prompts update action).
create policy prompts_admin_write on prompts
  for insert with check (is_admin());

create policy prompts_admin_update on prompts
  for update using (is_admin()) with check (is_admin());

create policy prompts_admin_delete on prompts
  for delete using (is_admin());

-- =========================================================================
-- Seed the five system prompts as placeholders.
-- Admins edit these via /admin/prompts; super-grader pulls via
-- GET /api/super-grader/prompts/<key>.
-- =========================================================================

insert into prompts (scope, purpose, key, body) values
  ('system', 'voice_agent', 'voice_agent',
    '[PLACEHOLDER — edit me in /admin/prompts]

You are a friendly but rigorous oral examiner. Conduct a short oral defense (8–12 minutes) of the student''s essay on the topic specified by the per-template overlay. Stay on topic. Ask follow-up questions when answers are shallow. Do not reveal the rubric. End the exam politely when the student says they are done or when time is up.'),

  ('system', 'student_summary', 'student_summary',
    '[PLACEHOLDER — edit me in /admin/prompts]

Read the transcript of this oral defense and produce a ~150-word third-person summary describing what the student covered, what questions they answered well, and what areas they engaged with thoughtfully. Write in neutral prose — this summary goes into the student''s Canvas submission body. Do NOT evaluate quality (that''s the eval prompt''s job). Do NOT include direct quotes. Do NOT use the word "Student_" — names will already be anonymized in the input you see.'),

  ('system', 'eval_generation', 'eval_generation',
    '[PLACEHOLDER — edit me in /admin/prompts]

Read the transcript of this oral defense and produce a ~300-word evaluation against the rubric (composed into your system prompt). Note specific strengths with brief evidence. Note specific areas to improve. Suggest a numeric adjustment to the essay grade in the range [-5, +5] points. This eval will be staged as a draft Canvas comment for teacher review before publication, so be candid but constructive. Do NOT include the rubric criteria verbatim — refer to them by name only.'),

  ('system', 'rubric', 'rubric',
    '[PLACEHOLDER — edit me in /admin/prompts]

Four criteria, equally weighted:

1. Paper Knowledge — How well does the student know their own essay? Can they cite specific passages, paraphrase their argument, defend choices?
2. Writing Process — How aware is the student of their drafting process? Do they describe revisions, dead ends, deliberate choices?
3. Text Knowledge — How well does the student know the primary text(s) being discussed? Can they recall details accurately?
4. Content Understanding — Beyond recall, how deeply does the student engage with the ideas, themes, and craft of the text?'),

  ('system', 'transcription', 'transcription',
    '[PLACEHOLDER — edit me in /admin/prompts]

Transcribe the supplied audio recording of an oral examination conversation. Produce a turn-by-turn transcript with speaker labels ("Examiner:" and "Student:"). Preserve hesitations, false starts, and self-corrections — they matter to the eval. Anonymize any spoken names to Student_xxxxxx format if you recognize them as the student in question; otherwise leave names untouched (downstream scrubber will catch roster names).');
