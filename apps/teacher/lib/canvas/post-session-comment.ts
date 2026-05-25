// M7.4 — post a draft Canvas comment on the student's submission for
// this exam_session, carrying the Drive doc link. Called from the
// evaluate-exam Inngest worker after the Drive doc lands.
//
// Direct port of HH's `lib/canvas/post-discussion-comment.ts` shape.
// One difference: OE is per-student (one session = one student =
// one comment), not per-class fan-out like HH. The HH file calls
// `postTeacherDraftComment` N times in a loop; OE calls it once.
//
// All resolution flows through `exam_template_bindings` since OE's
// `exam_sessions` row has no direct teacher_id — teacher + course are
// looked up by canvas_assignment_id via the binding (which is also
// where the destination toggle lives).
//
// Gates the post on TWO booleans: the teacher-level master switch
// (`teachers.canvas_comment_enabled`, default true) AND the per-
// assignment override (`exam_template_bindings.post_to_canvas_comment`,
// default true). Either off → skipped with reason.
//
// Best-effort: never throws — failure lands in the recorded status.

import { postTeacherDraftComment } from "@oral-examiner/canvas";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCanvasConfigByTeacherId } from "@/lib/canvas/server";

type PostOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "posted"; canvas_user_id: string }
  | { kind: "failed"; canvas_user_id: string; error: string };

export async function postSessionDraftComment(args: {
  examSessionId: string;
  driveDocUrl: string;
}): Promise<PostOutcome> {
  const admin = createAdminClient();

  // Load session essentials (canvas_assignment_id + student's
  // canvas_user_id). Teacher + course resolve via the binding below.
  const { data: session, error: sessionErr } = await admin
    .from("exam_sessions")
    .select(
      "id, canvas_assignment_id, students!inner(canvas_user_id)",
    )
    .eq("id", args.examSessionId)
    .single();
  if (sessionErr || !session) {
    return {
      kind: "skipped",
      reason: `session lookup: ${sessionErr?.message ?? "not found"}`,
    };
  }
  type StudentJoin = { canvas_user_id: string };
  const student = Array.isArray(session.students)
    ? (session.students[0] as StudentJoin | undefined)
    : (session.students as StudentJoin | null);
  if (!student?.canvas_user_id) {
    return { kind: "skipped", reason: "no canvas_user_id on student" };
  }

  // Resolve teacher + course + per-assignment override from the binding.
  const { data: binding, error: bindingErr } = await admin
    .from("exam_template_bindings")
    .select("teacher_id, canvas_course_id, post_to_canvas_comment")
    .eq("canvas_assignment_id", session.canvas_assignment_id)
    .maybeSingle();
  if (bindingErr || !binding) {
    return {
      kind: "skipped",
      reason: `binding lookup: ${bindingErr?.message ?? "no binding"}`,
    };
  }
  if (binding.post_to_canvas_comment === false) {
    return {
      kind: "skipped",
      reason: "exam_template_bindings.post_to_canvas_comment is false",
    };
  }

  // Teacher master switch.
  const { data: teacher, error: teacherErr } = await admin
    .from("teachers")
    .select("canvas_comment_enabled")
    .eq("id", binding.teacher_id)
    .maybeSingle();
  if (teacherErr || !teacher) {
    return {
      kind: "skipped",
      reason: `teacher lookup: ${teacherErr?.message ?? "not found"}`,
    };
  }
  if (!teacher.canvas_comment_enabled) {
    return { kind: "skipped", reason: "canvas_comment_enabled is false" };
  }

  const config = await getCanvasConfigByTeacherId(binding.teacher_id);
  if (!config) {
    return {
      kind: "skipped",
      reason: "teacher has no encrypted Canvas token configured",
    };
  }

  const text = composeCommentText(args.driveDocUrl);

  try {
    await postTeacherDraftComment(
      config,
      binding.canvas_course_id,
      session.canvas_assignment_id,
      student.canvas_user_id,
      text,
    );
    return { kind: "posted", canvas_user_id: student.canvas_user_id };
  } catch (err) {
    return {
      kind: "failed",
      canvas_user_id: student.canvas_user_id,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function composeCommentText(driveDocUrl: string): string {
  return [
    "Oral Examiner finished evaluating this session.",
    "",
    `Transcript + summary + evaluation: ${driveDocUrl}`,
    "",
    "(This is a draft comment — only visible to you until you publish.)",
    "",
    "<!-- oral-examiner:evaluation v=1 -->",
  ].join("\n");
}
