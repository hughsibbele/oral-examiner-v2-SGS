import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-2.5-flash";

export type ChatMessage = {
  role: "user" | "model";
  text: string;
};

let cachedClient: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY missing. Set it in .env.local; remember the package.json dev/build/start scripts strip the shell-inherited GEMINI_API_KEY so the per-app value wins.",
    );
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

/**
 * Single-shot completion: send the system prompt + chat history, get the next
 * model reply as a string. No streaming (v1); the dry-run UI shows a single
 * "thinking" indicator and renders the full response when it lands.
 */
export async function geminiTextComplete(opts: {
  systemPrompt: string;
  messages: ChatMessage[];
  model?: string;
}): Promise<string> {
  const model = opts.model ?? DEFAULT_MODEL;
  const ai = client();

  // genai SDK contents shape: array of { role, parts: [{ text }] }
  const contents = opts.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: opts.systemPrompt,
    },
  });

  // genai v2 returns response with .text accessor
  const text = response.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}
