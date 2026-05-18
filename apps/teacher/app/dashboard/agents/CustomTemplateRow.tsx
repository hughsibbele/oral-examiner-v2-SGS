"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTemplate, renameTemplate } from "./actions";

type Binding = {
  canvas_course_id: string;
  canvas_assignment_id: string;
  course_name: string | null;
  assignment_name: string | null;
};

/**
 * One row in the "Your templates" list. Click the name to expand → inline
 * rename + per-binding deep-link to each assignment that uses this template.
 * Delete is destructive (cascades the bindings) so we warn.
 */
export function CustomTemplateRow({
  template,
  bindings,
}: {
  template: {
    id: string;
    name: string;
    presetName: string | null;
    overrideCount: number;
  };
  bindings: Binding[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        bindings.length > 0
          ? `Delete "${template.name}"? It's currently used by ${bindings.length} assignment${bindings.length === 1 ? "" : "s"} — those Canvas cards will be removed too, and the assignments will need a new agent assigned before students can take the exam.`
          : `Delete "${template.name}"?`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", template.id);
      const r = await deleteTemplate(fd);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  function onRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const r = await renameTemplate(fd);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <li className="rounded border border-rule bg-white">
      <div className="flex items-baseline justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-baseline gap-2 text-left flex-1 min-w-0"
        >
          <Chevron open={open} />
          <span className="font-medium text-sm truncate">{template.name}</span>
          <span className="muted text-xs whitespace-nowrap">
            {template.presetName ? `· based on ${template.presetName}` : ""}
            {template.overrideCount > 0 && (
              <> · {template.overrideCount} override{template.overrideCount === 1 ? "" : "s"}</>
            )}
            {" · used by "}
            {bindings.length} assignment{bindings.length === 1 ? "" : "s"}
          </span>
        </button>
        <div className="flex items-baseline gap-3 shrink-0">
          <Link
            href={`/dashboard/agents/templates/${template.id}/edit`}
            className="text-maroon text-sm no-underline hover:underline"
          >
            Edit →
          </Link>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="text-xs text-red-700 underline hover:no-underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-rule p-3 space-y-3 bg-paper">
          <form onSubmit={onRename} className="flex items-end gap-2">
            <input type="hidden" name="id" value={template.id} />
            <div className="flex-1">
              <label className="block text-xs muted mb-1">Rename</label>
              <input
                name="name"
                defaultValue={template.name}
                required
                className="w-full border border-rule rounded px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="btn px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? "Saving…" : "Rename"}
            </button>
          </form>

          {bindings.length > 0 ? (
            <div>
              <div className="text-xs muted mb-1">Used by:</div>
              <ul className="space-y-0.5">
                {bindings.map((b) => (
                  <li
                    key={b.canvas_assignment_id}
                    className="text-xs flex items-baseline gap-2"
                  >
                    <Link
                      href={`/dashboard/courses/${b.canvas_course_id}/assignments/${b.canvas_assignment_id}`}
                      className="text-maroon no-underline hover:underline"
                    >
                      {b.assignment_name ?? b.canvas_assignment_id}
                    </Link>
                    <span className="muted">
                      ({b.course_name ?? b.canvas_course_id})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs muted">
              Not yet attached to any assignment. Pick this template from an
              assignment configure page.
            </p>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 20 20"
      className={`shrink-0 muted transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
