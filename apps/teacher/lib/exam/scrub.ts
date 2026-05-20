// Transcript scrubbing for exam_sessions. The Live API transcribes student
// speech verbatim, which means real names spoken during the session land in
// our jsonb transcript column unless we scrub them.
//
// Policy: store anonymized (Student_xxxxxx tokens), never persist raw names
// in DB. The Inngest eval pipeline then operates on the already-scrubbed
// transcript — Gemini sees tokens, not real names. This respects the
// FERPA-driven "PII never reaches Gemini for text reasoning" rule from the
// repo CLAUDE.md.
//
// Roster fetched per-flush. Small read (~few KB), acceptable cost at 10s
// cadence.

import {
  compileRoster,
  scrubFreeText,
  type Roster,
} from "@oral-examiner/anonymizer";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "./student-actions";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Resolve the roster used for scrubbing this session's transcript.
 *
 * Path: binding(canvas_assignment_id) → (teacher_id, canvas_course_id) →
 * course_rosters.students jsonb. The course_rosters row may not exist if
 * the teacher hasn't synced roster recently; returns an empty roster in
 * that case (scrub becomes a no-op rather than throwing — the conversation
 * still completes; PII just doesn't get scrubbed).
 */
export async function loadRosterForCanvasAssignment(
  admin: Admin,
  canvasAssignmentId: string,
): Promise<Roster> {
  const { data: binding } = await admin
    .from("exam_template_bindings")
    .select("teacher_id, canvas_course_id")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (!binding) return [];
  const { data: rosterRow } = await admin
    .from("course_rosters")
    .select("students")
    .eq("teacher_id", binding.teacher_id)
    .eq("canvas_course_id", binding.canvas_course_id)
    .maybeSingle();
  return (rosterRow?.students as Roster | undefined) ?? [];
}

/**
 * Scrub each transcript entry's text against the roster. Compiled once per
 * call (the compile pass builds longest-first regexes per name variant).
 */
export function scrubTranscriptEntries(
  entries: TranscriptEntry[],
  roster: Roster,
): TranscriptEntry[] {
  if (entries.length === 0 || roster.length === 0) return entries;
  const compiled = compileRoster(roster);
  return entries.map((e) => ({
    ...e,
    text: scrubFreeText(e.text, compiled),
  }));
}

/**
 * Scrub a single text blob against the roster. Used for eval / summary
 * Gemini outputs as defense-in-depth (the transcript fed in was already
 * scrubbed, so Gemini shouldn't emit a real name — but a model that
 * paraphrases could potentially reintroduce one).
 */
export function scrubText(text: string, roster: Roster): string {
  if (!text || roster.length === 0) return text;
  const compiled = compileRoster(roster);
  return scrubFreeText(text, compiled);
}
