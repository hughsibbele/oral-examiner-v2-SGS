// Extract text from a PDF for the intake-pack composer.
//
// Two-tier strategy:
// 1. Gemini's native PDF understanding (multimodal generateContent with
//    inlineData PDF) — better at scans, complex layout, mixed columns.
// 2. pdf-parse on the raw buffer — fast, free, works on most text PDFs.
//
// Gemini is tried first per the M2b.1f spec, with pdf-parse as the
// "doesn't ingest cleanly" fallback. Caller can flip the order via the
// `strategy` option when the use case is cost-sensitive and the PDFs are
// known-clean (e.g. teacher-uploaded rubrics).
//
// Returned text is plain — no markdown, no boilerplate framing — ready to
// drop into the runtime prompt's intake context block.

import { GoogleGenAI } from "@google/genai";

const EXTRACTION_INSTRUCTION =
  "Extract all readable text from this PDF verbatim. Preserve paragraph " +
  "breaks. Do not summarize, paraphrase, or omit text. Do not add headings, " +
  "bullets, commentary, or surrounding prose. Output ONLY the extracted text.";

const GEMINI_MODEL = process.env.GEMINI_PDF_MODEL ?? "gemini-2.5-flash";

// 20MB inline-data cap per Gemini docs — over this you'd need the Files API.
// Intake PDFs are typically <2MB so inline is the right path.
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export type ExtractionStrategy = "gemini-first" | "parse-first";

export type PdfExtractionResult = {
  text: string;
  source: "gemini" | "pdf-parse";
  warnings?: string[];
};

export type ExtractPdfTextOptions = {
  buffer: Buffer;
  /** Logging tag for diagnostics; doesn't influence extraction. */
  filename?: string;
  strategy?: ExtractionStrategy;
};

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    public attempts: Array<{ source: string; error: string }>,
  ) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

export async function extractPdfText({
  buffer,
  filename,
  strategy = "gemini-first",
}: ExtractPdfTextOptions): Promise<PdfExtractionResult> {
  if (buffer.byteLength === 0) {
    throw new PdfExtractionError("PDF buffer is empty.", []);
  }

  const order: Array<"gemini" | "pdf-parse"> =
    strategy === "gemini-first"
      ? ["gemini", "pdf-parse"]
      : ["pdf-parse", "gemini"];
  const attempts: Array<{ source: string; error: string }> = [];

  for (const source of order) {
    try {
      const text =
        source === "gemini"
          ? await extractViaGemini(buffer, filename)
          : await extractViaPdfParse(buffer);
      if (text.trim().length > 0) {
        return { text: text.trim(), source };
      }
      attempts.push({ source, error: "empty extraction" });
    } catch (err) {
      attempts.push({
        source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new PdfExtractionError(
    `Could not extract text from ${filename ?? "PDF"}.`,
    attempts,
  );
}

async function extractViaGemini(
  buffer: Buffer,
  filename?: string,
): Promise<string> {
  if (buffer.byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `PDF is ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, exceeds Gemini inline cap (20MB). Use Files API path.`,
    );
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: EXTRACTION_INSTRUCTION },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: buffer.toString("base64"),
            },
          },
        ],
      },
    ],
  });

  const text = response.text ?? "";
  if (text.length === 0) {
    throw new Error(`Gemini returned empty text for ${filename ?? "PDF"}.`);
  }
  return text;
}

async function extractViaPdfParse(buffer: Buffer): Promise<string> {
  // pdf-parse@2.x exports a class (PDFParse) — the original `pdfParse(buf)`
  // shape from 1.x is gone. Dynamic import keeps the pdfjs-dist dependency
  // out of the Next.js client-bundle graph.
  const { PDFParse } = await import("pdf-parse");
  // Copy into a Uint8Array because PDFParse takes ownership of the buffer it
  // receives (transfers it to the pdfjs worker), and we don't want callers'
  // buffers invalidated under them.
  const data = new Uint8Array(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {
      /* parser cleanup best-effort */
    });
  }
}

/**
 * Convenience wrapper for the Drive Picker flow: given a Drive file ID and an
 * authenticated googleapis OAuth client, download the file (PDF or Google
 * Doc — Docs get exported to PDF first) and return its extracted text.
 */
export async function extractPdfTextFromDrive(
  fileId: string,
  oauthClient: import("googleapis").Auth.OAuth2Client,
  options?: { mimeType?: string; strategy?: ExtractionStrategy },
): Promise<PdfExtractionResult> {
  const { google } = await import("googleapis");
  const drive = google.drive({ version: "v3", auth: oauthClient });

  // Decide whether to download as-is or export. Google Docs are
  // application/vnd.google-apps.document — need export to PDF.
  const isGoogleDoc =
    options?.mimeType === "application/vnd.google-apps.document";

  let buffer: Buffer;
  if (isGoogleDoc) {
    const res = await drive.files.export(
      { fileId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(res.data as ArrayBuffer);
  } else {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(res.data as ArrayBuffer);
  }

  return extractPdfText({
    buffer,
    filename: fileId,
    strategy: options?.strategy,
  });
}
