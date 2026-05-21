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
// Fail-closed policy (Phase 0 of REMEDIATION_PLAN.md): loadRosterForCanvasAssignment
// THROWS RosterMissingError when any link in the binding → roster chain is
// missing or empty. Callers (flushTranscript, endExamSession) catch and refuse
// to write transcript. The prior "return empty roster, scrub becomes a no-op"
// behavior allowed verbatim student names to reach DB + Gemini eval — explicit
// FERPA violation if it ever fired.

import {
  compileRoster,
  scrubFreeText,
  type Roster,
} from "@oral-examiner/anonymizer";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "./student-actions";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Thrown by loadRosterForCanvasAssignment when the roster used for scrubbing
 * is missing or empty. Callers must catch and refuse to write transcript —
 * writing unscrubbed text is the FERPA violation Phase 0 closes.
 */
export class RosterMissingError extends Error {
  constructor(public readonly reason: string) {
    super(`roster_missing: ${reason}`);
    this.name = "RosterMissingError";
  }
}

/**
 * Resolve the roster used for scrubbing this session's transcript.
 *
 * Path: binding(canvas_assignment_id) → (teacher_id, canvas_course_id) →
 * course_rosters.students jsonb.
 *
 * Throws RosterMissingError if any of: the binding query errors, no binding
 * exists, the roster query errors, no course_rosters row exists, or the
 * roster row exists but its students array is empty / malformed. Phase 1 of
 * the remediation plan will replace this lookup with a session-time roster
 * snapshot column; until then, missing roster at flush time is a hard fail.
 */
export async function loadRosterForCanvasAssignment(
  admin: Admin,
  canvasAssignmentId: string,
): Promise<Roster> {
  const { data: binding, error: bindingErr } = await admin
    .from("exam_template_bindings")
    .select("teacher_id, canvas_course_id")
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (bindingErr) {
    throw new RosterMissingError(
      `binding lookup failed for canvas_assignment_id=${canvasAssignmentId}: ${bindingErr.message}`,
    );
  }
  if (!binding) {
    throw new RosterMissingError(
      `no exam_template_bindings row for canvas_assignment_id=${canvasAssignmentId}`,
    );
  }
  const { data: rosterRow, error: rosterErr } = await admin
    .from("course_rosters")
    .select("students")
    .eq("teacher_id", binding.teacher_id)
    .eq("canvas_course_id", binding.canvas_course_id)
    .maybeSingle();
  if (rosterErr) {
    throw new RosterMissingError(
      `roster lookup failed for teacher=${binding.teacher_id} course=${binding.canvas_course_id}: ${rosterErr.message}`,
    );
  }
  if (!rosterRow) {
    throw new RosterMissingError(
      `no course_rosters row for teacher=${binding.teacher_id} course=${binding.canvas_course_id} — teacher needs to sync roster`,
    );
  }
  const roster = rosterRow.students as unknown as Roster | undefined;
  if (!roster || !Array.isArray(roster) || roster.length === 0) {
    throw new RosterMissingError(
      `course_rosters row exists but students array is empty for teacher=${binding.teacher_id} course=${binding.canvas_course_id}`,
    );
  }
  return roster;
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
