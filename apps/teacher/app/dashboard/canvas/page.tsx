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

  // M7.2 — Drive connection status. OE's tokens land encrypted (M7.1);
  // legacy plaintext columns still readable until backfill completes.
  // Either shape indicates a connection.
  const driveConnected = Boolean(
    teacher &&
      (teacher.google_access_token_encrypted ?? teacher.google_access_token) &&
      (teacher.google_refresh_token_encrypted ?? teacher.google_refresh_token),
  );
  const driveFolderUrl = teacher?.drive_folder_id
    ? `https://drive.google.com/drive/folders/${teacher.drive_folder_id}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="muted text-sm">
          ← Dashboard
        </Link>
        <h1 className="heading text-2xl mt-2">Canvas &amp; Drive setup</h1>
        <p className="muted text-sm mt-1">
          OE v2 uses your Canvas API token to read courses and assignments,
          install the branded card on each assignment, and post oral-defense
          submissions on the student&apos;s behalf via{" "}
          <code>as_user_id</code> masquerade. Google Drive is per-teacher
          OAuth — every completed exam saves a Doc into your{" "}
          <strong>Oral Examiner</strong> folder (M7.4).
        </p>
      </div>

      {hasToken && (
        <div className="surface p-4 text-sm">
          <span className="font-medium">✓ Canvas connected</span>
          <span className="muted ml-2">
            Host: <code>{teacher.canvas_host}</code>. Token encrypted at rest.
          </span>
        </div>
      )}

      <CanvasTokenForm hasExisting={hasToken} initialHost={teacher?.canvas_host ?? ""} />

      {/* M7.2 — Google Drive section. Folder auto-created on first
          eval; manual reset/picker land with M7.6 (HAH-specific) and
          a future general folder-picker. */}
      <section className="surface p-4 text-sm space-y-3">
        <h2 className="font-medium">Google Drive</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-xs">
          <dt className="muted">Status</dt>
          <dd>
            {driveConnected ? (
              <span>✓ Connected for {teacher?.display_name}</span>
            ) : (
              <span className="muted">
                Not connected — sign out and back in with Google to grant
                Drive scopes (drive.file + documents).
              </span>
            )}
          </dd>
          {driveConnected && (
            <>
              <dt className="muted">App folder</dt>
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
                  <span className="muted italic">
                    Auto-created on your first completed exam.
                  </span>
                )}
              </dd>
              {teacher?.google_token_expires_at && (
                <>
                  <dt className="muted">Access token expires</dt>
                  <dd>
                    {new Date(teacher.google_token_expires_at).toLocaleString()}{" "}
                    <span className="muted">
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
            <button type="submit" className="btn">
              Sign out to reconnect
            </button>
          </form>
        )}
      </section>

      {/* M7.2 — Canvas posting toggle. Master switch for OE's draft
          comment writes; per-assignment override stays on
          exam_template_bindings.post_to_canvas_comment. */}
      {teacher && (
        <section className="surface p-4 text-sm space-y-3">
          <h2 className="font-medium">Canvas posting</h2>
          <p className="muted text-xs">
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

      <section className="surface p-4 text-sm space-y-2">
        <h2 className="font-medium">How to get a Canvas API token</h2>
        <ol className="list-decimal list-inside space-y-1 muted">
          <li>Open Canvas → Account → Settings.</li>
          <li>Scroll to <span className="font-medium">Approved Integrations</span>.</li>
          <li>Click <span className="font-medium">+ New Access Token</span>.</li>
          <li>
            Purpose: <code>OE v2</code>. Leave expiration blank.
          </li>
          <li>Copy the token immediately — Canvas only shows it once.</li>
        </ol>
        <p className="muted">
          Token is encrypted at rest with AES-256-GCM. You can rotate any time by
          generating a new token in Canvas and pasting it here.
        </p>
      </section>
    </div>
  );
}
