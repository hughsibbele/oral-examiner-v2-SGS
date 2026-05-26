import { buildExamCardBlock, type ExamCardText } from "@oral-examiner/canvas";

/**
 * What students see in Canvas. Built using the same `buildExamCardBlock`
 * helper the install path uses — single source of truth, no drift.
 *
 * Note: we strip the surrounding <!-- begin/end --> markers for the
 * preview so the rendered HTML stays clean. The markers are critical for
 * idempotent install detection on the real Canvas description but they
 * just clutter the preview.
 */
export function CardPreview({
  appBaseUrl,
  canvasAssignmentId,
  text,
}: {
  appBaseUrl: string;
  canvasAssignmentId: string;
  /** Optional effective card-text override (5b.9). When omitted, falls back
   *  to the package's DEFAULT_EXAM_CARD_TEXT — the per-assignment preview
   *  on the configure page passes the resolved per-teacher text. */
  text?: Partial<ExamCardText>;
}) {
  const raw = buildExamCardBlock({ appBaseUrl, canvasAssignmentId, text });
  // Drop the begin/end comment markers — they don't render visually but
  // muddy the preview's DOM.
  const html = raw
    .replace(/<!--\s*oral-examiner:card:begin[^>]*-->\s*/i, "")
    .replace(/\s*<!--\s*oral-examiner:card:end\s*-->/i, "");

  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-stone-500 mb-2">
        Preview — what students see in Canvas
      </div>
      <div
        // Inline styles inside the card already constrain layout; the
        // outer div just provides a max-width so the card doesn't span
        // the entire configure surface awkwardly.
        className="max-w-2xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
