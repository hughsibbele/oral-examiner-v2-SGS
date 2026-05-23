// M7.4 — automatic Drive save for an exam_session. Called from the
// evaluate-exam Inngest worker after Pass 1 (eval) + Pass 2 (summary)
// land via `write-results`.
//
// Direct port of HH's `apps/web/src/lib/google/save-discussion.ts`
// shape, swapping discussion → exam_session and adjusting the doc body
// composition (transcript + student_summary + evaluation per BUILD_PLAN
// M7 OE row).
//
// Creates one Doc (transcript + student_summary + evaluation, all
// already scrubbed at storage time per CLAUDE.md PII rule) and one
// audio file in the teacher's per-app folder. Doc + audio share a base
// name so they sort together in Drive.
//
// Idempotent at the caller — the Inngest worker skips this step if the
// exam_session row already has a drive_doc_url. Inside this function we
// don't dedup further; a re-run would create a second doc.

import type { Auth } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDoc } from "./docs";
import {
  getOrCreateAppFolder,
  shareWithDomain,
  uploadAudio,
  type DriveFileRef,
} from "./drive";
import { getTeacherGoogleClient } from "./auth";
import type { TranscriptEntry } from "@/lib/exam/student-actions";

const AUDIO_BUCKET = "exam-audio";
const APP_FOLDER_NAME = "Oral Examiner";

export type SavedExamSessionRefs = {
  doc: DriveFileRef;
  audio: DriveFileRef | null;
  folder: { id: string; created: boolean };
};

export type ExamSessionForDriveSave = {
  id: string;
  teacher_id: string;
  student_id: string;
  audio_url: string | null;
  transcript: TranscriptEntry[] | null;
  student_summary: string | null;
  eval_text: string | null;
  completed_at: string | null;
  created_at: string;
  canvas_assignment_id: string;
};

function extensionForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "audio";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function composeBaseName(args: {
  studentName: string;
  assignmentName: string;
  date: string;
}): string {
  // BUILD_PLAN M7 OE row: `{student} – {date} – {assignment}`.
  return `${args.studentName} – ${formatDate(args.date)} – ${args.assignmentName}`;
}

function composeDocBody(args: {
  transcript: TranscriptEntry[] | null;
  student_summary: string | null;
  eval_text: string | null;
}): string {
  const sections: string[] = [];
  if (args.student_summary && args.student_summary.trim().length > 0) {
    sections.push("STUDENT SUMMARY", "", args.student_summary.trim());
  }
  if (args.eval_text && args.eval_text.trim().length > 0) {
    if (sections.length > 0) sections.push("", "", "EVALUATION", "");
    else sections.push("EVALUATION", "");
    sections.push(args.eval_text.trim());
  }
  if (args.transcript && args.transcript.length > 0) {
    if (sections.length > 0) sections.push("", "", "TRANSCRIPT", "");
    else sections.push("TRANSCRIPT", "");
    for (const entry of args.transcript) {
      const label = entry.role === "model" ? "Examiner" : "Student";
      sections.push(`${label}: ${entry.text}`);
    }
  }
  if (sections.length === 0) {
    sections.push("(evaluation is still in progress)");
  }
  return sections.join("\n");
}

async function loadLabels(args: {
  teacherId: string;
  studentId: string;
  canvasAssignmentId: string;
}): Promise<{ studentName: string; assignmentName: string }> {
  const admin = createAdminClient();
  const [{ data: student }, { data: assignment }] = await Promise.all([
    admin
      .from("students")
      .select("display_name")
      .eq("id", args.studentId)
      .maybeSingle(),
    admin
      .from("canvas_assignment_cache")
      .select("payload")
      .eq("teacher_id", args.teacherId)
      .eq("canvas_assignment_id", args.canvasAssignmentId)
      .maybeSingle(),
  ]);
  const payload = assignment?.payload as { name?: string } | null;
  return {
    studentName: student?.display_name ?? "Student",
    assignmentName: payload?.name ?? args.canvasAssignmentId,
  };
}

async function fetchAudio(audioStoragePath: string): Promise<{
  blob: Blob;
  mimeType: string;
  ext: string;
}> {
  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(audioStoragePath, 60 * 10);
  if (error || !signed?.signedUrl) {
    throw new Error(`signed URL: ${error?.message ?? "none returned"}`);
  }
  const res = await fetch(signed.signedUrl);
  if (!res.ok) throw new Error(`audio download: ${res.status}`);
  const blob = await res.blob();
  const mimeType = blob.type || "audio/mp4";
  return { blob, mimeType, ext: extensionForMime(mimeType) };
}

/**
 * Drive-save the session's doc (transcript + summary + eval) + audio file.
 *
 * Persists the resulting folder id back to `teachers.drive_folder_id` if
 * it was auto-created. Returns the Drive refs for the worker to write
 * onto the exam_session row.
 *
 * Audio is best-effort — sessions without audio_url skip the upload
 * gracefully (caller still gets the doc ref).
 */
export async function saveExamSessionToDrive(
  session: ExamSessionForDriveSave,
): Promise<SavedExamSessionRefs> {
  const admin = createAdminClient();

  const { data: teacher, error: teacherErr } = await admin
    .from("teachers")
    .select("drive_folder_id")
    .eq("id", session.teacher_id)
    .single();
  if (teacherErr || !teacher) {
    throw new Error(`teacher lookup: ${teacherErr?.message ?? "not found"}`);
  }

  const client: Auth.OAuth2Client = await getTeacherGoogleClient(
    session.teacher_id,
  );

  const folder = await getOrCreateAppFolder(
    client,
    teacher.drive_folder_id,
    APP_FOLDER_NAME,
  );
  if (folder.created) {
    await admin
      .from("teachers")
      .update({ drive_folder_id: folder.id })
      .eq("id", session.teacher_id);
  }

  const labels = await loadLabels({
    teacherId: session.teacher_id,
    studentId: session.student_id,
    canvasAssignmentId: session.canvas_assignment_id,
  });
  const baseName = composeBaseName({
    studentName: labels.studentName,
    assignmentName: labels.assignmentName,
    date: session.completed_at ?? session.created_at,
  });

  const docBody = composeDocBody({
    transcript: session.transcript,
    student_summary: session.student_summary,
    eval_text: session.eval_text,
  });
  const doc = await createDoc(client, baseName, docBody, folder.id);
  // Share the doc with the EHS domain too — same M7 invariant as the
  // folder. Best-effort.
  await shareWithDomain(client, doc.id).catch(() => {});

  let audioRef: DriveFileRef | null = null;
  if (session.audio_url) {
    const audio = await fetchAudio(session.audio_url);
    audioRef = await uploadAudio(
      client,
      {
        blob: audio.blob,
        filename: `${baseName}.${audio.ext}`,
        mimeType: audio.mimeType,
      },
      folder.id,
    );
  }

  return {
    folder: { id: folder.id, created: folder.created },
    doc,
    audio: audioRef,
  };
}
