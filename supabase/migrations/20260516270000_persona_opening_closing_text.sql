-- Per-agent opening and closing lines. NULL = use whatever PHASE 1 / wrap
-- says in the persona's flow_body. Set = model is instructed to speak it
-- verbatim as the first thing it says (or last, for closing).

alter table personality_presets
  add column opening_text text,
  add column closing_text text;
