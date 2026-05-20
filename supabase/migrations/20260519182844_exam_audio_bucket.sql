-- M2b.5d.3 — exam-audio storage bucket.
--
-- Holds the mixed mic + agent audio recording captured by the student's
-- browser during a live oral exam. The Inngest evaluate-exam function
-- (5d.4) pulls the audio via signed URL when it needs the recording for
-- a re-transcribe pass; the teacher dashboard does the same when
-- replaying.
--
-- Private bucket. Same posture as HH's discussion-audio:
--   - service-role client uploads (the /api/exam/upload-audio route)
--   - signed URLs gate reads (server-generated for playback / Gemini)
--   - no RLS policies on storage.objects for this bucket — service-role
--     bypasses RLS for writes, signed URLs bypass RLS for reads (the
--     signed token IS the authorization)
--
-- Size limit 50MB: a 30-minute mp4/aac exam @ 64kbps lands around 14MB; 50MB
-- gives headroom for verbose defenses without risking storage abuse.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-audio',
  'exam-audio',
  false,
  52428800,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']
);
