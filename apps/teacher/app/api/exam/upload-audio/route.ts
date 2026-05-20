// M2b.5d.3 — student audio upload endpoint.
//
// Receives the mixed mic + agent audio blob from the StudentLiveSession
// client on End-exam, writes it to the exam-audio Supabase Storage bucket,
// and returns the storage path. endExamSession then stamps it onto the row.
//
// Service-role for the upload (storage RLS bypassed; the bucket has no
// public read), gated by Supabase auth on the way in.

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED_DOMAIN =
  process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";
const BUCKET = "exam-audio";
const MAX_BLOB_BYTES = 50 * 1024 * 1024; // mirrors bucket file_size_limit

export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!user.email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: "Wrong domain." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body." },
      { status: 400 },
    );
  }
  const examSessionId = formData.get("examSessionId");
  const audio = formData.get("audio");
  if (typeof examSessionId !== "string" || !examSessionId) {
    return NextResponse.json(
      { error: "Missing examSessionId." },
      { status: 400 },
    );
  }
  if (!(audio instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing audio blob." },
      { status: 400 },
    );
  }
  if (audio.size > MAX_BLOB_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${audio.size} > ${MAX_BLOB_BYTES}).` },
      { status: 413 },
    );
  }

  const admin = createAdminClient();

  const { data: session } = await admin
    .from("exam_sessions")
    .select("id, student_id, state")
    .eq("id", examSessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json(
      { error: "Session not found." },
      { status: 404 },
    );
  }
  const { data: student } = await admin
    .from("students")
    .select("email")
    .eq("id", session.student_id)
    .maybeSingle();
  if (!student || student.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Session doesn't belong to this user." },
      { status: 403 },
    );
  }

  // The path lives at `<session_id>.<ext>` (no `exams/` prefix — the
  // bucket itself is named exam-audio). Extension comes from the blob's
  // MIME so signed-URL playback can serve the right Content-Type.
  const mime = audio.type || "audio/webm";
  const ext = pickExtension(mime);
  const path = `${examSessionId}.${ext}`;

  const arrayBuf = await audio.arrayBuffer();
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, arrayBuf, {
      contentType: mime,
      upsert: true, // student retries on transient errors should overwrite
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ audioPath: path, mime });
}

function pickExtension(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "bin";
}
