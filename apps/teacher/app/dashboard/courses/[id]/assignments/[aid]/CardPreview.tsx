import { buildExamCardBlock } from "@oral-examiner/canvas";

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
}: {
  appBaseUrl: string;
  canvasAssignmentId: string;
}) {
  const raw = buildExamCardBlock({ appBaseUrl, canvasAssignmentId });
  // Drop the begin/end comment markers — they don't render visually but
  // muddy the preview's DOM.
  const html = raw
    .replace(/<!--\s*oral-examiner:card:begin[^>]*-->\s*/i, "")
    .replace(/\s*<!--\s*oral-examiner:card:end\s*-->/i, "");

  return (
    <div className="rounded border border-rule bg-paper p-3">
      <div className="text-[10px] uppercase tracking-wide muted mb-2">
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
