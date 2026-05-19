import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveExamContext } from "@/lib/exam/resolve";
import { findActivePriorSession } from "@/lib/exam/session";

/**
 * M2b.5d placeholder — the live-voice screen. For now: re-checks auth +
 * session existence, then renders a "coming soon" stub so the redirect
 * from startExam lands somewhere coherent.
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
  if (!prior || (prior.state !== "started" && prior.state !== "in_progress")) {
    redirect(`/exam/${canvasAssignmentId}`);
  }

  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-12 space-y-3">
        <h1 className="heading text-2xl">Live session — coming soon</h1>
        <p className="text-sm leading-relaxed">
          The live voice interface ships in M2b.5d. Your session row is
          created and waiting (id <code>{prior.id}</code>, state{" "}
          <code>{prior.state}</code>).
        </p>
        <p className="muted text-xs">
          When 5d lands, this page renders the live voice UI.
        </p>
      </main>
    </>
  );
}
