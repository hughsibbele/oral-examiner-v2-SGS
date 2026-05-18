import { NextResponse } from "next/server";
import { getTeacher } from "@/lib/auth/teacher";
import { isAdmin } from "@/lib/auth/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { SESSION_RESERVATION_MINUTES } from "../constants";

export const runtime = "nodejs";

/**
 * Refund the unused portion of a dry-run reservation back to the
 * teacher's daily cap. Pair to /api/try-out/auth-token, which always
 * reserves SESSION_RESERVATION_MINUTES up front. Client posts the actual
 * duration after the session closes; server credits back
 * `max(0, RESERVED - actual)`.
 *
 * No fraud check beyond clamping. Worst case a teacher fakes a short
 * session and gets extra dry-run minutes — admin-only access in a school
 * setting; acceptable threat model. Admin sessions skip this endpoint
 * entirely (their reservations were never deducted).
 */
type Body = {
  /** Total elapsed seconds between start and close on the client. */
  actualSeconds: number;
};

export async function POST(req: Request) {
  const teacherCtx = await getTeacher();
  if (!teacherCtx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Admin sessions skip the cap on the way in, so there's nothing to
  // refund on the way out. Return 200 so the client doesn't show an
  // error.
  if (await isAdmin()) {
    return NextResponse.json({ refundedMinutes: 0, adminBypass: true });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const actualSeconds = Number(body.actualSeconds);
  if (!Number.isFinite(actualSeconds) || actualSeconds < 0) {
    return NextResponse.json({ error: "Invalid actualSeconds." }, { status: 400 });
  }

  // Ceil so a 12.1-second session counts as 1 minute spent, not 0.
  const actualMinutes = Math.ceil(actualSeconds / 60);
  const unusedMinutes = Math.max(0, SESSION_RESERVATION_MINUTES - actualMinutes);

  if (unusedMinutes === 0) {
    return NextResponse.json({ refundedMinutes: 0 });
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("refund_gemini_live_minutes", {
    p_teacher_id: teacherCtx.teacher.id,
    p_minutes: unusedMinutes,
  });
  if (error) {
    return NextResponse.json(
      { error: `Refund failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ refundedMinutes: unusedMinutes });
}
