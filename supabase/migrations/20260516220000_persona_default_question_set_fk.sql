-- Pair each personality preset with its default question set. This makes
-- the agent concept (persona + bank) explicit at the data layer so the
-- admin UI can render all of an agent's parts on one page.

alter table personality_presets
  add column default_question_set_id uuid
    references question_sets(id) on delete set null;

create index personality_presets_default_qset_idx
  on personality_presets (default_question_set_id);

-- Backfill the 4 seeded pairings.
update personality_presets pp
set default_question_set_id = qs.id
from question_sets qs
where pp.teacher_id is null
  and qs.teacher_id is null
  and (
       (pp.name = 'ChekhovBot'             and qs.name = 'ChekhovBot Essay Defense (default)')
    or (pp.name = 'The Book Club Host'     and qs.name = 'Book Club Host Reading Discussion (default)')
    or (pp.name = 'The Senior Researcher'  and qs.name = 'Senior Researcher Project Review (default)')
    or (pp.name = 'The Study Partner'      and qs.name = 'Study Partner Prep (default)')
  );
