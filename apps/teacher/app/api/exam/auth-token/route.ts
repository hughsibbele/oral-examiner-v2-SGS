// M2b.5d.1 — student-scoped ephemeral Gemini Live token endpoint.
//
// Sibling of /api/try-out/auth-token (teacher dry-run), with student-specific
// guards: session-state check (`state='started'` only), ownership check
// (auth.user.email must match students.email), and a per-session minute
// budget on exam_sessions.live_minutes_used (rather than a teacher daily cap).
//
// Service-role throughout the DB reads — the recursion-fix migration
// (20260518021328) means there's no student RLS path through exam_templates,
// so we use the admin client and gate access ourselves.

import { NextResponse } from "next/server";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assembleSystemPrompt } from "@/lib/runtime/assemble-prompt";
import {
  estimateDurationMin,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";
import {
  composeIntakePack,
  parseIntakeConfig,
} from "@/lib/intake/types";
import { getCanvasConfigByTeacherId } from "@/lib/canvas/server";
import { getSubmission } from "@oral-examiner/canvas";
import type { SelectedQuestion } from "@/lib/runtime/select-questions";
import type { Database } from "@oral-examiner/db";

type Template = Database["public"]["Tables"]["exam_templates"]["Row"];
type Preset = Database["public"]["Tables"]["personality_presets"]["Row"];

export const runtime = "nodejs";

const LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

const ALLOWED_DOMAIN =
  process.env.ADMIN_EMAIL_DOMAIN ?? "episcopalhighschool.org";

// Token TTL = estimated duration + buffer, clamped to a hard ceiling so a
// single runaway session can't bill indefinitely. The estimate is a soft
// number; some students take longer to talk through follow-ups, so the
// buffer matters. 30 min hard cap matches the SOFT_MAX_DURATION_MIN +
// generous slack.
const TOKEN_BUFFER_MIN = 3;
const HARD_MAX_MINUTES = 30;
const MIN_RESERVATION_MIN = 5;

type Body = { examSessionId: string };

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.examSessionId !== "string" || !body.examSessionId) {
    return NextResponse.json(
      { error: "Missing examSessionId." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: session, error: sessionErr } = await admin
    .from("exam_sessions")
    .select(
      "id, state, student_id, exam_template_id, personality_preset_id, canvas_assignment_id, selected_questions",
    )
    .eq("id", body.examSessionId)
    .maybeSingle();
  if (sessionErr) {
    return NextResponse.json(
      { error: `Session lookup failed: ${sessionErr.message}` },
      { status: 500 },
    );
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.state !== "started") {
    return NextResponse.json(
      {
        error: `Session is not in 'started' state (${session.state}). Refresh /exam/${session.canvas_assignment_id} to start a new attempt.`,
      },
      { status: 409 },
    );
  }

  // Ownership: the row's student must match the signed-in email. Catches a
  // tab-share / link-share where someone authenticated grabs another
  // student's session id.
  const { data: studentRow, error: studentErr } = await admin
    .from("students")
    .select("id, email, canvas_user_id")
    .eq("id", session.student_id)
    .maybeSingle();
  if (studentErr || !studentRow) {
    return NextResponse.json(
      { error: "Student lookup failed." },
      { status: 500 },
    );
  }
  if (studentRow.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Session doesn't belong to this user." },
      { status: 403 },
    );
  }

  // Load binding (for teacher_id, which keys canvas_assignment_cache).
  const { data: binding } = await admin
    .from("exam_template_bindings")
    .select("teacher_id")
    .eq("canvas_assignment_id", session.canvas_assignment_id)
    .maybeSingle();
  const teacherId = binding?.teacher_id ?? null;

  // Load agent. Session points at template OR preset (CHECK constraint
  // enforces exactly-one-of). When template-linked, fall back to the
  // template's parent preset for inherited fields.
  let templateRow: Template | null = null;
  let presetRow: Preset | null = null;

  if (session.exam_template_id) {
    const { data: t, error: tErr } = await admin
      .from("exam_templates")
      .select("*")
      .eq("id", session.exam_template_id)
      .maybeSingle();
    if (tErr || !t) {
      return NextResponse.json(
        { error: `Template load failed: ${tErr?.message ?? "missing"}` },
        { status: 500 },
      );
    }
    templateRow = t;
    if (templateRow.personality_preset_id) {
      const { data: p } = await admin
        .from("personality_presets")
        .select("*")
        .eq("id", templateRow.personality_preset_id)
        .maybeSingle();
      presetRow = p ?? null;
    }
  } else if (session.personality_preset_id) {
    const { data: p, error: pErr } = await admin
      .from("personality_presets")
      .select("*")
      .eq("id", session.personality_preset_id)
      .maybeSingle();
    if (pErr || !p) {
      return NextResponse.json(
        { error: `Preset load failed: ${pErr?.message ?? "missing"}` },
        { status: 500 },
      );
    }
    presetRow = p;
  } else {
    return NextResponse.json(
      { error: "Session has no agent reference." },
      { status: 500 },
    );
  }

  // Effective values: template override ?? preset fallback. Blank-slate
  // templates (preset=null) must have their own persona/flow text — bail
  // with a helpful error if not so the student doesn't sit on a black
  // screen.
  const personaBody = (
    templateRow?.persona_body ??
    presetRow?.persona_body ??
    ""
  ).trim();
  const flowBody = (
    templateRow?.flow_body ??
    presetRow?.flow_body ??
    ""
  ).trim();
  if (!personaBody || !flowBody) {
    return NextResponse.json(
      {
        error:
          "This exam's agent has no persona or flow text. Your teacher needs to finish configuring it.",
      },
      { status: 500 },
    );
  }
  const openingText =
    templateRow?.opening_text ?? presetRow?.opening_text ?? null;
  const closingText =
    templateRow?.closing_text ?? presetRow?.closing_text ?? null;
  const voiceName =
    templateRow?.live_voice_name ?? presetRow?.live_voice_name ?? null;
  const followUpDepth = (templateRow?.follow_up_depth ??
    presetRow?.follow_up_depth ??
    "medium") as FollowUpDepth;
  const personalizationEnabled =
    templateRow?.personalization_enabled ??
    presetRow?.personalization_enabled ??
    false;
  const intakeConfig = parseIntakeConfig(
    templateRow?.intake_config ?? presetRow?.intake_config ?? null,
  );

  // Safety envelope (singleton).
  const { data: envelope, error: envelopeErr } = await admin
    .from("safety_envelope")
    .select("body")
    .eq("id", 1)
    .maybeSingle();
  if (envelopeErr || !envelope) {
    return NextResponse.json(
      { error: `Safety envelope missing: ${envelopeErr?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  // Questions were frozen at start-exam time; do not re-pick here or the
  // ready-screen estimate and the actual conversation diverge.
  const selectedQuestions =
    (session.selected_questions as SelectedQuestion[] | null) ?? [];

  // Intake context. canvas_description comes from the per-teacher
  // canvas_assignment_cache.payload (no need to re-hit Canvas — the cache is
  // refreshed when the teacher syncs). canvas_submission_body fetches live
  // from Canvas using the binding-teacher's decrypted token, because the
  // student edits this between sync passes. Both paths fail open: a missing
  // cache row, decrypt failure, or Canvas hiccup just drops that section
  // from the intake pack rather than blocking the exam.
  let canvasDescription: string | null = null;
  let canvasCourseId: string | null = null;
  if (
    teacherId &&
    (intakeConfig.use_canvas_description || intakeConfig.use_canvas_submission)
  ) {
    const { data: cache } = await admin
      .from("canvas_assignment_cache")
      .select("canvas_course_id, payload")
      .eq("teacher_id", teacherId)
      .eq("canvas_assignment_id", session.canvas_assignment_id)
      .maybeSingle();
    canvasCourseId = (cache?.canvas_course_id as string | null) ?? null;
    if (intakeConfig.use_canvas_description) {
      const payload = cache?.payload as { description?: string | null } | null;
      canvasDescription = payload?.description ?? null;
    }
  }

  let canvasSubmissionBody: string | null = null;
  if (
    intakeConfig.use_canvas_submission &&
    teacherId &&
    canvasCourseId &&
    studentRow.canvas_user_id
  ) {
    try {
      const canvasConfig = await getCanvasConfigByTeacherId(teacherId);
      if (canvasConfig) {
        const submission = await getSubmission(
          canvasConfig,
          canvasCourseId,
          session.canvas_assignment_id,
          studentRow.canvas_user_id,
        );
        canvasSubmissionBody = submission.body ?? null;
      }
    } catch (err) {
      // Fail open — agent loses context but the exam still runs. Log to
      // server console so a misconfig (revoked token, wrong host) is
      // visible without students seeing a cryptic error.
      console.error(
        `[exam/auth-token] Canvas submission fetch failed for session=${session.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const intakePack = composeIntakePack(intakeConfig, {
    canvas_description: canvasDescription,
    canvas_submission_body: canvasSubmissionBody,
  });

  const systemPrompt = assembleSystemPrompt({
    envelope_body: envelope.body,
    persona_body: personaBody,
    flow_body: flowBody,
    flow_parameters: {
      follow_up_depth: followUpDepth,
      personalization_enabled: personalizationEnabled,
    },
    selected_questions: selectedQuestions,
    opening_text: openingText,
    closing_text: closingText,
    intake_pack: intakePack,
  });

  // Per-session minute reservation. Token TTL = reservation; 5d.3 refunds
  // any unused portion when the session closes (refund_gemini_live_minutes_session).
  const estDuration = estimateDurationMin(
    selectedQuestions.length,
    followUpDepth,
  );
  const reservedMinutes = Math.ceil(
    Math.min(
      HARD_MAX_MINUTES,
      Math.max(estDuration + TOKEN_BUFFER_MIN, MIN_RESERVATION_MIN),
    ),
  );

  // Phase 2 idempotent reservation: gate the UPDATE on state='started'
  // AND live_minutes_used=0 so a double-click on Start (or a network
  // retry) can't mint two billable Gemini tokens. The first call wins;
  // the second sees zero rows-affected and returns 409. If a token mint
  // later fails, the catch block below rolls back live_minutes_used to 0
  // so the student can retry. Sessions wedged at live_minutes_used > 0
  // (tab closed before audio connected, no markInProgress flip) are
  // recovered by the Phase 3 stale-session sweep — until that ships,
  // the teacher reset affordance is the manual escape hatch.
  const { data: reservedRows, error: reserveErr } = await admin
    .from("exam_sessions")
    .update({ live_minutes_used: reservedMinutes })
    .eq("id", session.id)
    .eq("state", "started")
    .eq("live_minutes_used", 0)
    .select("id");
  if (reserveErr) {
    return NextResponse.json(
      { error: `Reservation failed: ${reserveErr.message}` },
      { status: 500 },
    );
  }
  if (!reservedRows || reservedRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "A token was already issued for this session, or the session has already started. Ask your teacher to reset the session if you need a fresh start.",
      },
      { status: 409 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on the server." },
      { status: 500 },
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  let token;
  try {
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(
          Date.now() + reservedMinutes * 60 * 1000,
        ).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: systemPrompt,
            speechConfig: voiceName
              ? {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                }
              : undefined,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            // Same asymmetric VAD pattern as TryItOut — disable Gemini's
            // built-in auto turn detection; the client runs a manual state
            // machine that's patient before speech and snappy after.
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: true },
            },
          },
        },
      },
    });
  } catch (err) {
    // Roll back the reservation — the token never materialized so the
    // student can retry without losing their budget.
    await admin
      .from("exam_sessions")
      .update({ live_minutes_used: 0 })
      .eq("id", session.id);
    const msg = err instanceof Error ? err.message : "auth token mint failed";
    return NextResponse.json({ error: `Mint failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({
    token: token.name,
    model: LIVE_MODEL,
    reservedMinutes,
  });
}
