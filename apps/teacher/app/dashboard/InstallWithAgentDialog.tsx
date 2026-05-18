"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { installCardForAssignment } from "./agents/actions";

export type AgentChoice =
  | { kind: "preset"; id: string; name: string; description?: string | null }
  | { kind: "template"; id: string; name: string; presetName: string | null };

/**
 * "Install card" popup. Shown when the teacher clicks Install on an
 * assignment that has no agent bound yet — every card must have an agent
 * so students land somewhere when they click it.
 *
 * Picker offers the 4 default agents up top + any teacher-owned templates
 * below. On submit, runs the unified `installCardForAssignment` action
 * which creates a binding (find-or-create the default-pointer template
 * when a default agent is picked) and installs the Canvas card.
 *
 * After successful install, an "Edit this agent" deep-link surfaces so
 * the teacher can customize without hunting through the hub.
 */
export function InstallWithAgentDialog({
  open,
  onClose,
  canvasCourseId,
  canvasAssignmentId,
  defaultAgents,
  teacherTemplates,
}: {
  open: boolean;
  onClose: () => void;
  canvasCourseId: string;
  canvasAssignmentId: string;
  defaultAgents: { id: string; name: string; description: string | null }[];
  teacherTemplates: { id: string; name: string; presetName: string | null }[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    binding: { kind: "preset" | "template"; id: string };
  } | null>(null);

  type Pick =
    | { kind: "preset"; id: string }
    | { kind: "template"; id: string }
    | null;
  const initialPick: Pick = defaultAgents[0]
    ? { kind: "preset", id: defaultAgents[0].id }
    : teacherTemplates[0]
      ? { kind: "template", id: teacherTemplates[0].id }
      : null;
  const [pick, setPick] = useState<Pick>(initialPick);

  // Show/close native <dialog> via showModal / close so we get the
  // backdrop + Esc-to-close for free.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Reset state when the dialog opens. The setState-in-effect lint warning
  // applies broadly but this is the textbook "reset internal state when an
  // external trigger flips" use case — no cascade, runs once per open.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on prop trigger
    setError(null);
    setSuccess(null);
    setPick(initialPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialPick recomputes on prop change
  }, [open]);

  function onSubmit() {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      const r = await installCardForAssignment({
        canvasCourseId,
        canvasAssignmentId,
        agent: pick,
      });
      if (r.ok) {
        setSuccess({ binding: r.binding });
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  function onDone() {
    setSuccess(null);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded border border-rule p-0 backdrop:bg-black/40 max-w-lg w-[min(92vw,32rem)]"
    >
      <div className="p-5 space-y-4">
        <div>
          <h3 className="heading text-lg">Install card</h3>
          <p className="muted text-sm mt-1">
            Pick an agent for this assignment. Students who click the card in
            Canvas will land on this agent&rsquo;s oral exam.
          </p>
        </div>

        {success ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-800">
              ✓ Card installed and agent assigned.
            </p>
            <p className="muted text-xs">
              {success.binding.kind === "preset"
                ? "Using a default agent template. To customize, click 'Clone & customize' on the assignment configure page."
                : "Using your custom template."}
            </p>
            <div className="flex items-baseline gap-3 flex-wrap">
              {success.binding.kind === "template" && (
                <Link
                  href={`/dashboard/agents/templates/${success.binding.id}/edit`}
                  className="btn bg-maroon text-white px-3 py-2 text-sm no-underline"
                >
                  Edit this template →
                </Link>
              )}
              <Link
                href={`/dashboard/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`}
                className="text-sm text-maroon no-underline hover:underline"
              >
                Open assignment configure →
              </Link>
              <button
                type="button"
                onClick={onDone}
                className="text-sm muted underline hover:no-underline"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {defaultAgents.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs muted mb-1">Default agent templates</legend>
                {defaultAgents.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-baseline gap-2 px-3 py-2 border border-rule rounded cursor-pointer hover:border-maroon"
                  >
                    <input
                      type="radio"
                      name="agent"
                      checked={pick?.kind === "preset" && pick.id === a.id}
                      onChange={() => setPick({ kind: "preset", id: a.id })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.name}</div>
                      {a.description && (
                        <div className="muted text-xs">{a.description}</div>
                      )}
                    </div>
                  </label>
                ))}
              </fieldset>
            )}

            {teacherTemplates.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs muted mb-1">Your custom templates</legend>
                {teacherTemplates.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-baseline gap-2 px-3 py-2 border border-rule rounded cursor-pointer hover:border-maroon"
                  >
                    <input
                      type="radio"
                      name="agent"
                      checked={pick?.kind === "template" && pick.id === t.id}
                      onChange={() => setPick({ kind: "template", id: t.id })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{t.name}</div>
                      {t.presetName && (
                        <div className="muted text-xs">based on {t.presetName}</div>
                      )}
                    </div>
                  </label>
                ))}
              </fieldset>
            )}

            {error && <p className="text-xs text-red-700">{error}</p>}

            <div className="flex items-baseline justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="text-sm muted underline hover:no-underline disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={pending || !pick}
                className="btn bg-maroon text-white px-3 py-2 text-sm disabled:opacity-50"
              >
                {pending ? "Installing…" : "Install card with this agent"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
