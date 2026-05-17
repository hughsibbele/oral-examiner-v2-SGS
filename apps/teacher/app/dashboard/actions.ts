"use server";

import { revalidatePath } from "next/cache";
import {
  listTeachingCourses,
  listCourseAssignments,
  listCourseStudentEnrollments,
  getAssignment,
  updateAssignmentDescription,
  buildExamCardBlock,
  replaceOrAppendExamCardBlock,
  removeExamCardBlock,
  CanvasError,
} from "@oral-examiner/canvas";
import type { Json } from "@oral-examiner/db";
import { anonToken, readSaltFromEnv } from "@oral-examiner/anonymizer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCanvasConfigForTeacher } from "@/lib/canvas/server";

function readAppBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "";
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL (or legacy NEXT_PUBLIC_BASE_URL) is not set.",
    );
  }
  return url;
}

/**
 * Active-term filter: pulls only courses whose name OR course_code starts with
 * the current academic-year prefix (e.g. `2025/2026` for May 2026). Inherited
 * from AI Documenter's 10x sync-time reduction. EHS course names follow that
 * prefix convention; if a course doesn't match it falls through to the cache.
 */
function activeTermPrefixForToday(today: Date = new Date()): string {
  // Academic year starts ~August. If we're past July, "year/year+1"; else "year-1/year".
  const m = today.getMonth(); // 0-11
  const y = today.getFullYear();
  return m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

function courseMatchesActiveTerm(name: string | undefined, code: string | undefined): boolean {
  const prefix = activeTermPrefixForToday();
  return (
    (name?.startsWith(prefix) ?? false) || (code?.startsWith(prefix) ?? false)
  );
}

export async function refreshCourses(): Promise<{
  ok: boolean;
  count?: number;
  filtered?: number;
  error?: string;
}> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Canvas token not configured. Visit /dashboard/canvas." };
  }

  let courses;
  try {
    courses = await listTeachingCourses(canvas.config);
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Canvas fetch failed." };
  }

  const filtered = courses.filter((c) => courseMatchesActiveTerm(c.name, c.course_code));
  const toCache = filtered.length > 0 ? filtered : courses; // fail-open if nothing matched

  const admin = createAdminClient();
  const rows = toCache.map((c) => ({
    teacher_id: canvas.teacherId,
    canvas_course_id: String(c.id),
    payload: c as unknown as Json,
    last_synced_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: upErr } = await admin
      .from("canvas_course_cache")
      .upsert(rows, { onConflict: "teacher_id,canvas_course_id" });
    if (upErr) return { ok: false, error: `Cache write failed: ${upErr.message}` };
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    count: rows.length,
    filtered: courses.length - rows.length,
  };
}

export async function refreshAssignments(canvasCourseId: string): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Canvas token not configured." };
  }

  let assignments;
  try {
    assignments = await listCourseAssignments(canvas.config, canvasCourseId);
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Canvas fetch failed." };
  }

  const admin = createAdminClient();
  const rows = assignments
    .filter((a) => a.workflow_state === "published")
    .map((a) => ({
      teacher_id: canvas.teacherId,
      canvas_assignment_id: String(a.id),
      canvas_course_id: canvasCourseId,
      payload: a as unknown as Json,
      last_synced_at: new Date().toISOString(),
    }));

  if (rows.length > 0) {
    const { error: upErr } = await admin
      .from("canvas_assignment_cache")
      .upsert(rows, { onConflict: "teacher_id,canvas_assignment_id" });
    if (upErr) return { ok: false, error: `Cache write failed: ${upErr.message}` };
  }

  revalidatePath(`/dashboard/courses/${canvasCourseId}`);
  return { ok: true, count: rows.length };
}

export async function refreshRoster(canvasCourseId: string): Promise<{
  ok: boolean;
  students?: number;
  skipped?: number;
  error?: string;
}> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Canvas token not configured." };
  }

  let salt: string;
  try {
    salt = readSaltFromEnv();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Salt missing." };
  }

  let enrollments;
  try {
    enrollments = await listCourseStudentEnrollments(canvas.config, canvasCourseId);
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Canvas fetch failed." };
  }

  // Dedupe by canvas user_id; a student in two sections appears twice.
  type Roster = {
    canvas_user_id: string;
    display_name: string;
    email: string;
    anon_token: string;
  };
  const byUser = new Map<string, Roster>();
  let skipped = 0;
  for (const e of enrollments) {
    if (!e.user) {
      skipped++;
      continue;
    }
    const cuid = String(e.user.id);
    if (byUser.has(cuid)) continue;
    const email = (e.user.email ?? e.user.login_id ?? "").trim().toLowerCase();
    if (!email) {
      // students.email is NOT NULL; can't materialize without an identifier.
      skipped++;
      continue;
    }
    byUser.set(cuid, {
      canvas_user_id: cuid,
      display_name: e.user.name,
      email,
      anon_token: anonToken(cuid, email, salt),
    });
  }

  const students = Array.from(byUser.values());
  const syncedAt = new Date().toISOString();
  const admin = createAdminClient();

  if (students.length > 0) {
    const { error: stuErr } = await admin
      .from("students")
      .upsert(
        students.map((s) => ({
          canvas_user_id: s.canvas_user_id,
          email: s.email,
          display_name: s.display_name,
          anon_token: s.anon_token,
        })),
        { onConflict: "canvas_user_id" },
      );
    if (stuErr) return { ok: false, error: `Students write failed: ${stuErr.message}` };
  }

  const { error: rosterErr } = await admin.from("course_rosters").upsert(
    {
      teacher_id: canvas.teacherId,
      canvas_course_id: canvasCourseId,
      students: students as unknown as Json,
      last_synced_at: syncedAt,
    },
    { onConflict: "teacher_id,canvas_course_id" },
  );
  if (rosterErr) return { ok: false, error: `Roster write failed: ${rosterErr.message}` };

  revalidatePath(`/dashboard/courses/${canvasCourseId}`);
  return { ok: true, students: students.length, skipped };
}

type InstallResult = { ok: true } | { ok: false; error: string };

/**
 * Install (or reinstall) the OE branded card into a Canvas assignment's
 * description. Idempotent — re-running strips any existing OE block first
 * (marker-wrapped or comment-stripped) and inserts a fresh one. After a
 * successful PUT we refresh the assignment-cache row so the dashboard's
 * "Installed" indicator updates without an extra Refresh-assignments click.
 */
export async function installOralExamCard({
  canvasCourseId,
  canvasAssignmentId,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
}): Promise<InstallResult> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Canvas token not configured." };
  }

  let appBaseUrl: string;
  try {
    appBaseUrl = readAppBaseUrl();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "App URL missing." };
  }

  try {
    const current = await getAssignment(canvas.config, canvasCourseId, canvasAssignmentId);
    const cardHtml = buildExamCardBlock({ appBaseUrl, canvasAssignmentId });
    const nextDescription = replaceOrAppendExamCardBlock(
      current.description ?? "",
      cardHtml,
      canvasAssignmentId,
    );
    const updated = await updateAssignmentDescription(
      canvas.config,
      canvasCourseId,
      canvasAssignmentId,
      nextDescription,
    );

    const admin = createAdminClient();
    await admin
      .from("canvas_assignment_cache")
      .upsert(
        {
          teacher_id: canvas.teacherId,
          canvas_assignment_id: canvasAssignmentId,
          canvas_course_id: canvasCourseId,
          payload: updated as unknown as Json,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "teacher_id,canvas_assignment_id" },
      );

    revalidatePath(`/dashboard/courses/${canvasCourseId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Install failed." };
  }
}

export async function uninstallOralExamCard({
  canvasCourseId,
  canvasAssignmentId,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
}): Promise<InstallResult> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Canvas token not configured." };
  }

  try {
    const current = await getAssignment(canvas.config, canvasCourseId, canvasAssignmentId);
    const nextDescription = removeExamCardBlock(
      current.description ?? "",
      canvasAssignmentId,
    );
    if (nextDescription === (current.description ?? "")) {
      // Nothing to remove — refresh cache anyway and report ok.
      revalidatePath(`/dashboard/courses/${canvasCourseId}`);
      return { ok: true };
    }
    const updated = await updateAssignmentDescription(
      canvas.config,
      canvasCourseId,
      canvasAssignmentId,
      nextDescription,
    );

    const admin = createAdminClient();
    await admin
      .from("canvas_assignment_cache")
      .upsert(
        {
          teacher_id: canvas.teacherId,
          canvas_assignment_id: canvasAssignmentId,
          canvas_course_id: canvasCourseId,
          payload: updated as unknown as Json,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "teacher_id,canvas_assignment_id" },
      );

    revalidatePath(`/dashboard/courses/${canvasCourseId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Uninstall failed." };
  }
}

