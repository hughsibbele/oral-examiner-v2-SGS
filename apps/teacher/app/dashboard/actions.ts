"use server";

import { revalidatePath } from "next/cache";
import {
  listTeachingCourses,
  listCourseAssignments,
  listCourseStudentUsers,
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
import {
  ensureTeacherOwnsAssignment,
  getCanvasConfigForTeacher,
} from "@/lib/canvas/server";
import { resolveCardTextForTeacher } from "@/lib/card-text/resolve";
import { isActiveTerm } from "@/lib/sync/active-term";

function readAppBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set.");
  }
  return url;
}

// Active-term filtering lives in lib/sync/active-term.ts and reads
// payload.term.name (e.g. "2025/2026 - High School - 1st Semester").
// Filtering on course name / course_code (the earlier approach) missed
// EHS's "2526-..." course-name prefix convention; term.name is the
// canonical academic-year tag on Canvas.

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

  const filtered = courses.filter((c) => isActiveTerm(c.term?.name));
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

/**
 * Unified "Refresh from Canvas" action for the dashboard accordion. Fetches
 * teaching courses + assignments for every active-term course in one click,
 * mirroring AI Documenter's `refreshCanvas` pattern. Per-course `refreshAssignments`
 * stays available for callers (admin tooling, future cron) that need just one.
 */
export async function refreshAllCanvas(): Promise<{
  ok: boolean;
  courseCount?: number;
  assignmentCount?: number;
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

  const filteredCourses = courses.filter((c) => isActiveTerm(c.term?.name));
  // Fail-open: if nothing matched the term filter, cache them all so a brand-
  // new term that doesn't fit the prefix still surfaces. The dashboard render
  // still partitions into active vs other.
  const coursesToCache = filteredCourses.length > 0 ? filteredCourses : courses;

  const syncedAt = new Date().toISOString();
  const admin = createAdminClient();

  const courseRows = coursesToCache.map((c) => ({
    teacher_id: canvas.teacherId,
    canvas_course_id: String(c.id),
    payload: c as unknown as Json,
    last_synced_at: syncedAt,
  }));
  if (courseRows.length > 0) {
    const { error: courseErr } = await admin
      .from("canvas_course_cache")
      .upsert(courseRows, { onConflict: "teacher_id,canvas_course_id" });
    if (courseErr) {
      return { ok: false, error: `Course cache write failed: ${courseErr.message}` };
    }
  }

  // Pull assignments only for active-term courses; previous terms shouldn't
  // burn Canvas API budget on every refresh.
  let assignmentTotal = 0;
  const assignmentErrors: string[] = [];
  for (const c of filteredCourses) {
    const courseId = String(c.id);
    try {
      const assignments = await listCourseAssignments(canvas.config, courseId);
      const rows = assignments
        .filter((a) => a.workflow_state === "published")
        .map((a) => ({
          teacher_id: canvas.teacherId,
          canvas_assignment_id: String(a.id),
          canvas_course_id: courseId,
          payload: a as unknown as Json,
          last_synced_at: syncedAt,
        }));
      if (rows.length > 0) {
        const { error: asgErr } = await admin
          .from("canvas_assignment_cache")
          .upsert(rows, { onConflict: "teacher_id,canvas_assignment_id" });
        if (asgErr) assignmentErrors.push(`${c.name}: ${asgErr.message}`);
        else assignmentTotal += rows.length;
      }
    } catch (err) {
      const msg = err instanceof CanvasError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Canvas fetch failed.";
      assignmentErrors.push(`${c.name}: ${msg}`);
    }
  }

  revalidatePath("/dashboard");

  if (assignmentErrors.length > 0 && assignmentTotal === 0) {
    return { ok: false, error: `Assignment sync failed: ${assignmentErrors[0]}` };
  }

  return {
    ok: true,
    courseCount: courseRows.length,
    assignmentCount: assignmentTotal,
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

  let users;
  try {
    users = await listCourseStudentUsers(canvas.config, canvasCourseId);
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Canvas fetch failed." };
  }

  // /courses/:id/users is already deduped by Canvas (no section-fanout).
  type Roster = {
    canvas_user_id: string;
    display_name: string;
    email: string;
    anon_token: string;
  };
  const byUser = new Map<string, Roster>();
  let skipped = 0;
  for (const u of users) {
    const cuid = String(u.id);
    if (byUser.has(cuid)) continue;
    // Reject anything that isn't actually an email. Canvas can hide
    // `email` for student users when the token lacks the "View email
    // addresses" permission; pre-2026-05-20 code fell back to login_id
    // and stored e.g. "jsmith23" as the email, which never matched the
    // student's Google-OAuth identity at sign-in. If email is missing,
    // skip the row and surface the count so the teacher can chase the
    // Canvas permission rather than getting a silently broken roster.
    const raw = (u.email ?? u.primary_email ?? "").trim().toLowerCase();
    if (!raw || !raw.includes("@")) {
      skipped++;
      continue;
    }
    byUser.set(cuid, {
      canvas_user_id: cuid,
      display_name: u.name,
      email: raw,
      anon_token: anonToken(cuid, raw, salt),
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

  // M2b.5b.11.a: defense-in-depth ownership check before any writes.
  // Catches stale ids from old UIs / direct callers that don't match
  // any synced assignment for this teacher.
  const owns = await ensureTeacherOwnsAssignment(
    canvas.teacherId,
    canvasAssignmentId,
  );
  if (!owns.ok) return { ok: false, error: owns.error };

  // Invariant guard: every Canvas card has to have an agent assigned. This
  // entry point is reached from the dashboard accordion (re-install path)
  // and the assignment configure page's InstallCardButton (UI-gated to
  // disabled). Server-side check is defense-in-depth — the client-side
  // disable can be bypassed by direct callers.
  const adminClient = createAdminClient();
  const { data: existingBinding } = await adminClient
    .from("exam_template_bindings")
    .select("exam_template_id, personality_preset_id")
    .eq("teacher_id", canvas.teacherId)
    .eq("canvas_assignment_id", canvasAssignmentId)
    .maybeSingle();
  if (!existingBinding) {
    return {
      ok: false,
      error:
        "Pick an agent template before installing the Canvas card — cards without an agent route students nowhere.",
    };
  }

  let appBaseUrl: string;
  try {
    appBaseUrl = readAppBaseUrl();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "App URL missing." };
  }

  try {
    const current = await getAssignment(canvas.config, canvasCourseId, canvasAssignmentId);
    const text = await resolveCardTextForTeacher(canvas.teacherId);
    const cardHtml = buildExamCardBlock({
      appBaseUrl,
      canvasAssignmentId,
      text,
    });
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

    await adminClient
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

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/courses/${canvasCourseId}`);
    revalidatePath(
      `/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
    );
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

  const owns = await ensureTeacherOwnsAssignment(
    canvas.teacherId,
    canvasAssignmentId,
  );
  if (!owns.ok) return { ok: false, error: owns.error };

  try {
    const current = await getAssignment(canvas.config, canvasCourseId, canvasAssignmentId);
    const nextDescription = removeExamCardBlock(
      current.description ?? "",
      canvasAssignmentId,
    );
    if (nextDescription === (current.description ?? "")) {
      // Nothing to remove — refresh cache anyway and report ok.
      revalidatePath("/dashboard");
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

    // Uninstalling the card also drops the binding — keeping the binding
    // around with no card in Canvas leaves a phantom "this assignment has
    // an agent assigned" state in the dashboard. One invariant: card and
    // binding move together.
    await admin
      .from("exam_template_bindings")
      .delete()
      .eq("teacher_id", canvas.teacherId)
      .eq("canvas_assignment_id", canvasAssignmentId);

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/courses/${canvasCourseId}`);
    revalidatePath(
      `/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
    );
    revalidatePath("/dashboard/agents");
    return { ok: true };
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Uninstall failed." };
  }
}

export async function updateCourseNickname(
  canvasCourseId: string,
  shortName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const canvas = await getCanvasConfigForTeacher();
  if (!canvas) {
    return { ok: false, error: "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("canvas_course_cache")
    .update({ short_name: shortName || null })
    .eq("teacher_id", canvas.teacherId)
    .eq("canvas_course_id", canvasCourseId);

  if (error) {
    return { ok: false, error: `Update failed: ${error.message}` };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

// cloneAgentToTemplate / changeAgentForTemplate removed in M2b.5b dashboard
// refactor (2026-05-18). Custom templates are now standalone, created via
// cloneAgentTemplate() in /dashboard/agents/actions.ts; per-assignment
// agent picks (default agent or custom template) go through
// setAssignmentAgent() / installCardForAssignment() in the same file.
