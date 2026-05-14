"use server";

import { revalidatePath } from "next/cache";
import { listTeachingCourses, listCourseAssignments, CanvasError } from "@oral-examiner/canvas";
import type { Json } from "@oral-examiner/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCanvasConfigForTeacher } from "@/lib/canvas/server";

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
