"use client";

import { useRef, useState } from "react";
import { DrivePicker, type DriveFileRef } from "@/components/DrivePicker";
import {
  type ActionResult,
  addIntakeAttachmentFromDrive,
  addIntakeAttachmentFromPaste,
  addIntakeAttachmentFromUpload,
  removeIntakeAttachment,
  updateIntakeToggles,
} from "./actions";
import type { IntakeAttachment, IntakeConfig } from "@/lib/intake/types";

type Props = {
  ns: string;
  personaId: string;
  intakeConfig: IntakeConfig;
  capBytes: number;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
};

const ATTACHMENT_PDF_TYPES = [
  "application/pdf",
  "application/vnd.google-apps.document",
];

export function IntakeEditor({
  ns,
  personaId,
  intakeConfig,
  capBytes,
  run,
  tagStatus,
}: Props) {
  const [showPaste, setShowPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usedBytes = intakeConfig.attachments.reduce(
    (n, a) => n + (a.byte_size || 0),
    0,
  );
  const pctUsed = capBytes > 0 ? Math.min(100, (usedBytes / capBytes) * 100) : 0;
  const nearCap = pctUsed > 80;
  const atCap = usedBytes >= capBytes;

  function handleDrivePick(file: DriveFileRef) {
    run(`${ns}:intake-drive`, () =>
      addIntakeAttachmentFromDrive(personaId, {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      }),
    );
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("id", personaId);
    fd.set("file", file);
    run(`${ns}:intake-upload`, async () => {
      const result = await addIntakeAttachmentFromUpload(fd);
      // Reset the input so picking the same file twice re-fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
      return result;
    });
  }

  return (
    <section className="surface p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-lg">Intake</h3>
        <span className="muted text-xs">
          What the agent sees about the assignment before the student speaks
        </span>
      </div>

      {/* Answer-key warning — yellow + persistent, not dismissible by design */}
      <div className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-900">
        <strong>Don&apos;t attach answer keys.</strong> The agent is told
        everything in this section. If the student asks the agent something
        like &ldquo;what answer were you expecting?&rdquo;, a well-prompted
        model will refuse — but better safe: attach the assignment, the
        rubric criteria <em>by name</em>, and reference materials, never
        the exemplar response.
      </div>

      {/* Canvas toggles */}
      <form
        action={(fd) => run(`${ns}:intake-toggles`, () => updateIntakeToggles(fd))}
        className="space-y-3"
      >
        <input type="hidden" name="id" value={personaId} />
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="use_canvas_description"
              defaultChecked={intakeConfig.use_canvas_description}
              className="mt-0.5"
            />
            <div className="text-sm">
              <span className="font-medium">
                Use Canvas assignment description
              </span>
              <p className="muted text-xs mt-0.5">
                The agent reads the assignment&apos;s description before the
                exam — useful when the prompt itself is in Canvas (e.g.
                &ldquo;respond to question X about the readings&rdquo;).
              </p>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="use_canvas_submission"
              defaultChecked={intakeConfig.use_canvas_submission}
              className="mt-0.5"
            />
            <div className="text-sm">
              <span className="font-medium">
                Use student&apos;s submission body
              </span>
              <p className="muted text-xs mt-0.5">
                Include the student&apos;s text submission (essay, response,
                etc.) — required when the oral exam defends a piece of
                student writing.
              </p>
            </div>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn bg-maroon text-white px-3 py-1.5 text-sm"
          >
            Save toggles
          </button>
          <StatusInline status={tagStatus(`${ns}:intake-toggles`)} />
        </div>
      </form>

      {/* Attachments */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium">
            Reference materials
            {intakeConfig.attachments.length > 0 && (
              <span className="muted ml-2 text-xs">
                ({intakeConfig.attachments.length})
              </span>
            )}
          </h4>
          <span
            className={`text-xs whitespace-nowrap ${
              atCap
                ? "text-red-700 font-medium"
                : nearCap
                  ? "text-yellow-700"
                  : "muted"
            }`}
            title={`10MB per attachment cap on input; ${formatBytes(capBytes)} total cap across all attachments`}
          >
            {formatBytes(usedBytes)} / {formatBytes(capBytes)} used
          </span>
        </div>
        {/* Slim usage bar */}
        <div className="h-1 bg-rule/40 rounded overflow-hidden">
          <div
            className={
              atCap
                ? "h-full bg-red-600"
                : nearCap
                  ? "h-full bg-yellow-500"
                  : "h-full bg-maroon/60"
            }
            style={{ width: `${pctUsed}%` }}
          />
        </div>

        {intakeConfig.attachments.length === 0 ? (
          <p className="muted text-xs italic">No reference materials yet.</p>
        ) : (
          <ul className="border border-rule rounded divide-y divide-rule">
            {intakeConfig.attachments.map((att) => (
              <AttachmentRow
                key={att.id}
                ns={ns}
                personaId={personaId}
                attachment={att}
                run={run}
                tagStatus={tagStatus}
              />
            ))}
          </ul>
        )}

        {/* Add: Drive / Upload / Paste */}
        <div className="flex flex-wrap gap-2 pt-1">
          <DrivePicker
            onPick={handleDrivePick}
            mimeTypes={ATTACHMENT_PDF_TYPES}
            label="Pick from Drive"
            className="btn px-3 py-1.5 text-sm"
          />
          <label className="btn px-3 py-1.5 text-sm cursor-pointer">
            Upload PDF
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFilePick}
            />
          </label>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="btn px-3 py-1.5 text-sm"
          >
            {showPaste ? "Cancel paste" : "Paste text"}
          </button>
          <StatusInline status={tagStatus(`${ns}:intake-drive`)} />
          <StatusInline status={tagStatus(`${ns}:intake-upload`)} />
        </div>

        {showPaste && (
          <form
            action={(fd) =>
              run(`${ns}:intake-paste`, async () => {
                const r = await addIntakeAttachmentFromPaste(fd);
                if (r.ok) {
                  setShowPaste(false);
                }
                return r;
              })
            }
            className="space-y-2 border border-rule rounded p-3 bg-white"
          >
            <input type="hidden" name="id" value={personaId} />
            <input
              name="name"
              required
              placeholder="Snippet name (e.g. rubric criteria)"
              className="w-full border border-rule rounded px-3 py-2 text-sm"
            />
            <textarea
              name="content"
              required
              rows={6}
              placeholder="Paste reference text here…"
              className="w-full border border-rule rounded px-3 py-2 text-sm font-mono leading-snug"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn bg-maroon text-white px-3 py-1.5 text-sm"
              >
                Add snippet
              </button>
              <StatusInline status={tagStatus(`${ns}:intake-paste`)} />
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function AttachmentRow({
  ns,
  personaId,
  attachment,
  run,
  tagStatus,
}: {
  ns: string;
  personaId: string;
  attachment: IntakeAttachment;
  run: (tag: string, action: () => Promise<ActionResult>) => void;
  tagStatus: (tag: string) => string | null;
}) {
  const del = `${ns}:intake-rm:${attachment.id}`;
  const status = tagStatus(del);
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <KindIcon kind={attachment.kind} />
      <span className="flex-1 truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="muted text-xs whitespace-nowrap">
        {formatBytes(attachment.byte_size)}
      </span>
      <button
        type="button"
        title="Remove"
        className="btn px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        onClick={() => {
          if (!window.confirm(`Remove "${attachment.name}"?`)) return;
          run(del, () => {
            const fd = new FormData();
            fd.set("persona_id", personaId);
            fd.set("attachment_id", attachment.id);
            return removeIntakeAttachment(fd);
          });
        }}
      >
        ×
      </button>
      {status && status !== "saved" && status !== "saving" && (
        <span className="text-xs text-red-700">{status}</span>
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: IntakeAttachment["kind"] }) {
  // Unicode glyphs avoid pulling an icon library for one component.
  const map: Record<IntakeAttachment["kind"], string> = {
    drive: "🟦",
    upload: "📄",
    paste: "📋",
  };
  return (
    <span
      className="text-base shrink-0"
      title={kind === "drive" ? "Google Drive" : kind === "upload" ? "Uploaded PDF" : "Pasted text"}
    >
      {map[kind]}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function StatusInline({ status }: { status: string | null }) {
  if (!status || status === "saving") return null;
  if (status === "saved") return <span className="text-xs text-green-700">Saved.</span>;
  return <span className="text-xs text-red-700">Error: {status}</span>;
}
