-- M7.4 — auto Google Doc + audio per exam_session; replace M2b.6's per-
-- artifact posting_config with a single-doc model.
--
-- Direct port of HH's M7.5 shape (`20260522170000_hh_m7_5_drive_canvas`).
-- One Doc per session containing student_summary + evaluation +
-- transcript; one audio file in the teacher's per-app folder with the
-- matching base name. After Drive lands, post a draft Canvas comment
-- per student carrying the Drive link. Gated by the existing
-- destination picker (`exam_template_bindings.post_to_drive` /
-- `post_to_canvas_comment`, both default true) PLUS the new teacher-
-- level master switch `teachers.canvas_comment_enabled` (default true).
--
-- All side effects are idempotent + state-fenced — the Inngest worker
-- skips Drive when `drive_doc_url` is already populated; skips Canvas
-- when `canvas_comment_posted_at` is already set.
--
-- exam_sessions already has `canvas_draft_comment_id` from the initial
-- schema (captured the Canvas comment id at post time). The new
-- `canvas_comment_post_status` column is the outcome aggregate —
-- canvas_draft_comment_id stays as the per-comment ID for backref.

alter table teachers
  add column drive_folder_id text,
  add column canvas_comment_enabled boolean not null default true;

alter table exam_sessions
  add column drive_doc_id text,
  add column drive_doc_url text,
  add column drive_audio_id text,
  add column drive_audio_url text,
  add column canvas_comment_post_status text
    check (canvas_comment_post_status in ('ok', 'failed', 'skipped')),
  add column canvas_comment_posted_at timestamptz,
  add column canvas_comment_error text;

comment on column teachers.drive_folder_id is
  'M7.4 — Google Drive folder id for this teacher''s "Oral Examiner" '
  'folder. Auto-created on first save; self-healed on 404. Null on '
  'first use.';
comment on column teachers.canvas_comment_enabled is
  'M7.4 — master switch for OE''s Canvas draft-comment writes. AND-ed '
  'with exam_template_bindings.post_to_canvas_comment (per-assignment '
  'override). Default true.';
comment on column exam_sessions.drive_doc_url is
  'M7.4 — Drive webViewLink for the auto-created Doc containing the '
  'student_summary + evaluation + transcript. Set after the save-to-'
  'drive Inngest step succeeds; presence is the idempotency sentinel.';
comment on column exam_sessions.canvas_comment_post_status is
  'M7.4 — outcome of the per-session Canvas comment post. ok = posted; '
  'failed = post failed (see canvas_comment_error); skipped = the '
  'master switch or per-assignment override is off, or there''s no '
  'Drive doc to link.';
