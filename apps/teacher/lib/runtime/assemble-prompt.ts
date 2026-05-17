import type { SelectedQuestion } from "./select-questions";

export type AssemblePromptInput = {
  envelope_body: string;
  persona_body: string;
  flow_body: string;
  selected_questions: SelectedQuestion[];
  opening_text?: string | null;
  closing_text?: string | null;
  intake_pack?: string | null;
};

/**
 * Compose the runtime system prompt for an oral-examination agent.
 *
 * Layout (top → bottom):
 *   [safety envelope]              — admin-owned, system-wide universal rules
 *   [persona body]                 — character + persona-specific voice + boundaries
 *   [flow body]                    — examination structure + named follow-up types
 *   [intake context pack]          — per-session: Canvas description, student submission,
 *                                     attached PDFs, etc. (null for dry-run)
 *   [opening text]                 — optional override for the greeting
 *   [QUESTIONS TO ASK]             — server-picked, fixed order; agent reads as a list
 *   [closing text]                 — optional override for the wrap
 *
 * The agent never sees the rubric or the eval prompt — those are post-session.
 */
export function assembleSystemPrompt(input: AssemblePromptInput): string {
  const sections: string[] = [];

  sections.push("# SAFETY ENVELOPE (universal)");
  sections.push(input.envelope_body.trim());

  sections.push("# PERSONA");
  sections.push(input.persona_body.trim());

  sections.push("# EXAMINATION FLOW");
  sections.push(input.flow_body.trim());

  if (input.intake_pack && input.intake_pack.trim()) {
    sections.push("# INTAKE CONTEXT");
    sections.push(input.intake_pack.trim());
  }

  if (input.opening_text && input.opening_text.trim()) {
    sections.push(
      "# OPENING (your first words to the student — speak this verbatim, then continue with the examination flow):",
    );
    sections.push(input.opening_text.trim());
  }

  sections.push("# QUESTIONS TO ASK");
  if (input.selected_questions.length === 0) {
    sections.push("(No questions selected for this session.)");
  } else {
    sections.push(formatQuestionList(input.selected_questions));
  }

  if (input.closing_text && input.closing_text.trim()) {
    sections.push(
      "# CLOSING (your last words to the student — speak this verbatim when ending the session):",
    );
    sections.push(input.closing_text.trim());
  }

  return sections.join("\n\n");
}

function formatQuestionList(qs: SelectedQuestion[]): string {
  const lines: string[] = [];
  let lastBucket: string | null = null;
  let n = 1;
  for (const q of qs) {
    if (q.bucket_name !== lastBucket) {
      if (lastBucket !== null) lines.push("");
      lines.push(`## ${q.bucket_name}`);
      lastBucket = q.bucket_name;
    }
    lines.push(`${n}. ${q.text}`);
    if (q.reference_snippet) {
      lines.push(`   (reference: ${q.reference_snippet})`);
    }
    n++;
  }
  return lines.join("\n");
}
