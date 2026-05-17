// Intake configuration shape (admin-default on personality_presets;
// teacher-overridable on exam_templates).
//
// The jsonb column shape is identical at both levels — admins set defaults
// per-persona in /admin/agents; when teachers clone an agent into a
// per-Canvas-assignment exam_template, this shape lands on
// exam_templates.intake_config and the same UI surfaces against it.

import type { Json } from "@oral-examiner/db";

export type IntakeAttachmentKind = "drive" | "upload" | "paste";

export type IntakeAttachment = {
  /** uuid generated on add */
  id: string;
  kind: IntakeAttachmentKind;
  /** Display label + composes into the intake-pack heading */
  name: string;
  /** Cached extracted plain text (PDF → text on add, paste text as-is) */
  content: string;
  byte_size: number;
  /** Drive file id (kind='drive' only) */
  drive_file_id?: string;
  drive_mime_type?: string;
  created_at: string;
};

export type IntakeConfig = {
  /** Include the Canvas assignment description in the intake pack */
  use_canvas_description: boolean;
  /** Include the student's submission body in the intake pack */
  use_canvas_submission: boolean;
  attachments: IntakeAttachment[];
};

export const DEFAULT_INTAKE_CONFIG: IntakeConfig = {
  use_canvas_description: false,
  use_canvas_submission: false,
  attachments: [],
};

/**
 * Defensive parser for the jsonb column. Returns DEFAULT_INTAKE_CONFIG for
 * any shape that doesn't conform — protects the rendering UI from a corrupt
 * row dropping the whole agent block.
 */
export function parseIntakeConfig(raw: Json | null | undefined): IntakeConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_INTAKE_CONFIG;
  }
  const obj = raw as Record<string, Json | undefined>;
  const useDesc = obj.use_canvas_description === true;
  const useSub = obj.use_canvas_submission === true;
  const rawAtt = obj.attachments;
  const attachments: IntakeAttachment[] = [];
  if (Array.isArray(rawAtt)) {
    for (const a of rawAtt) {
      if (!a || typeof a !== "object" || Array.isArray(a)) continue;
      const att = a as Record<string, Json | undefined>;
      if (typeof att.id !== "string") continue;
      if (typeof att.name !== "string") continue;
      if (typeof att.content !== "string") continue;
      const kind = att.kind;
      if (kind !== "drive" && kind !== "upload" && kind !== "paste") continue;
      attachments.push({
        id: att.id,
        kind,
        name: att.name,
        content: att.content,
        byte_size:
          typeof att.byte_size === "number"
            ? att.byte_size
            : Buffer.byteLength(att.content, "utf8"),
        drive_file_id:
          typeof att.drive_file_id === "string" ? att.drive_file_id : undefined,
        drive_mime_type:
          typeof att.drive_mime_type === "string"
            ? att.drive_mime_type
            : undefined,
        created_at:
          typeof att.created_at === "string"
            ? att.created_at
            : new Date(0).toISOString(),
      });
    }
  }
  return {
    use_canvas_description: useDesc,
    use_canvas_submission: useSub,
    attachments,
  };
}

export type IntakeContext = {
  /** Canvas assignment.description — usually plain text or simple HTML */
  canvas_description?: string | null;
  /** Student's text-entry submission body, if any */
  canvas_submission_body?: string | null;
};

/**
 * Build the intake-pack string for the runtime prompt assembler. Returns
 * null when nothing would be included (no toggles, no attachments, no
 * matching context). The assembler wraps the returned string in a
 * `# INTAKE CONTEXT` heading, so sub-sections here use `##`.
 */
export function composeIntakePack(
  config: IntakeConfig,
  ctx: IntakeContext,
): string | null {
  const sections: string[] = [];

  if (config.use_canvas_description && ctx.canvas_description?.trim()) {
    sections.push("## Assignment description (from Canvas)");
    sections.push(ctx.canvas_description.trim());
  }
  if (config.use_canvas_submission && ctx.canvas_submission_body?.trim()) {
    sections.push("## Student's written submission");
    sections.push(ctx.canvas_submission_body.trim());
  }
  for (const att of config.attachments) {
    if (!att.content.trim()) continue;
    sections.push(`## Reference: ${att.name}`);
    sections.push(att.content.trim());
  }

  return sections.length === 0 ? null : sections.join("\n\n");
}
