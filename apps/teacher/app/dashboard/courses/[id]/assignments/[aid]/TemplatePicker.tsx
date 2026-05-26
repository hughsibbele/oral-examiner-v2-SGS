"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cloneAgentTemplate,
  setAssignmentAgent,
} from "@/app/dashboard/agents/actions";

export type AgentOption =
  | { kind: "preset"; id: string; name: string; description: string | null }
  | {
      kind: "template";
      id: string;
      name: string;
      presetName: string | null;
      overrideCount: number;
    };

export type CurrentBinding =
  | { kind: "preset"; presetId: string; presetName: string }
  | {
      kind: "template";
      templateId: string;
      templateName: string;
      presetName: string | null;
      overrideCount: number;
    }
  | null;

/**
 * Per-assignment agent template picker (M2b.5b refactor v2).
 *
 * Shows the current binding clearly:
 *   - "Using default ChekhovBot" for preset bindings
 *   - "Custom: {template name}" for teacher-template bindings
 *   - "Not assigned" if no binding
 *
 * Affordances:
 *   - Swap dropdown — pick any default or custom; Apply binds in place
 *   - Clone & customize — opens a name input; creates a new custom template
 *     seeded from the current binding (or first default if none) and
 *     rebinds the assignment to the clone
 *   - Manage Custom — deep links to the editor when bound to a custom
 *   - Unassign — removes the binding entirely
 */
export function TemplatePicker({
  canvasCourseId,
  canvasAssignmentId,
  options,
  current,
  defaultNames,
}: {
  canvasCourseId: string;
  canvasAssignmentId: string;
  options: AgentOption[];
  current: CurrentBinding;
  defaultNames: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneFromBlank, setCloneFromBlank] = useState(false);

  const currentKey = current
    ? current.kind === "preset"
      ? `preset:${current.presetId}`
      : `template:${current.templateId}`
    : "";
  const [draft, setDraft] = useState<string>(currentKey);

  function save() {
    if (!draft || draft === currentKey) return;
    setError(null);
    const [kind, id] = draft.split(":") as ["preset" | "template", string];
    startTransition(async () => {
      const r = await setAssignmentAgent({
        canvasCourseId,
        canvasAssignmentId,
        agent: { kind, id },
      });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function unassign() {
    if (
      !window.confirm(
        "Unassign the agent and remove the Canvas card? Cards without an agent route students nowhere, so both get pulled at once.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const r = await setAssignmentAgent({
        canvasCourseId,
        canvasAssignmentId,
        agent: null,
      });
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function onClone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cloneName.trim()) return;
    setError(null);
    // Source priority: explicit "from blank" → blank-slate; else current
    // binding (preset OR template); else the first default in the list.
    const source = cloneFromBlank
      ? ({ kind: "blank" } as const)
      : current
        ? current.kind === "preset"
          ? ({ kind: "preset", id: current.presetId } as const)
          : ({ kind: "template", id: current.templateId } as const)
        : options[0]?.kind === "preset"
          ? ({ kind: "preset", id: options[0].id } as const)
          : null;
    if (!source) {
      setError("No source to clone from.");
      return;
    }
    startTransition(async () => {
      const r = await cloneAgentTemplate({
        source,
        newName: cloneName.trim(),
        bindToAssignment: { canvasCourseId, canvasAssignmentId },
      });
      if (r.ok) {
        router.push(`/dashboard/agents/templates/${r.templateId}/edit`);
      } else {
        setError(r.error);
      }
    });
  }

  const defaultOptions = options.filter((o) => o.kind === "preset");
  const customOptions = options.filter((o) => o.kind === "template");

  return (
    <div className="space-y-3">
      {/* Current binding */}
      {current ? (
        <p className="text-sm">
          {current.kind === "preset" ? (
            <>
              Using <strong>default {current.presetName}</strong>.
            </>
          ) : (
            <>
              Using custom template <strong>{current.templateName}</strong>
              {current.presetName && (
                <span className="text-stone-500"> (based on {current.presetName})</span>
              )}
              {current.overrideCount > 0 && (
                <span className="text-stone-500">
                  {" "}
                  · {current.overrideCount} override
                  {current.overrideCount === 1 ? "" : "s"}
                </span>
              )}
              .
            </>
          )}
        </p>
      ) : (
        <p className="text-sm text-stone-500">No agent template assigned yet.</p>
      )}

      {/* Swap dropdown */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <label className="text-xs text-stone-500">Swap to:</label>
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          className="border border-stone-300 rounded px-3 py-2 text-sm min-w-[260px]"
        >
          {!currentKey && <option value="">— pick an agent —</option>}
          {defaultOptions.length > 0 && (
            <optgroup label="Default agent templates">
              {defaultOptions.map((o) => (
                <option key={`preset:${o.id}`} value={`preset:${o.id}`}>
                  Default {o.name}
                </option>
              ))}
            </optgroup>
          )}
          {customOptions.length > 0 && (
            <optgroup label="Your custom templates">
              {customOptions.map((o) => (
                <option key={`template:${o.id}`} value={`template:${o.id}`}>
                  {o.name}
                  {o.kind === "template" && o.presetName
                    ? ` (based on ${o.presetName})`
                    : ""}
                  {o.kind === "template" && o.overrideCount > 0
                    ? ` · ${o.overrideCount} ov`
                    : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={pending || !draft || draft === currentKey}
          className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : "Apply"}
        </button>
      </div>

      {/* Affordances */}
      <div className="flex items-baseline gap-3 flex-wrap text-sm">
        {current?.kind === "template" && (
          <Link
            href={`/dashboard/agents/templates/${current.templateId}/edit`}
            className="text-maroon no-underline hover:underline"
          >
            Edit this custom template →
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCloneOpen(!cloneOpen)}
          className="text-maroon no-underline hover:underline"
        >
          {cloneOpen ? "Cancel clone" : "Clone & customize →"}
        </button>
        {current && (
          <button
            type="button"
            onClick={unassign}
            disabled={pending}
            className="text-stone-500 underline hover:no-underline disabled:opacity-50"
            title="Unassigning removes the Canvas card too — cards without an agent route nowhere."
          >
            Unassign agent + remove card
          </button>
        )}
        <Link
          href="/dashboard/agents"
          className="text-maroon no-underline hover:underline"
        >
          Manage agent templates →
        </Link>
      </div>

      {cloneOpen && (
        <form onSubmit={onClone} className="border-t border-stone-200 pt-3 space-y-2">
          <label className="block text-xs text-stone-500">
            New custom template name (must differ from any default:{" "}
            {defaultNames.map((n) => `"${n}"`).join(", ")})
          </label>
          <div className="flex items-baseline gap-2">
            <input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              required
              placeholder="e.g. ChekhovBot — final paper"
              className="flex-1 border border-stone-300 rounded px-3 py-1.5 text-sm"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending || !cloneName.trim()}
              className="inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Cloning…" : "Clone & open editor"}
            </button>
          </div>
          <label className="flex items-baseline gap-2 text-xs text-stone-500">
            <input
              type="checkbox"
              checked={cloneFromBlank}
              onChange={(e) => setCloneFromBlank(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Start from scratch (blank slate) instead of cloning the current
              agent
            </span>
          </label>
        </form>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
