// Marker-block helpers for the OE branded-card install.
//
// The teacher's Canvas assignment description is HTML they own. We embed our
// oral-exam card inside a pair of HTML comment markers so we can find,
// replace, and remove our block without disturbing anything else they wrote:
//
//   <!-- oral-examiner:card:begin v=1 assignment-id=12345 -->
//   <div style="border:..."> ... EHS card ... </div>
//   <!-- oral-examiner:card:end -->
//
// Operations are pure (no I/O) so they can be unit-tested in isolation. The
// network-touching install flow (read description → patch → PUT) lives in
// the teacher app server actions.

const BEGIN_RE =
  /<!--\s*oral-examiner:card:begin(\s+[^>]*?)?\s*-->/i;
const END_RE = /<!--\s*oral-examiner:card:end\s*-->/i;

export type ExamCardMarkerMeta = {
  assignmentId: string | null;
  schemaVersion: number | null;
};

export type FoundExamCardBlock = ExamCardMarkerMeta & {
  start: number;
  end: number;
  raw: string;
};

/**
 * Plain-text strings teachers (or admins) can override per-teacher. The
 * structure of the card (logo, colors, padding, layout) is fixed; only
 * the words change. Each field is plain text — we HTML-escape on insert,
 * so curly quotes and unicode characters pass through but tags do not.
 */
export type ExamCardText = {
  /** Small ALL-CAPS line above the title. */
  kicker: string;
  /** h3 title under the kicker. */
  title: string;
  /** Paragraph body between title and CTA. */
  body: string;
  /** Button label. */
  ctaLabel: string;
  /** Italic line beneath the CTA. */
  footnote: string;
};

/** Suite-default copy. Falls back here if no admin/teacher overrides are
 *  provided. Kept in this file so the package has zero runtime dependency
 *  on Supabase. */
export const DEFAULT_EXAM_CARD_TEXT: ExamCardText = {
  kicker: "Oral Defense · Required for credit",
  title: "Defend this assignment in a brief oral exam",
  body: "You’ll have a short spoken conversation with an AI examiner about your work. Find a quiet room with a working microphone; the exam takes about 10–15 minutes and submits to Canvas automatically when you’re done.",
  ctaLabel: "Start oral exam →",
  footnote: "Sign in with your @episcopalhighschool.org Google account.",
};

export type BuildExamCardArgs = {
  /**
   * App origin where the OE student flow lives. The CTA links to
   * `${appBaseUrl}/exam/${canvasAssignmentId}`.
   */
  appBaseUrl: string;
  /** Canvas assignment id — also used as the URL slug into /exam/[token]. */
  canvasAssignmentId: string;
  /**
   * Optional plain-text overrides. Resolver typically reads
   * teacher_overrides ?? card_text_defaults and passes the effective
   * shape here. Falls back to DEFAULT_EXAM_CARD_TEXT field-by-field.
   */
  text?: Partial<ExamCardText>;
};

const SCHEMA_VERSION = 1;

/**
 * Render the marker-wrapped EHS oral-exam card. Pure string concat. Output
 * goes into a Canvas assignment description, which is sanitized HTML — we
 * rely only on tags + inline styles Canvas's RCE permits: `div`, `h3`, `p`,
 * `a`, and inline `style` attrs. No classes, no data attrs, no JS.
 */
export function buildExamCardBlock(args: BuildExamCardArgs): string {
  const base = args.appBaseUrl.replace(/\/$/, "");
  if (!base) {
    throw new Error("buildExamCardBlock: appBaseUrl is required");
  }
  const assignmentId = escapeMarkerAttr(args.canvasAssignmentId);
  const examUrl = escapeHtmlAttr(`${base}/exam/${assignmentId}`);
  const logoUrl = escapeHtmlAttr(`${base}/brand/ehs-horizontal.webp`);
  const text: ExamCardText = {
    kicker: args.text?.kicker ?? DEFAULT_EXAM_CARD_TEXT.kicker,
    title: args.text?.title ?? DEFAULT_EXAM_CARD_TEXT.title,
    body: args.text?.body ?? DEFAULT_EXAM_CARD_TEXT.body,
    ctaLabel: args.text?.ctaLabel ?? DEFAULT_EXAM_CARD_TEXT.ctaLabel,
    footnote: args.text?.footnote ?? DEFAULT_EXAM_CARD_TEXT.footnote,
  };
  return [
    `<!-- oral-examiner:card:begin v=${SCHEMA_VERSION} assignment-id=${assignmentId} -->`,
    `<div style="border:2px solid #7a1e46;border-radius:4px;padding:28px;margin:16px 0;background:#ffffff;font-family:Georgia,'Times New Roman',serif;">`,
    `<img src="${logoUrl}" alt="Episcopal High School" style="display:block;height:50px;width:auto;margin-bottom:18px;" />`,
    `<div style="color:#54565b;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${escapeHtmlText(text.kicker)}</div>`,
    `<h3 style="margin:0 0 10px 0;color:#1a1a1a;font-size:20px;font-weight:normal;line-height:1.3;">${escapeHtmlText(text.title)}</h3>`,
    `<p style="margin:0 0 22px 0;color:#333;font-size:15px;line-height:1.6;">${escapeHtmlText(text.body)}</p>`,
    `<a href="${examUrl}" style="display:inline-block;padding:12px 26px;background:#7a1e46;color:#ffffff;border-radius:3px;text-decoration:none;font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:15px;letter-spacing:0.3px;">${escapeHtmlText(text.ctaLabel)}</a>`,
    `<p style="margin:14px 0 0 0;color:#54565b;font-size:12px;font-style:italic;">${escapeHtmlText(text.footnote)}</p>`,
    `</div>`,
    `<!-- oral-examiner:card:end -->`,
  ].join("\n");
}

/**
 * Locate the first marker block in `html`. Returns null if absent. Orphan
 * begin markers (no matching end) are treated as "not present" so a
 * subsequent install repairs them.
 */
export function findExamCardMarkerBlock(html: string): FoundExamCardBlock | null {
  const beginMatch = BEGIN_RE.exec(html);
  if (!beginMatch) return null;
  const beginStart = beginMatch.index;
  const beginEnd = beginStart + beginMatch[0].length;

  const tail = html.slice(beginEnd);
  const endMatch = END_RE.exec(tail);
  if (!endMatch) return null;

  const end = beginEnd + endMatch.index + endMatch[0].length;
  const raw = html.slice(beginStart, end);
  const meta = parseBeginAttrs(beginMatch[1] ?? "");
  return { ...meta, start: beginStart, end, raw };
}

export function hasExamCardMarkerBlock(html: string): boolean {
  return findExamCardMarkerBlock(html) !== null;
}

/**
 * "Is the card installed?" detector that handles Canvas's HTML sanitizer
 * dropping our `<!-- ... -->` markers. Tries the marker block first; if
 * absent, falls back to finding a bare card by the /exam/<id> anchor.
 *
 * Use this instead of `hasExamCardMarkerBlock` in any UI surface that
 * reflects install state — Canvas strips comments on edit paths, so the
 * marker-only check returns false even when the card is live in Canvas.
 */
export function hasExamCardBlock(
  html: string,
  canvasAssignmentId?: string,
): boolean {
  return findExamCardBlock(html, canvasAssignmentId) !== null;
}

/**
 * Locate our block via comment markers first, then by token-based fallback
 * for the (rare) case where Canvas's sanitizer stripped the comments. With
 * canvasAssignmentId, we'll also find a bare card whose CTA points at
 * /exam/<id>.
 */
export function findExamCardBlock(
  html: string,
  canvasAssignmentId?: string,
): FoundExamCardBlock | null {
  const marker = findExamCardMarkerBlock(html);
  if (marker) return marker;
  if (!canvasAssignmentId) return null;
  return findCardBlockByAssignmentId(html, canvasAssignmentId);
}

/**
 * Strip every block we own from the description: marker-wrapped blocks AND
 * (with canvasAssignmentId) bare cards by token. Converges on "exactly zero
 * of our blocks" so past duplicates clean themselves up on the next install.
 */
function stripAllBlocks(html: string, canvasAssignmentId?: string): string {
  let out = html ?? "";
  const drain = (find: () => FoundExamCardBlock | null) => {
    while (true) {
      const m = find();
      if (!m) break;
      const before = out.slice(0, m.start).replace(/\s+$/, "");
      const after = out.slice(m.end).replace(/^\s+/, "");
      if (before === "") out = after;
      else if (after === "") out = before;
      else out = before + "\n\n" + after;
    }
  };
  drain(() => findExamCardMarkerBlock(out));
  if (canvasAssignmentId) {
    drain(() => findCardBlockByAssignmentId(out, canvasAssignmentId));
  }
  return out;
}

/**
 * Insert the block, ensuring exactly one of our blocks ends up in the
 * description. Strips any pre-existing block (marker-wrapped, card-by-token,
 * or duplicates) before inserting fresh.
 */
export function replaceOrAppendExamCardBlock(
  existingHtml: string,
  newBlockHtml: string,
  canvasAssignmentId?: string,
): string {
  const stripped = stripAllBlocks(existingHtml ?? "", canvasAssignmentId);
  const trimmed = stripped.replace(/\s+$/, "").replace(/^\s+/, "");
  if (trimmed === "") return newBlockHtml;
  return trimmed + "\n\n" + newBlockHtml;
}

/**
 * Strip every block we own from the description (and tidy surrounding
 * whitespace). With canvasAssignmentId, also catches comment-stripped cards.
 * No-op when nothing is found.
 */
export function removeExamCardBlock(
  existingHtml: string,
  canvasAssignmentId?: string,
): string {
  const stripped = stripAllBlocks(existingHtml ?? "", canvasAssignmentId);
  if (stripped === (existingHtml ?? "")) return existingHtml ?? "";
  return stripped.replace(/\s+$/, "").replace(/^\s+/, "");
}

// ---------------------------------------------------------------------------
// Comment-stripped fallback. Canvas's sanitizer drops HTML comments on some
// edit paths; the inner block survives but loses its begin/end markers.

function findCardBlockByAssignmentId(
  html: string,
  canvasAssignmentId: string,
): FoundExamCardBlock | null {
  const safe = canvasAssignmentId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) return null;

  // Anchor whose href contains "/exam/<id>". The full <a>...</a> is the
  // locator; we then walk outward to find the enclosing div wrapper.
  const hrefRe = new RegExp(
    `<a\\b[^>]*\\bhref="[^"]*\\/exam\\/${safe}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/a\\s*>`,
    "i",
  );
  const aMatch = hrefRe.exec(html);
  if (!aMatch) return null;
  const aStart = aMatch.index;
  const aEnd = aStart + aMatch[0].length;

  const beforeA = html.slice(0, aStart);
  const opens: Array<{ index: number; end: number }> = [];
  const openTagRe = /<div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(beforeA)) !== null) {
    opens.push({ index: m.index, end: m.index + m[0].length });
  }
  if (opens.length === 0) return null;

  // Try INNERMOST first (last in opens). The first wrapper whose close lands
  // after the anchor is our card div.
  for (let i = opens.length - 1; i >= 0; i--) {
    const open = opens[i];
    if (!open) continue;
    const closeEnd = findMatchingDivClose(html, open.end);
    if (closeEnd < 0) continue;
    if (closeEnd >= aEnd) {
      return {
        assignmentId: safe,
        schemaVersion: null,
        start: open.index,
        end: closeEnd,
        raw: html.slice(open.index, closeEnd),
      };
    }
  }
  return null;
}

function findMatchingDivClose(html: string, fromPos: number): number {
  let pos = fromPos;
  let depth = 1;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  while (depth > 0) {
    tagRe.lastIndex = pos;
    const m = tagRe.exec(html);
    if (!m) return -1;
    pos = m.index + m[0].length;
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return pos;
    } else {
      depth++;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------

function parseBeginAttrs(attrText: string): ExamCardMarkerMeta {
  const meta: ExamCardMarkerMeta = {
    assignmentId: null,
    schemaVersion: null,
  };
  const ATTR_RE = /([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|([^\s]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrText)) !== null) {
    const key = m[1]?.toLowerCase();
    const value = m[3] ?? m[4] ?? "";
    if (key === "assignment-id") meta.assignmentId = value;
    else if (key === "v") {
      const n = Number(value);
      meta.schemaVersion = Number.isFinite(n) ? n : null;
    }
  }
  return meta;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape plain text for HTML body content. Strips tags via escape, so
 *  teacher-pasted text like `<script>` lands as literal characters. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkerAttr(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error(
      `assignment-id must match /^[A-Za-z0-9_-]+$/. Got: ${JSON.stringify(s)}`,
    );
  }
  return s;
}
