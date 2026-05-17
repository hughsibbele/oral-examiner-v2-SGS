import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { geminiTextComplete, type ChatMessage } from "@/lib/runtime/gemini-text";

export const runtime = "nodejs";

type Body = {
  systemPrompt: string;
  messages: ChatMessage[];
};

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.systemPrompt !== "string" || body.systemPrompt.length === 0) {
    return NextResponse.json({ error: "Missing systemPrompt." }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Missing messages array." }, { status: 400 });
  }

  try {
    const text = await geminiTextComplete({
      systemPrompt: body.systemPrompt,
      messages: body.messages,
    });
    return NextResponse.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gemini request failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
