import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/BrandHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExamContext, type ResolvedAgent } from "@/lib/exam/resolve";
import {
  classifyPriorSession,
  findActivePriorSession,
  isStaleLiveSession,
  refundAndArchiveSession,
} from "@/lib/exam/session";
import {
  estimateDurationMin,
  type FollowUpDepth,
} from "@/lib/runtime/flow-parameters";
import { startExam } from "@/lib/exam/start-exam";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: canvasAssignmentId } = await params;

  // The /exam/[token] route uses canvas_assignment_id as the slug (per the
  // install card link shape in packages/canvas/src/install.ts). "Token" is
  // legacy terminology from the initial scaffold; the variable name in the
  // resolver and elsewhere is canvasAssignmentId.

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    redirect(`/login?next=/exam/${canvasAssignmentId}`);
  }

  const resolution = await resolveExamContext({
    canvasAssignmentId,
    studentEmail: user.email,
    studentAuthUserId: user.id,
  });

  if (resolution.kind === "no_binding" || resolution.kind === "no_agent") {
    return <NotConfiguredScreen />;
  }
  if (resolution.kind === "not_on_roster") {
    return <NotOnRosterScreen email={user.email} />;
  }

  const { student, agent, assignmentTitle } = resolution;

  let prior = await findActivePriorSession({
    canvasAssignmentId,
    studentId: student.id,
  });

  // REMEDIATION_PLAN Phase 3: if the prior row is a wedged live session
  // past the grace window, archive + refund it now so the student gets
  // the ready screen instead of being trapped at /run's disconnected
  // screen. Mirrors the sweep-stale-exam-sessions Inngest cron; we run
  // it inline here so the student doesn't have to wait for the next
  // cron tick.
  if (isStaleLiveSession(prior)) {
    await refundAndArchiveSession(prior!.id, "abandoned_resume");
    prior = null;
  }

  const verdict = classifyPriorSession(prior);

  if (verdict === "completion_blocked" && prior) {
    return <CompletionBlockedScreen completedAt={prior.completed_at} />;
  }
  if (verdict === "live_session") {
    redirect(`/exam/${canvasAssignmentId}/run`);
  }
  // short_attempt / failed_prior / scheduled_orphan rows get auto-archived
  // inside the startExam server action; we render the ready screen now.

  const agentSummary = summarizeAgent(agent);
  const questionCount = await estimateQuestionCount(agent);
  const estimatedDurationMin = estimateDurationMin(
    questionCount,
    agentSummary.followUpDepth,
  );

  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <header className="space-y-1">
          {assignmentTitle && (
            <div className="muted text-xs uppercase tracking-wider">
              {assignmentTitle}
            </div>
          )}
          <h1 className="heading text-2xl">Ready to start your oral defense</h1>
        </header>

        <section className="bg-white border border-light-blue rounded p-5 space-y-3">
          <div className="text-sm">
            <span className="muted">Your examiner: </span>
            <span className="font-medium">{agentSummary.name}</span>
          </div>
          {agentSummary.description && (
            <p className="muted text-sm leading-relaxed">
              {agentSummary.description}
            </p>
          )}
          <div className="text-sm">
            <span className="muted">Estimated length: </span>
            <span className="font-medium">~{estimatedDurationMin} minutes</span>
            {questionCount > 0 && (
              <span className="muted">
                {" "}
                ({questionCount} questions)
              </span>
            )}
          </div>
          {agentSummary.openingText && (
            <div className="text-sm border-t border-light-blue pt-3">
              <div className="muted text-xs mb-1">
                Your examiner&apos;s first words will be:
              </div>
              <blockquote className="italic">
                &ldquo;{agentSummary.openingText}&rdquo;
              </blockquote>
            </div>
          )}
        </section>

        <section className="bg-white border border-light-blue rounded p-5 text-sm leading-relaxed space-y-2">
          <h2 className="heading text-base">Before you begin</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              This conversation will be <strong>recorded</strong> and{" "}
              <strong>transcribed</strong>. Your teacher will receive the
              transcript and an AI-generated evaluation.
            </li>
            <li>
              You&apos;ll talk with an AI examiner over your microphone. Make
              sure you&apos;re somewhere quiet and your mic is working.
            </li>
            <li>
              You get <strong>one attempt</strong>. If something technical
              goes wrong (you lose connection, your mic fails, etc.), email
              your teacher and they can reset it.
            </li>
          </ul>
        </section>

        <form
          action={startExam}
          className="flex flex-col items-stretch gap-2"
        >
          <input
            type="hidden"
            name="canvas_assignment_id"
            value={canvasAssignmentId}
          />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed justify-center py-3">
            Start exam
          </button>
          <p className="muted text-xs text-center">
            Clicking Start opens the live conversation.
          </p>
        </form>
      </main>
    </>
  );
}

function NotConfiguredScreen() {
  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="heading text-2xl mb-3">This exam isn&apos;t ready yet</h1>
        <p className="text-sm leading-relaxed">
          Your teacher hasn&apos;t finished setting up the oral defense for
          this assignment. Please email them and let them know — they need
          to configure an agent before students can start.
        </p>
      </main>
    </>
  );
}

function NotOnRosterScreen({ email }: { email: string }) {
  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="heading text-2xl mb-3">
          We can&apos;t find you on the roster
        </h1>
        <p className="text-sm leading-relaxed">
          You&apos;re signed in as <code>{email}</code>, but that email
          isn&apos;t on the roster for this course. Email your teacher so
          they can sync the roster from Canvas, then try this link again.
        </p>
      </main>
    </>
  );
}

function CompletionBlockedScreen({
  completedAt,
}: {
  completedAt: string | null;
}) {
  // M2b.5d.5 — one screen for both entry conditions: just-submitted (the
  // /run page redirects here after endExamSession) AND revisit-after
  // (student re-opens /exam/<aid> after a previous attempt). We
  // intentionally don't differentiate by freshness — the messaging is the
  // same either way, and a fresh student doesn't need to know they're
  // looking at a "blocker" screen.
  const when = completedAt
    ? new Date(completedAt).toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : null;
  return (
    <>
      <BrandHeader eyebrow="Episcopal High School" title="Oral Defense" />
      <main className="max-w-2xl mx-auto px-6 py-12 space-y-3">
        <h1 className="heading text-2xl">Your oral defense is submitted</h1>
        {when && (
          <p className="text-sm leading-relaxed">
            Completed on <strong>{when}</strong>.
          </p>
        )}
        <p className="text-sm leading-relaxed">
          Your teacher will see your transcript and an AI-generated
          evaluation when they grade. They&apos;ll write back via Canvas as
          usual.
        </p>
        <p className="text-sm leading-relaxed">
          If something went wrong (technical issue, mic failure, etc.),
          email your teacher and they can reset your session so you can try
          again.
        </p>
      </main>
    </>
  );
}

// =========================================================================
// Helpers
// =========================================================================

type AgentSummary = {
  name: string;
  description: string | null;
  openingText: string | null;
  followUpDepth: FollowUpDepth;
  questionSetId: string | null;
};

function summarizeAgent(agent: ResolvedAgent): AgentSummary {
  // template.X ?? preset.X — same fallback pattern the runtime assembler
  // will use at Live connect time in 5d.1.
  if (agent.kind === "preset") {
    const p = agent.preset;
    return {
      name: p.name,
      description: p.description,
      openingText: p.opening_text,
      followUpDepth: (p.follow_up_depth as FollowUpDepth) ?? "medium",
      questionSetId: p.default_question_set_id,
    };
  }
  const t = agent.template;
  const p = agent.preset;
  const depth = (t.follow_up_depth ?? p?.follow_up_depth ?? "medium") as FollowUpDepth;
  return {
    name: t.name || p?.name || "Oral defense examiner",
    description: p?.description ?? null,
    openingText: t.opening_text ?? p?.opening_text ?? null,
    followUpDepth: depth,
    questionSetId: t.question_set_id ?? p?.default_question_set_id ?? null,
  };
}

/**
 * Sum of select_count across all buckets in the agent's question set. Used
 * for the estimated-duration display on the ready screen. The real session
 * picks the actual subset via Fisher-Yates inside startExam; this estimate
 * is the same number that would be picked (since select_count is the cap).
 */
async function estimateQuestionCount(agent: ResolvedAgent): Promise<number> {
  const setId =
    agent.kind === "preset"
      ? agent.preset.default_question_set_id
      : (agent.template.question_set_id ??
        agent.preset?.default_question_set_id ??
        null);
  if (!setId) return 0;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("question_buckets")
    .select("select_count")
    .eq("question_set_id", setId);
  if (error || !data) return 0;
  return data.reduce((sum, b) => sum + (b.select_count ?? 0), 0);
}
