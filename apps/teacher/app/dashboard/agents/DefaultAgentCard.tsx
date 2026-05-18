"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneAgentTemplate } from "./actions";

/**
 * Read-only card for a default (system) agent template. The teacher can't
 * edit it — to customize, they clone with a forced new name. Try-it-out
 * still works from here so they can audition the default before cloning.
 */
export function DefaultAgentCard({
  preset,
  inUseCount,
}: {
  preset: {
    id: string;
    name: string;
    description: string | null;
    live_voice_name: string | null;
    ungraded: boolean;
    totalQuestions: number;
    totalSelected: number;
  };
  inUseCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await cloneAgentTemplate({
        source: { kind: "preset", id: preset.id },
        newName,
      });
      if (r.ok) {
        router.push(`/dashboard/agents/templates/${r.templateId}/edit`);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="heading text-base">{preset.name}</h3>
        {preset.live_voice_name && (
          <span className="muted text-xs">voice: {preset.live_voice_name}</span>
        )}
      </div>
      {preset.description && (
        <p className="muted text-sm mt-1">{preset.description}</p>
      )}
      <div className="muted text-xs mt-3 flex gap-3 flex-wrap">
        <span>{preset.ungraded ? "Ungraded" : "Graded"}</span>
        {preset.totalQuestions > 0 && (
          <span>
            asks {preset.totalSelected} of {preset.totalQuestions} questions per
            session
          </span>
        )}
        <span>
          {inUseCount === 0
            ? "not in use"
            : `in use on ${inUseCount} assignment${inUseCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="flex items-baseline gap-3 mt-3 flex-wrap">
        <Link
          href={`/dashboard/agents/${preset.id}/try`}
          className="text-sm text-maroon no-underline hover:underline"
        >
          Try it out →
        </Link>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-sm text-maroon no-underline hover:underline"
        >
          {open ? "Cancel" : "Clone & customize →"}
        </button>
      </div>

      {open && (
        <form onSubmit={onClone} className="mt-3 space-y-2 border-t border-rule pt-3">
          <label className="block text-xs muted">
            Name your custom template (must differ from &ldquo;{preset.name}&rdquo;)
          </label>
          <div className="flex items-baseline gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder={`e.g. ${preset.name} — close reading`}
              className="flex-1 border border-rule rounded px-3 py-1.5 text-sm"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending || !newName.trim()}
              className="btn bg-maroon text-white px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Cloning…" : "Clone"}
            </button>
          </div>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
