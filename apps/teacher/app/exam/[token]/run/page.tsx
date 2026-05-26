import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveExamContext, type ResolvedAgent } from "@/lib/exam/resolve";
import {
  findActivePriorSession,
  isStaleLiveSession,
  refundAndArchiveSession,
} from "@/lib/exam/session";
import { StudentLiveSession } from "./StudentLiveSession";

/**
 * M2b.5d.2 — student live voice exam page. Server component validates
 * everything, then hands off to the StudentLiveSession client.
 *
 * State routing:
 *   - no auth          → /login
 *   - no resolution    → /exam/<aid> (re-renders the appropriate error screen)
 *   - no prior session → /exam/<aid> (ready screen — student hasn't clicked Start)
 *   - completed/failed → /exam/<aid> (block screen)
 *   - in_progress      → "session disconnected" (Live API can't resume context)
 *   - started          → render the live session
 */
export default async function ExamRunPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: canvasAssignmentId } = await params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    redirect(`/login?next=/exam/${canvasAssignmentId}/run`);
  }

  const resolution = await resolveExamContext({
    canvasAssignmentId,
    studentEmail: user.email,
    studentAuthUserId: user.id,
  });
  if (resolution.kind !== "ok") {
    redirect(`/exam/${canvasAssignmentId}`);
  }

  const prior = await findActivePriorSession({
    canvasAssignmentId,
    studentId: resolution.student.id,
  });
  if (!prior) {
    redirect(`/exam/${canvasAssignmentId}`);
  }
  if (prior.state === "completed" || prior.state === "failed") {
    redirect(`/exam/${canvasAssignmentId}`);
  }
  // REMEDIATION_PLAN Phase 3: a stale started/in_progress row gets
  // archived + refunded here too, then bounce back to the ready screen
  // so the student can start fresh. The page handler at /exam/[id] does
  // the same check; this is belt-and-braces for direct /run hits.
  if (isStaleLiveSession(prior)) {
    await refundAndArchiveSession(prior.id, "abandoned_resume");
    redirect(`/exam/${canvasAssignmentId}`);
  }
  if (prior.state === "in_progress") {
    return <DisconnectedScreen />;
  }

  // state === 'started' — the page handler at /exam/<aid> inserted the
  // row, redirected here, and the client is about to mint an ephemeral
  // token + connect.

  const agentName = nameForAgent(resolution.agent);

  return (
    <>
      <BrandHeader title="Oral Examiner" />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        <StudentLiveSession
          examSessionId={prior.id}
          agentName={agentName}
        />
      </main>
    </>
  );
}

function nameForAgent(agent: ResolvedAgent): string {
  if (agent.kind === "preset") return agent.preset.name;
  return agent.template.name || agent.preset?.name || "your examiner";
}

function DisconnectedScreen() {
  return (
    <>
      <BrandHeader title="Oral Examiner" />
      <main className="max-w-2xl mx-auto px-6 py-12 space-y-3">
        <h1 className="font-medium text-ink text-2xl">Session disconnected</h1>
        <p className="text-sm leading-relaxed">
          It looks like you started your exam and got disconnected — maybe a
          lost connection or a closed tab. The conversation can&apos;t pick
          up from where it left off, so this attempt is stuck.
        </p>
        <p className="text-sm leading-relaxed">
          Email your teacher and ask them to reset your session — they can
          do that from their dashboard. Once they have, this link will let
          you start fresh.
        </p>
      </main>
    </>
  );
}
