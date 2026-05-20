-- M6.18c: 3-checkbox deliverable-destination picker for OE.
--
-- Per the suite-wide picker shape, an OE exam emits three artifacts
-- (transcript, summary, evaluation) — per M7.4 these collapse to a
-- single Google Doc with a draft-comment-with-link on Canvas. The
-- destination state lives on the binding row (one per assignment).
--
--   - post_to_drive             (default true; M7.4 writes the per-session doc)
--   - post_to_canvas_comment    (default true; draft comment carries the doc link)
--   - post_to_canvas_submission (default false; orals rarely route to submission)

ALTER TABLE public.exam_template_bindings
  ADD COLUMN post_to_drive boolean NOT NULL DEFAULT true,
  ADD COLUMN post_to_canvas_comment boolean NOT NULL DEFAULT true,
  ADD COLUMN post_to_canvas_submission boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.exam_template_bindings.post_to_drive IS
  'M6.18c: per-session Drive doc with transcript + summary + evaluation. Writer ships with M7.4.';
COMMENT ON COLUMN public.exam_template_bindings.post_to_canvas_comment IS
  'M6.18c: draft comment in SpeedGrader (will carry the M7.4 Drive doc link).';
COMMENT ON COLUMN public.exam_template_bindings.post_to_canvas_submission IS
  'M6.18c: route artifacts to the student submission body. Rare for orals; opt-in.';
