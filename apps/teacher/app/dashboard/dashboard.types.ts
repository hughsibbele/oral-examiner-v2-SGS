/**
 * Dashboard accordion types — ported from AI Documenter with OE-specific
 * adjustments (no bulk install, per-row "Customize agent" link, exam
 * template + override-count surfacing).
 */

export type CoursePayload = {
  id: number;
  name: string;
  course_code?: string | null;
  workflow_state: string;
  term?: { id: number; name: string };
};

export type AssignmentPayload = {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  workflow_state?: string;
};

export type CourseRowDB = {
  canvas_course_id: string;
  payload: CoursePayload;
  last_synced_at: string;
  short_name: string | null;
};

export type AssignmentRowDB = {
  canvas_assignment_id: string;
  canvas_course_id: string;
  payload: AssignmentPayload;
  last_synced_at: string;
};

/**
 * Per-assignment binding summary. A binding points at EITHER:
 *   - the system default agent template (`kind: "preset"`), or
 *   - the teacher's custom agent template (`kind: "template"`).
 * UI uses `kind` to route "Manage agent →" and to label "Using default X"
 * vs "Custom: …".
 */
export type AgentBindingSummary =
  | {
      kind: "preset";
      preset_id: string;
      preset_name: string;
      exam_token: string;
    }
  | {
      kind: "template";
      template_id: string;
      template_name: string;
      preset_name: string | null;
      override_count: number;
      exam_token: string;
    };

/** M6.18c: 3-checkbox destination state stored on the binding row.
 *  Null when no binding exists yet (no card installed). */
export type DestinationState = {
  drive: boolean;
  comment: boolean;
  submission: boolean;
};

export type AssignmentWithStatus = AssignmentPayload & {
  canvas_assignment_id: string;
  canvas_course_id: string;
  /** Computed from cached description body via canvas/install marker check. */
  cardInstalled: boolean;
  /** Which agent template (default preset OR custom template) is bound. */
  binding: AgentBindingSummary | null;
  /** Persisted destination triple from the binding row. Falls back to
   *  M6.18c defaults (Drive ✓ + comment ✓ + submission ✗) when no
   *  binding exists. */
  destination: DestinationState;
};

export type RosterSummary = {
  studentCount: number;
  lastSyncedAt: string | null;
};

export type CourseGroup = {
  course: CoursePayload & { canvas_course_id: string; short_name?: string | null };
  assignments: AssignmentWithStatus[];
  installedCount: number;
  /** Bindings (preset or template) — used for "N configured" badge. */
  boundCount: number;
  roster: RosterSummary;
};

/** Picker rows shown in the install-with-agent dialog. */
export type DefaultAgentOption = {
  id: string;
  name: string;
  description: string | null;
};
export type TeacherTemplateOption = {
  id: string;
  name: string;
  presetName: string | null;
};
