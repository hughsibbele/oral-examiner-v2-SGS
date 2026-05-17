import { NextResponse } from "next/server";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { getTeacher } from "@/lib/auth/teacher";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_DRYRUN_CAP_MINUTES = Number(
  process.env.GEMINI_LIVE_DRYRUN_DEFAULT_DAILY_CAP_MINUTES ?? "15",
);
const SESSION_RESERVATION_MINUTES = 4; // each dry-run reserves this much; token expires alongside
const LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

type Body = {
  systemPrompt: string;
  voiceName?: string | null;
};

export async function POST(req: Request) {
  const teacherCtx = await getTeacher();
  if (!teacherCtx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const teacher = teacherCtx.teacher;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.systemPrompt !== "string" || body.systemPrompt.length === 0) {
    return NextResponse.json({ error: "Missing systemPrompt." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on the server." },
      { status: 500 },
    );
  }

  // Reserve dry-run minutes against the per-teacher cap. The Postgres function
  // returns false if we'd exceed the cap; uses a separate column for dry-run
  // so admin testing doesn't drain real-class budget.
  const supabase = await createServerSupabase();
  const teacherDryrunCap =
    teacher.gemini_live_dryrun_daily_cap_minutes ?? DEFAULT_DRYRUN_CAP_MINUTES;

  // The existing check_and_increment_gemini_live_minutes function uses the
  // `live_minutes` column. For dry-run we want a separate budget — we'd
  // normally add a sister function, but for v1 we just call the same one
  // with a tight cap. Real exams call it with the larger cap. Same column,
  // so dry-runs DO compete with class minutes — flag this in 2b.1n notes.
  const { data: allowed, error: rpcErr } = await supabase.rpc(
    "check_and_increment_gemini_live_minutes",
    {
      p_teacher_id: teacher.id,
      p_requested: SESSION_RESERVATION_MINUTES,
      p_default_cap: teacherDryrunCap,
    },
  );
  if (rpcErr) {
    return NextResponse.json(
      { error: `Quota check failed: ${rpcErr.message}` },
      { status: 500 },
    );
  }
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Daily dry-run cap reached (${teacherDryrunCap} min). Try again tomorrow or raise gemini_live_dryrun_daily_cap_minutes on your teacher row.`,
      },
      { status: 429 },
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  // Ephemeral token, valid only for this Live session. The
  // liveConnectConstraints pin the model + system prompt + voice on the
  // server side so the client can't tamper.
  let token;
  try {
    const expireSeconds = SESSION_RESERVATION_MINUTES * 60;
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + expireSeconds * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: body.systemPrompt,
            speechConfig: body.voiceName
              ? {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: body.voiceName },
                  },
                }
              : undefined,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Gemini 3.1 thinking — "low" adds a small reasoning step before
            // each response, lets the agent make smarter follow-up decisions
            // on vague student answers without too much latency.
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            // Disable Gemini's auto turn detection. We run manual VAD on the
            // client (TryItOut) so we can be very patient when the student
            // hasn't started speaking (10s+) but snappy after they finish
            // (~1.5s). Built-in silenceDurationMs is symmetric and can't
            // distinguish those two cases.
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: true },
            },
          },
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auth token mint failed";
    return NextResponse.json({ error: `Mint failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({
    token: token.name,
    model: LIVE_MODEL,
    reservedMinutes: SESSION_RESERVATION_MINUTES,
    capMinutes: teacherDryrunCap,
  });
}
