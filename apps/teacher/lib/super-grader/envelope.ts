import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "@/lib/exam/student-actions";

const AUDIO_BUCKET = "exam-audio";
const AUDIO_SIGNED_URL_TTL_SECONDS = 60 * 60;

export type OralExaminerEnvelope = {
  schema_version: 1;
  peer: "oral_examiner";
  canvas_user_id: string;
  canvas_assignment_id: string;
  anon_token: string;
  completed_at: string;
  summary: {
    per_criterion_scores?: Record<string, number> | null;
    suggested_adjustment?: number | null;
    full_eval?: string | null;
    transcript?: string | null;
    audio_url?: string | null;
    google_doc_url?: string | null;
  };
  links: {
    detail_url: string;
  };
};

/**
 * Build the outbound envelope for a completed exam session.
 * Returns null if the session is missing essential data.
 *
 * Transcript + eval + summary are already roster-scrubbed at write time,
 * so we hand them out as-is. Audio is delivered as a 1-hour signed URL.
 */
export async function buildOralExaminerEnvelope(
  examSessionId: string,
): Promise<OralExaminerEnvelope | null> {
  const admin = createAdminClient();

  const { data: session, error: sessionErr } = await admin
    .from("exam_sessions")
    .select(
      "id, canvas_assignment_id, student_id, transcript, eval_text, student_summary, audio_url, drive_doc_url, completed_at, created_at, students!inner(canvas_user_id, anon_token)",
    )
    .eq("id", examSessionId)
    .eq("state", "completed")
    .single();

  if (sessionErr || !session) return null;

  type StudentJoin = { canvas_user_id: string; anon_token: string };
  const student = Array.isArray(session.students)
    ? (session.students[0] as StudentJoin | undefined)
    : (session.students as StudentJoin | null);
  if (!student?.canvas_user_id || !student?.anon_token) return null;

  let signedAudioUrl: string | null = null;
  if (session.audio_url) {
    const { data: signed } = await admin.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(session.audio_url, AUDIO_SIGNED_URL_TTL_SECONDS);
    signedAudioUrl = signed?.signedUrl ?? null;
  }

  const transcriptEntries =
    (session.transcript as TranscriptEntry[] | null) ?? [];
  const transcriptText = transcriptEntries.length > 0
    ? transcriptEntries
        .map((e) => `${e.role === "model" ? "Examiner" : "Student"}: ${e.text}`)
        .join("\n\n")
    : null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  return {
    schema_version: 1,
    peer: "oral_examiner",
    canvas_user_id: student.canvas_user_id,
    canvas_assignment_id: session.canvas_assignment_id,
    anon_token: student.anon_token,
    completed_at:
      session.completed_at ?? session.created_at ?? new Date().toISOString(),
    summary: {
      full_eval: session.eval_text ?? null,
      transcript: transcriptText,
      audio_url: signedAudioUrl,
      google_doc_url: session.drive_doc_url ?? null,
    },
    links: {
      detail_url: `${appUrl}/dashboard`,
    },
  };
}
