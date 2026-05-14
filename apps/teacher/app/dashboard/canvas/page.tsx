import Link from "next/link";
import { getTeacher } from "@/lib/auth/teacher";
import { CanvasTokenForm } from "./CanvasTokenForm";

export default async function CanvasSetupPage() {
  const result = await getTeacher();
  const teacher = result?.teacher;
  const hasToken = !!teacher?.canvas_token_encrypted;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="muted text-sm">
          ← Dashboard
        </Link>
        <h1 className="heading text-2xl mt-2">Canvas connection</h1>
        <p className="muted text-sm mt-1">
          OE v2 uses your Canvas API token to read courses and assignments, install
          the branded reflection card, and (in Phase 3) post oral-defense
          submissions on the student&apos;s behalf via{" "}
          <code>as_user_id</code> masquerade.
        </p>
      </div>

      {hasToken && (
        <div className="surface p-4 text-sm">
          <span className="font-medium">✓ Connected</span>
          <span className="muted ml-2">
            Host: <code>{teacher.canvas_host}</code>. Token encrypted at rest.
          </span>
        </div>
      )}

      <CanvasTokenForm hasExisting={hasToken} initialHost={teacher?.canvas_host ?? ""} />

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
