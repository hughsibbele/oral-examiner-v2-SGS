// Canvas REST API client for OE v2.
//
// Phase 2 (current): host normalization, token verification, course + assignment
// list, assignment description PUT for the branded-card install.
// Phase 3: masquerade body POST, draft comment POST, draft → publish.

export {
  buildExamCardBlock,
  DEFAULT_EXAM_CARD_TEXT,
  findExamCardBlock,
  findExamCardMarkerBlock,
  hasExamCardBlock,
  hasExamCardMarkerBlock,
  removeExamCardBlock,
  replaceOrAppendExamCardBlock,
  type BuildExamCardArgs,
  type ExamCardMarkerMeta,
  type ExamCardText,
  type FoundExamCardBlock,
} from "./install";

export type CanvasConfig = {
  host: string;
  token: string;
};

export type CanvasUser = {
  id: number;
  name: string;
  short_name?: string;
  sortable_name?: string;
  email?: string | null;
  primary_email?: string;
  login_id?: string | null;
};

export type CanvasTerm = {
  id: number;
  name: string;
  start_at?: string | null;
  end_at?: string | null;
};

export type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
  workflow_state: string;
  start_at?: string | null;
  end_at?: string | null;
  term?: CanvasTerm;
};

export type CanvasAssignment = {
  id: number;
  course_id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  workflow_state: string;
  published?: boolean;
  has_submitted_submissions?: boolean;
};

export type CanvasEnrollmentUser = {
  id: number;
  name: string;
  sortable_name?: string;
  short_name?: string;
  email?: string | null;
  login_id?: string | null;
};

export type CanvasEnrollment = {
  id: number;
  user_id: number;
  course_id: number;
  course_section_id: number;
  enrollment_state: string;
  type: string;
  user?: CanvasEnrollmentUser;
};

export type CanvasSubmission = {
  id: number;
  user_id: number;
  assignment_id: number;
  workflow_state: string;
  submission_type?: string | null;
  body?: string | null;
  url?: string | null;
  submitted_at?: string | null;
};

export class CanvasError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

// =========================================================================
// Host + low-level fetch
// =========================================================================

export function normalizeHost(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/\/.*$/, "");
  if (!h) throw new CanvasError("Canvas host is empty.", 0);
  if (!/^[a-z0-9.-]+$/.test(h)) {
    throw new CanvasError(`Canvas host has invalid characters: ${input}`, 0);
  }
  return h;
}

async function canvasFetch(
  config: CanvasConfig,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `https://${config.host}/api/v1${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m && m[1]) return m[1];
  }
  return null;
}

async function paginate<T>(
  config: CanvasConfig,
  initialPath: string,
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = initialPath;
  while (url) {
    const res = await canvasFetch(config, url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new CanvasError(
        `Canvas ${url} returned ${res.status}.`,
        res.status,
        body,
      );
    }
    const page = (await res.json()) as T[];
    out.push(...page);
    url = parseNextLink(res.headers.get("Link"));
  }
  return out;
}

// =========================================================================
// Endpoints
// =========================================================================

export async function getSelf(config: CanvasConfig): Promise<CanvasUser> {
  const res = await canvasFetch(config, "/users/self");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new CanvasError(
        "Canvas rejected the token (401). Check that you copied the full token.",
        401,
        body,
      );
    }
    throw new CanvasError(
      `Canvas /users/self returned ${res.status}.`,
      res.status,
      body,
    );
  }
  return (await res.json()) as CanvasUser;
}

/**
 * Fetch all courses the authenticated user teaches. Includes term so we can
 * apply the active-term filter when building the course picker.
 */
export async function listTeachingCourses(
  config: CanvasConfig,
): Promise<CanvasCourse[]> {
  const path =
    "/courses?enrollment_type=teacher&per_page=100" +
    "&include[]=term" +
    "&state[]=available&state[]=completed";
  return paginate<CanvasCourse>(config, path);
}

/**
 * List published assignments for a course. OE v2 binds 1:1 to OD-role
 * assignments; the caller filters by title heuristics or explicit teacher
 * selection before persisting any exam_template.
 */
export async function listCourseAssignments(
  config: CanvasConfig,
  canvasCourseId: string | number,
): Promise<CanvasAssignment[]> {
  const path =
    `/courses/${canvasCourseId}/assignments?` +
    "include[]=submission_types&per_page=100";
  return paginate<CanvasAssignment>(config, path);
}

/**
 * Fetch a single assignment. Used during install/uninstall so we can read the
 * current `description` HTML, splice in the branded card marker block, and
 * PUT it back.
 */
export async function getAssignment(
  config: CanvasConfig,
  canvasCourseId: string | number,
  canvasAssignmentId: string | number,
): Promise<CanvasAssignment> {
  const path = `/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`;
  const res = await canvasFetch(config, path);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CanvasError(
      `Canvas GET assignment returned ${res.status}.`,
      res.status,
      body,
    );
  }
  return (await res.json()) as CanvasAssignment;
}

/**
 * PUT a new `description` HTML onto an assignment. Used by the install flow
 * after splicing the branded card into the existing HTML. Canvas accepts the
 * field as form-encoded `assignment[description]`.
 */
export async function updateAssignmentDescription(
  config: CanvasConfig,
  canvasCourseId: string | number,
  canvasAssignmentId: string | number,
  descriptionHtml: string,
): Promise<CanvasAssignment> {
  const path = `/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`;
  const body = new URLSearchParams();
  body.set("assignment[description]", descriptionHtml);
  const res = await canvasFetch(config, path, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CanvasError(
      `Canvas PUT assignment returned ${res.status}.`,
      res.status,
      text,
    );
  }
  return (await res.json()) as CanvasAssignment;
}

/**
 * Fetch a single student's submission for an assignment. Used at exam-start
 * time when the agent's intake config opts in to `use_canvas_submission`:
 * the auth-token route fetches this, drops `body` into the intake pack, and
 * Gemini sees the student's essay alongside the assignment description.
 *
 * `submission_type='online_text_entry'` is the case we care about — `body`
 * is the rendered HTML. For other types (file upload, url, none yet) `body`
 * will be empty/null and the caller no-ops gracefully.
 */
export async function getSubmission(
  config: CanvasConfig,
  canvasCourseId: string | number,
  canvasAssignmentId: string | number,
  canvasUserId: string | number,
): Promise<CanvasSubmission> {
  const path = `/courses/${canvasCourseId}/assignments/${canvasAssignmentId}/submissions/${canvasUserId}`;
  const res = await canvasFetch(config, path);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CanvasError(
      `Canvas GET submission returned ${res.status}.`,
      res.status,
      body,
    );
  }
  return (await res.json()) as CanvasSubmission;
}

/**
 * Active student enrollments for a course, with embedded user records. One
 * row per (user, section); a user enrolled in two sections appears twice.
 * Caller deduplicates by `user.id` when shaping the roster.
 */
export async function listCourseStudentEnrollments(
  config: CanvasConfig,
  canvasCourseId: string | number,
): Promise<CanvasEnrollment[]> {
  const path =
    `/courses/${canvasCourseId}/enrollments?` +
    "type[]=StudentEnrollment&state[]=active&include[]=user&per_page=100";
  return paginate<CanvasEnrollment>(config, path);
}

/**
 * Students in a course as user records (one row per user, already deduped by
 * Canvas — no section-fanout). Hits `/courses/:id/users` which exposes
 * `email` to teacher-scope tokens that the `/enrollments` embedded-user
 * field withholds. Discovered 2026-05-20: roster sync via /enrollments was
 * storing login_id strings (e.g. "jsmith23") in the email slot for 21/22
 * students because Canvas hid the email field on the enrollment-embedded
 * user; Google-OAuth sign-in then never matched. /users + `include[]=email`
 * is the path that surfaces real emails for most teacher tokens.
 */
export async function listCourseStudentUsers(
  config: CanvasConfig,
  canvasCourseId: string | number,
): Promise<CanvasUser[]> {
  const path =
    `/courses/${canvasCourseId}/users?` +
    "enrollment_type[]=student&enrollment_state[]=active&include[]=email&per_page=100";
  return paginate<CanvasUser>(config, path);
}
