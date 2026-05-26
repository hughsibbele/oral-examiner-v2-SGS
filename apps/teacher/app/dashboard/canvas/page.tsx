import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import {
  loadCardTextDefaults,
  loadTeacherCardOverrides,
} from "@/lib/card-text/resolve";
import { CanvasTokenForm } from "./CanvasTokenForm";
import { CardTextEditor } from "./CardTextEditor";
import { CanvasCommentToggle } from "./CanvasCommentToggle";

function readAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

export default async function CanvasSetupPage() {
  const result = await getTeacher();
  const teacher = result?.teacher;
  const hasToken = !!teacher?.canvas_token_encrypted;
  const [cardDefaults, cardOverrides] = result
    ? await Promise.all([
        loadCardTextDefaults(),
        loadTeacherCardOverrides(result.teacher.id),
      ])
    : [null, null];

  const driveConnected = Boolean(
    teacher &&
      teacher.google_access_token_encrypted &&
      teacher.google_refresh_token_encrypted,
  );
  const driveFolderUrl = teacher?.drive_folder_id
    ? `https://drive.google.com/drive/folders/${teacher.drive_folder_id}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-stone-500 text-sm">
          ← Dashboard
        </Link>
        <h1 className="font-medium text-ink text-2xl mt-2">Setup</h1>
        <p className="text-stone-500 text-sm mt-1">
          OE v2 uses your Canvas API token to read courses and assignments,
          install the branded card on each assignment, and post oral-defense
          submissions on the student&apos;s behalf via{" "}
          <code>as_user_id</code> masquerade. Google Drive is per-teacher
          OAuth — every completed exam saves a Doc into your{" "}
          <strong>Oral Examiner</strong> folder (M7.4).
        </p>
      </div>

      {hasToken && (
        <div className="bg-white border border-stone-200 rounded p-4 text-sm">
          <span className="font-medium">✓ Canvas connected</span>
          <span className="text-stone-500 ml-2">
            Host: <code>{teacher.canvas_host}</code>. Token encrypted at rest.
          </span>
        </div>
      )}

      <CanvasTokenForm hasExisting={hasToken} initialHost={teacher?.canvas_host ?? ""} />

      {/* M7.2 — Google Drive section. Folder auto-created on first
          eval; manual reset/picker land with a future folder-picker
          milestone (M7.6 dropped the configurable-template approach
          2026-05-24 — see the move-the-folder copy below for the
          replacement workflow). */}
      <section className="bg-white border border-stone-200 rounded p-4 text-sm space-y-3">
        <h2 className="font-medium">Google Drive</h2>
        <p className="text-stone-500 text-xs">
          <strong>Want everything in a shared folder?</strong> Drag the{" "}
          <strong>Oral Examiner</strong> folder anywhere in your Drive —
          into a shared course folder, into a subfolder, or rename it.
          Future exam docs will keep landing in the same folder; the
          link stays valid. If you trash it, a fresh one is auto-created
          in your Drive root on the next exam (and you can move that one
          too).
        </p>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-xs">
          <dt className="text-stone-500">Status</dt>
          <dd>
            {driveConnected ? (
              <span>✓ Connected for {teacher?.display_name}</span>
            ) : (
              <span className="text-stone-500">
                Not connected — sign out and back in with Google to grant
                Drive scopes (drive.file + documents).
              </span>
            )}
          </dd>
          {driveConnected && (
            <>
              <dt className="text-stone-500">App folder</dt>
              <dd>
                {driveFolderUrl ? (
                  <a
                    href={driveFolderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    Open &ldquo;Oral Examiner&rdquo; in Drive ↗
                  </a>
                ) : (
                  <span className="text-stone-500 italic">
                    Auto-created on your first completed exam.
                  </span>
                )}
              </dd>
              {teacher?.google_token_expires_at && (
                <>
                  <dt className="text-stone-500">Access token expires</dt>
                  <dd>
                    {new Date(teacher.google_token_expires_at).toLocaleString()}{" "}
                    <span className="text-stone-500">
                      (auto-refreshed when within 5 min of expiry)
                    </span>
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        {!driveConnected && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed">
              Sign out to reconnect
            </button>
          </form>
        )}
      </section>

      {/* M7.2 — Canvas posting toggle. Master switch for OE's draft
          comment writes; per-assignment override stays on
          exam_template_bindings.post_to_canvas_comment. */}
      {teacher && (
        <section className="bg-white border border-stone-200 rounded p-4 text-sm space-y-3">
          <h2 className="font-medium">Canvas posting</h2>
          <p className="text-stone-500 text-xs">
            When an exam finishes evaluating, OE can post a draft comment
            on the student&rsquo;s Canvas submission carrying the Drive
            doc link. Drafts are only visible to you in SpeedGrader until
            you publish them. Per-assignment overrides live on each
            template binding.
          </p>
          <CanvasCommentToggle
            initialEnabled={teacher.canvas_comment_enabled}
          />
        </section>
      )}

      {cardDefaults && cardOverrides && (
        <CardTextEditor
          defaults={cardDefaults}
          overrides={cardOverrides}
          appBaseUrl={readAppBaseUrl()}
          previewAssignmentId="preview-1234"
        />
      )}

      <section className="bg-white border border-stone-200 rounded p-4 text-sm space-y-2">
        <h2 className="font-medium">How to get a Canvas API token</h2>
        <ol className="list-decimal list-inside space-y-1 text-stone-500">
          <li>Open Canvas → Account → Settings.</li>
          <li>Scroll to <span className="font-medium">Approved Integrations</span>.</li>
          <li>Click <span className="font-medium">+ New Access Token</span>.</li>
          <li>
            Purpose: <code>OE v2</code>. Leave expiration blank.
          </li>
          <li>Copy the token immediately — Canvas only shows it once.</li>
        </ol>
        <p className="text-stone-500">
          Token is encrypted at rest with AES-256-GCM. You can rotate any time by
          generating a new token in Canvas and pasting it here.
        </p>
      </section>
    </div>
  );
}
