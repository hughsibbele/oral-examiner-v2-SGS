"use server";

import { GoogleGenAI } from "@google/genai";
import { getTeacher } from "@/lib/auth/teacher";

const GEMINI_MODEL = process.env.GEMINI_EVAL_MODEL ?? "gemini-2.5-flash";

export type EvalPreviewResult =
  | { ok: true; evalText: string | null; studentSummary: string }
  | { ok: false; error: string };

export async function generateEvalPreview(input: {
  transcript: { role: "user" | "model"; text: string }[];
  evalPromptBody: string | null;
  rubricBody: string | null;
  summaryPromptBody: string;
}): Promise<EvalPreviewResult> {
  const auth = await getTeacher();
  if (!auth) return { ok: false, error: "Not signed in." };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not configured." };

  const transcriptText = input.transcript
    .map((e) => `${e.role === "model" ? "Examiner" : "Student"}: ${e.text}`)
    .join("\n\n");

  if (!transcriptText.trim()) {
    return { ok: false, error: "Empty transcript." };
  }

  const ai = new GoogleGenAI({ apiKey });

  let evalText: string | null = null;
  if (input.evalPromptBody?.trim()) {
    const systemInstruction = input.rubricBody?.trim()
      ? `${input.evalPromptBody.trim()}\n\n# RUBRIC\n\n${input.rubricBody.trim()}`
      : input.evalPromptBody.trim();
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\n# TRANSCRIPT\n\n${transcriptText}` }],
        },
      ],
    });
    evalText = result.text ?? null;
  }

  const summaryResult = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${input.summaryPromptBody}\n\n# TRANSCRIPT\n\n${transcriptText}` }],
      },
    ],
  });
  const studentSummary = summaryResult.text ?? "";

  return { ok: true, evalText, studentSummary };
}
