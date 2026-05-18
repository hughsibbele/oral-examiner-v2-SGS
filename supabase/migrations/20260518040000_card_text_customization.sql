-- Oral Examiner v2 — M2b.5b.9 — Canvas card text customization
--
-- Admin sets system defaults for the 5 strings inside the branded card
-- (kicker / title / body / cta label / footnote). Teachers override any
-- subset on their own row; effective value = teacher override ?? system
-- default. Per-template variation is NOT supported — the card text is a
-- global per-teacher knob, not per-Canvas-assignment.

-- Singleton table for admin defaults. Mirrors the safety_envelope
-- singleton pattern (id=1, CHECK pinned).
create table card_text_defaults (
  id smallint primary key check (id = 1),
  kicker text not null default 'Oral Defense · Required for credit',
  title text not null default 'Defend this assignment in a brief oral exam',
  body text not null default 'You''ll have a short spoken conversation with an AI examiner about your work. Find a quiet room with a working microphone; the exam takes about 10–15 minutes and submits to Canvas automatically when you''re done.',
  cta_label text not null default 'Start oral exam →',
  footnote text not null default 'Sign in with your @episcopalhighschool.org Google account.',
  updated_at timestamptz not null default now()
);

insert into card_text_defaults (id) values (1);

create trigger card_text_defaults_updated_at before update on card_text_defaults
  for each row execute function set_updated_at();

alter table card_text_defaults enable row level security;

-- Any signed-in user can read the defaults (the install path needs them
-- to compose the effective card text). Admin-only write.
create policy card_text_defaults_read on card_text_defaults
  for select to authenticated using (true);

create policy card_text_defaults_admin_write on card_text_defaults
  for all using (is_admin()) with check (is_admin());

-- Per-teacher overrides. Each column is nullable; null = inherit from
-- card_text_defaults. The install path reads both and resolves at PUT
-- time, so changing a default propagates to next install for every
-- teacher who hasn't overridden the field.
alter table teachers
  add column card_kicker text,
  add column card_title text,
  add column card_body text,
  add column card_cta_label text,
  add column card_footnote text;

comment on column teachers.card_kicker is
  'M2b.5b.9: optional teacher override for the card''s top "ORAL DEFENSE · REQUIRED FOR CREDIT" kicker.';
comment on column teachers.card_title is
  'M2b.5b.9: optional teacher override for the card''s h3 title.';
comment on column teachers.card_body is
  'M2b.5b.9: optional teacher override for the card''s body paragraph.';
comment on column teachers.card_cta_label is
  'M2b.5b.9: optional teacher override for the CTA button label.';
comment on column teachers.card_footnote is
  'M2b.5b.9: optional teacher override for the card''s italic footnote.';
