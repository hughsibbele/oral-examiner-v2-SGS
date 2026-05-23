// M2b.5d.4 — Inngest evaluate-exam function.
//
// Triggered by `exam.completed` from endExamSession (5d.3). Reads the
// already-scrubbed transcript from exam_sessions.transcript, runs two
// Gemini text-only passes (eval + summary), and writes the outputs back
// to eval_text + student_summary. Outputs scrubbed again post-Gemini as
// defense-in-depth (transcript IN was scrubbed, but a paraphrasing model
// could conceivably re-introduce a name).
//
// PII posture: Gemini sees the anonymized transcript (Student_xxxxxx
// tokens) — no real names. Matches the repo CLAUDE.md "PII never reaches
// Gemini for text reasoning" rule.
//
// Pre-check: if call_duration_sec < 60, exit early. 5c.3 already
// short-circuits sub-1-min completions client-side (state→excluded), but
// the Inngest path defends in depth against teacher-reset races.

import { GoogleGenAI } from "@google/genai";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadRosterForSession,
  RosterMissingError,
  scrubText,
} from "@/lib/exam/scrub";
import { postSessionDraftComment } from "@/lib/canvas/post-session-comment";
import { saveExamSessionToDrive } from "@/lib/google/save-exam-session";
import type { Database, Json } from "@oral-examiner/db";
import type { TranscriptEntry } from "@/lib/exam/student-actions";
import { EXAM_COMPLETED_EVENT, inngest } from "./client";

const GEMINI_MODEL = process.env.GEMINI_EVAL_MODEL ?? "gemini-2.5-flash";
const SHORT_ATTEMPT_THRESHOLD_SEC = 60;

type Preset = Database["public"]["Tables"]["personality_presets"]["Row"];
type Template = Database["public"]["Tables"]["exam_templates"]["Row"];

export const evaluateExam = inngest.createFunction(
  {
    id: "evaluate-exam",
    retries: 3,
    triggers: [{ event: EXAM_COMPLETED_EVENT }],
    onFailure: async ({ event, error }) => {
      // Surface the error onto the session row so the teacher reset
      // affordance has something to show. eval_error column was added in
      // migration 20260519130039 (M2b.5c.5) for exactly this.
      const orig = (event.data as {
        event?: { data?: { exam_session_id?: string } };
      }).event;
      const sessionId = orig?.data?.exam_session_id;
      if (!sessionId) return;
      const admin = createAdminClient();
      await admin
        .from("exam_sessions")
        .update({
          eval_error: String(error?.message ?? error ?? "unknown").slice(
            0,
            1000,
          ),
        })
        .eq("id", sessionId);
    },
  },
  async ({ event, step, logger }) => {
    const { exam_session_id: sessionId } = event.data as {
      exam_session_id: string;
    };
    if (!sessionId) {
      throw new Error("evaluate-exam: missing exam_session_id in event data");
    }

    const admin = createAdminClient();

    const session = await step.run("load-session", async () => {
      const { data, error } = await admin
        .from("exam_sessions")
        .select(
          "id, state, call_duration_sec, transcript, canvas_assignment_id, exam_template_id, personality_preset_id, eval_prompt_body_snapshot, rubric_body_snapshot, persona_name_snapshot",
        )
        .eq("id", sessionId)
        .maybeSingle();
      if (error) throw new Error(`load-session: ${error.message}`);
      if (!data) throw new Error(`load-session: not found ${sessionId}`);
      return data;
    });

    // Defense-in-depth short-call check. Client (5c.3) and end-exam
    // (state='excluded' for sub-1-min auto-archive) already cover this,
    // but if the row reaches here in 'completed' with a short duration,
    // skip eval.
    if (
      (session.call_duration_sec ?? 0) < SHORT_ATTEMPT_THRESHOLD_SEC ||
      session.state !== "completed"
    ) {
      logger.info(
        `[evaluate-exam] skipping session=${sessionId} state=${session.state} duration=${session.call_duration_sec}`,
      );
      return { skipped: true };
    }

    const transcriptEntries =
      (session.transcript as TranscriptEntry[] | null) ?? [];
    if (transcriptEntries.length === 0) {
      logger.info(`[evaluate-exam] empty transcript session=${sessionId}`);
      return { skipped: true, reason: "empty-transcript" };
    }

    const transcriptText = formatTranscriptForEval(transcriptEntries);

    const agent = await step.run("load-agent", async () => {
      // Phase 1: prefer the session snapshot. persona_name_snapshot is the
      // most reliable sentinel — it's always set when begin_exam_session ran,
      // even if both eval_prompt + rubric are null (ungraded agents).
      const hasSnapshot = session.persona_name_snapshot !== null;
      if (hasSnapshot) {
        return {
          evalPromptBody: session.eval_prompt_body_snapshot,
          rubricBody: session.rubric_body_snapshot,
          fromSnapshot: true,
        };
      }
      // Legacy path: sessions started before the Phase 1 migration didn't
      // populate snapshots. Fall back to the live template + preset read
      // (the pre-Phase-1 behavior). After all legacy sessions complete,
      // this branch can be removed.
      let template: Template | null = null;
      let preset: Preset | null = null;
      if (session.exam_template_id) {
        const { data: t, error: tErr } = await admin
          .from("exam_templates")
          .select("*")
          .eq("id", session.exam_template_id)
          .maybeSingle();
        if (tErr) throw new Error(`load-template: ${tErr.message}`);
        template = (t as Template | null) ?? null;
        if (template?.personality_preset_id) {
          const { data: p } = await admin
            .from("personality_presets")
            .select("*")
            .eq("id", template.personality_preset_id)
            .maybeSingle();
          preset = (p as Preset | null) ?? null;
        }
      } else if (session.personality_preset_id) {
        const { data: p, error: pErr } = await admin
          .from("personality_presets")
          .select("*")
          .eq("id", session.personality_preset_id)
          .maybeSingle();
        if (pErr) throw new Error(`load-preset: ${pErr.message}`);
        preset = (p as Preset | null) ?? null;
      }
      const evalPromptBody =
        template?.eval_prompt_body ?? preset?.eval_prompt_body ?? null;
      const rubricBody =
        template?.rubric_body ?? preset?.rubric_body ?? null;
      return { evalPromptBody, rubricBody, fromSnapshot: false };
    });

    const summaryPrompt = await step.run("load-summary-prompt", async () => {
      const { data, error } = await admin
        .from("prompts")
        .select("body")
        .eq("scope", "system")
        .eq("purpose", "student_summary")
        .maybeSingle();
      if (error) throw new Error(`load-summary-prompt: ${error.message}`);
      if (!data?.body) {
        throw new Error(
          "load-summary-prompt: no system/student_summary row in prompts table",
        );
      }
      return data.body;
    });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }
    const ai = new GoogleGenAI({ apiKey });

    // Eval pass — only runs if the agent has an eval_prompt_body. Ungraded
    // agents (Study Partner) skip evaluation entirely; the summary still
    // runs.
    const rawEval = await step.run("generate-eval", async () => {
      if (!agent.evalPromptBody?.trim()) {
        return null;
      }
      const systemInstruction = composeEvalSystem(
        agent.evalPromptBody,
        agent.rubricBody,
      );
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: systemInstruction + "\n\n" + transcriptText },
            ],
          },
        ],
      });
      const text = result.text ?? "";
      if (!text.trim()) {
        throw new Error("Gemini returned an empty eval");
      }
      return text;
    });

    const rawSummary = await step.run("generate-summary", async () => {
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: summaryPrompt + "\n\n" + transcriptText }],
          },
        ],
      });
      const text = result.text ?? "";
      if (!text.trim()) {
        throw new Error("Gemini returned an empty summary");
      }
      return text;
    });

    // Defense-in-depth scrub on the outputs. The transcript IN was
    // already scrubbed (Phase 0 enforces fail-closed at write time — a
    // transcript in the DB at all means it was scrubbed under a valid
    // roster), so Gemini only saw anon tokens. The defensive output scrub
    // catches the edge case where a paraphrasing model could re-emit a
    // name based on context.
    //
    // If the roster is missing at eval time (e.g., teacher rotated it
    // after the exam ended), proceed with the unscrubbed Gemini outputs
    // rather than retrying-then-failing the eval. The transcript-was-
    // scrubbed invariant means the outputs are derived from anon-only
    // text; the residual risk is the model hallucinating a real name,
    // which is far smaller than the cost of stranded evals.
    const scrubbed = await step.run("scrub-outputs", async () => {
      let roster;
      try {
        roster = await loadRosterForSession(admin, session.id);
      } catch (err) {
        if (err instanceof RosterMissingError) {
          logger.warn(
            `[evaluate-exam] roster_missing at output-scrub time session=${sessionId} reason=${err.reason} — proceeding without defensive scrub`,
          );
          return {
            eval_text: rawEval,
            student_summary: rawSummary,
          };
        }
        throw err;
      }
      return {
        eval_text: rawEval ? scrubText(rawEval, roster) : null,
        student_summary: scrubText(rawSummary, roster),
      };
    });

    await step.run("write-results", async () => {
      const { error } = await admin
        .from("exam_sessions")
        .update({
          eval_text: scrubbed.eval_text,
          student_summary: scrubbed.student_summary,
          eval_error: null, // clear any prior eval error on a successful retry
        } satisfies Partial<
          Database["public"]["Tables"]["exam_sessions"]["Update"]
        > as unknown as Json as never)
        .eq("id", sessionId);
      if (error) throw new Error(`write-results: ${error.message}`);
    });

    // M7.4 — auto-save to Drive after the eval + summary land.
    // Best-effort: a Drive failure (auth missing, quota, etc.) is
    // recorded but does NOT propagate to onFailure (which would clobber
    // the eval results just written above). Idempotent: skips when
    // exam_sessions.drive_doc_url is already populated.
    //
    // Mirrors HH M7.5's save-to-drive step in
    // `apps/web/src/lib/inngest/transcribe-discussion.ts`.
    //
    // Teacher resolution: exam_sessions has no direct teacher_id column.
    // Resolve via exam_template_bindings keyed by canvas_assignment_id
    // (matches post-session-comment.ts). This covers BOTH template-
    // backed and preset-direct sessions; an earlier draft of this step
    // joined exam_templates!inner(teacher_id) which silently skipped
    // preset-direct sessions (the 20260519131123 migration lets
    // exam_sessions point at a preset without going through a template).
    const driveOutcome = await step.run("save-to-drive", async () => {
      const { data: row, error: loadErr } = await admin
        .from("exam_sessions")
        .select(
          "id, student_id, audio_url, transcript, student_summary, eval_text, completed_at, created_at, canvas_assignment_id, drive_doc_url",
        )
        .eq("id", sessionId)
        .single();
      if (loadErr || !row) {
        return {
          ok: false,
          skipped: false,
          error: `load: ${loadErr?.message ?? "not found"}`,
        };
      }
      if (row.drive_doc_url) {
        return { ok: true, skipped: true, drive_doc_url: row.drive_doc_url };
      }
      const { data: binding, error: bindingErr } = await admin
        .from("exam_template_bindings")
        .select("teacher_id")
        .eq("canvas_assignment_id", row.canvas_assignment_id)
        .maybeSingle();
      if (bindingErr || !binding?.teacher_id) {
        return {
          ok: false,
          skipped: false,
          error: `binding lookup: ${bindingErr?.message ?? "no binding for assignment"}`,
        };
      }
      try {
        const refs = await saveExamSessionToDrive({
          id: row.id,
          teacher_id: binding.teacher_id,
          student_id: row.student_id,
          audio_url: row.audio_url,
          transcript: row.transcript as TranscriptEntry[] | null,
          student_summary: row.student_summary,
          eval_text: row.eval_text,
          completed_at: row.completed_at,
          created_at: row.created_at,
          canvas_assignment_id: row.canvas_assignment_id,
        });
        const { error: writeErr } = await admin
          .from("exam_sessions")
          .update({
            drive_doc_id: refs.doc.id,
            drive_doc_url: refs.doc.webViewLink,
            drive_audio_id: refs.audio?.id ?? null,
            drive_audio_url: refs.audio?.webViewLink ?? null,
          })
          .eq("id", sessionId);
        if (writeErr) throw new Error(`persist: ${writeErr.message}`);
        return {
          ok: true,
          skipped: false,
          drive_doc_url: refs.doc.webViewLink,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.info(`save-to-drive failed for ${sessionId}: ${message}`);
        return { ok: false, skipped: false, error: message };
      }
    });

    // M7.4 — post a draft Canvas comment on the student's submission
    // carrying the Drive link. Single-shot (one session = one student =
    // one comment); contrast with HH's per-class fan-out. Gated by the
    // teacher master switch AND the per-assignment override (both
    // checked inside postSessionDraftComment). Idempotent via
    // canvas_comment_posted_at sentinel. Best-effort.
    if (driveOutcome.ok && "drive_doc_url" in driveOutcome) {
      await step.run("post-canvas-comment", async () => {
        const { data: row, error: loadErr } = await admin
          .from("exam_sessions")
          .select("canvas_comment_posted_at")
          .eq("id", sessionId)
          .single();
        if (loadErr) {
          logger.info(
            `post-canvas-comment load failed for ${sessionId}: ${loadErr.message}`,
          );
          return;
        }
        if (row.canvas_comment_posted_at) return; // already done

        const outcome = await postSessionDraftComment({
          examSessionId: sessionId,
          driveDocUrl: driveOutcome.drive_doc_url,
        });

        if (outcome.kind === "skipped") {
          await admin
            .from("exam_sessions")
            .update({
              canvas_comment_post_status: "skipped",
              canvas_comment_posted_at: new Date().toISOString(),
              canvas_comment_error: outcome.reason.slice(0, 1000),
            })
            .eq("id", sessionId);
          return;
        }

        if (outcome.kind === "posted") {
          await admin
            .from("exam_sessions")
            .update({
              canvas_comment_post_status: "ok",
              canvas_comment_posted_at: new Date().toISOString(),
              canvas_comment_error: null,
            })
            .eq("id", sessionId);
          return;
        }

        // failed
        await admin
          .from("exam_sessions")
          .update({
            canvas_comment_post_status: "failed",
            canvas_comment_posted_at: new Date().toISOString(),
            canvas_comment_error: outcome.error.slice(0, 1000),
          })
          .eq("id", sessionId);
      });
    }

    logger.info(`[evaluate-exam] complete session=${sessionId}`);
    return { ok: true, driveOk: driveOutcome.ok };
  },
);

/**
 * Glue eval_prompt_body + rubric_body into a single system instruction.
 * Rubric stays optional — ungraded agents (Study Partner) ship with
 * rubric_body=null and the eval prompt body produces structured feedback
 * instead of scored output.
 */
function composeEvalSystem(
  evalPromptBody: string,
  rubricBody: string | null,
): string {
  if (!rubricBody?.trim()) return evalPromptBody.trim();
  return [
    evalPromptBody.trim(),
    "\n# RUBRIC\n",
    rubricBody.trim(),
  ].join("\n");
}

/**
 * Format the transcript entries as a "Examiner: …" / "Student: …" text
 * block. Matches the shape the per-agent eval prompts expect.
 */
function formatTranscriptForEval(entries: TranscriptEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const label = e.role === "model" ? "Examiner" : "Student";
    lines.push(`${label}: ${e.text}`);
  }
  return `# TRANSCRIPT\n\n${lines.join("\n\n")}`;
}
