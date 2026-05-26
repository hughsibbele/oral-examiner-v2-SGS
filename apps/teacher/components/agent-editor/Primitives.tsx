"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunAction, ServerFormAction, TagStatus } from "./types";

/**
 * Shared primitives + tiny hooks used by the per-agent editor blocks
 * (Persona / Flow / Evaluation / Question set / Intake). Pure UI; no
 * server-action coupling. Both the system-default editor at /admin/agents
 * and the per-template editor at /assignments/[aid]/edit render the same
 * blocks against these primitives.
 */

export type SaveStatus = string | null;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {hint && <p className="text-stone-500 text-xs mb-2">{hint}</p>}
      {children}
    </div>
  );
}

export function SaveRow({
  status,
  label,
  small,
}: {
  status: SaveStatus;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 rounded font-medium bg-maroon border border-maroon text-white transition-colors hover:bg-maroon-dark hover:border-maroon-dark disabled:opacity-40 disabled:cursor-not-allowed ${
          small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
        }`}
      >
        {status === "saving" ? "Saving…" : label}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

export function StatusLine({
  status,
  compact,
}: {
  status: SaveStatus;
  compact?: boolean;
}) {
  if (!status || status === "saving") return null;
  const cls = compact ? "text-xs" : "text-sm";
  if (status === "saved") return <span className={`${cls} text-green-700`}>Saved.</span>;
  return <span className={`${cls} text-red-700`}>Error: {status}</span>;
}

export function MoveButton({
  disabled,
  onClick,
  label,
  title,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

export function DeleteButton({
  label,
  title,
  confirm,
  onConfirm,
}: {
  label: string;
  title?: string;
  confirm: string;
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        if (window.confirm(confirm)) onConfirm();
      }}
      className="inline-flex items-center gap-1.5 rounded font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 text-xs text-red-700 hover:bg-red-50"
    >
      {label}
    </button>
  );
}

/**
 * Renders below an editable field in template mode. Surfaces the preset
 * value the field would fall back to, and a "reset" button that triggers
 * `resetField` with `field` set to the column name. Use within blocks that
 * support `mode="template"`.
 */
export function InheritIndicator({
  field,
  isOverriding,
  presetLabel,
  rowId,
  ns,
  resetField,
  run,
  tagStatus,
}: {
  field: string;
  isOverriding: boolean;
  presetLabel: string;
  rowId: string;
  ns: string;
  resetField?: ServerFormAction;
  run: RunAction;
  tagStatus: TagStatus;
}) {
  const tag = `${ns}:reset:${field}`;
  const status = tagStatus(tag);
  return (
    <div className="flex items-baseline gap-2 mt-1 text-xs flex-wrap">
      {isOverriding ? (
        <>
          <span className="text-yellow-800">● overrides preset</span>
          <span className="text-stone-500">
            preset: <span className="italic">{presetLabel}</span>
          </span>
          {resetField && (
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    `Reset ${field} to inherit from preset? Your override will be discarded.`,
                  )
                )
                  return;
                run(tag, () => {
                  const fd = new FormData();
                  fd.set("id", rowId);
                  fd.set("field", field);
                  return resetField(fd);
                });
              }}
              className="inline-flex items-center gap-1.5 rounded font-medium border border-stone-200 text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed px-2 py-0.5 text-xs"
            >
              reset to default
            </button>
          )}
        </>
      ) : (
        <span className="text-stone-500">
          inherits from preset: <span className="italic">{presetLabel}</span>
        </span>
      )}
      {status && status !== "saving" && (
        <span
          className={status === "saved" ? "text-green-700" : "text-red-700"}
        >
          {status === "saved" ? "Reset." : `Error: ${status}`}
        </span>
      )}
    </div>
  );
}

/**
 * Walk a form's controls and return true if any field's current value
 * differs from its initial (DOM `defaultValue` / `defaultSelected` /
 * `defaultChecked`). Used to surface an "Unsaved changes" badge and to
 * guard collapse on agent cards.
 *
 * Skips hidden/submit/button inputs. Selects fall back to per-option
 * `defaultSelected` since `HTMLSelectElement` has no `defaultValue`.
 */
export function isFormDirty(form: HTMLFormElement): boolean {
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
      } else if (
        el.type !== "hidden" &&
        el.type !== "submit" &&
        el.type !== "button"
      ) {
        if (el.value !== el.defaultValue) return true;
      }
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      for (const opt of Array.from(el.options)) {
        if (opt.selected !== opt.defaultSelected) return true;
      }
    }
  }
  return false;
}

/**
 * Listens for input/change events anywhere inside `bodyRef` and tracks
 * whether any descendant form marked `data-track-dirty` has unsaved
 * fields. `freshnessKey` (typically the row's updated_at) resets the
 * dirty state after a successful save — React re-renders the children
 * with new defaultValues, and the next input event picks up the clean
 * state; resetting eagerly on key change avoids a stale flash.
 */
export function useDirtyBody(
  bodyRef: React.RefObject<HTMLElement | null>,
  freshnessKey: string,
): boolean {
  const [dirty, setDirty] = useState(false);
  // Reset-on-prop-change: track the last-seen freshnessKey in state and
  // reset dirty when it changes. Setting state during render is the
  // recommended path here (vs a useEffect, which would trigger cascading
  // renders that eslint flags).
  const [seenKey, setSeenKey] = useState(freshnessKey);
  if (seenKey !== freshnessKey) {
    setSeenKey(freshnessKey);
    setDirty(false);
  }

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    function recompute() {
      const forms = body!.querySelectorAll<HTMLFormElement>(
        "form[data-track-dirty]",
      );
      setDirty(Array.from(forms).some(isFormDirty));
    }
    body.addEventListener("input", recompute);
    body.addEventListener("change", recompute);
    body.addEventListener("reset", recompute);
    return () => {
      body.removeEventListener("input", recompute);
      body.removeEventListener("change", recompute);
      body.removeEventListener("reset", recompute);
    };
  }, [bodyRef]);

  return dirty;
}

/**
 * Auto-save trigger for a single <form> element. Fires `save()` when:
 * - 1.5s have elapsed since the last keystroke (debounced typing)
 * - focus leaves the form (blur saves immediately)
 * - the tab becomes hidden (visibilitychange — covers tab close + switch)
 *
 * Caller wires `save` to the underlying server action — typically
 * `run(tag, () => action(new FormData(formRef.current!)))`. The hook
 * only fires when `isFormDirty(form)` is true, so consecutive triggers
 * (e.g. blur right after debounce) collapse to a single save.
 *
 * The form's `<form action={...}>` should be unset / replaced with
 * `onSubmit={(e) => e.preventDefault()}` so Enter inside an input
 * doesn't double-submit. SaveRow can stay if you want a visible
 * indicator, but it's typically removed in favour of a page-level
 * AutoSaveStatusPill.
 */
export function useAutoSaveForm({
  formRef,
  save,
  debounceMs = 800,
  freshnessKey,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  save: () => void;
  debounceMs?: number;
  /** Resets the debounce timer when the row's updated_at changes, so a
   *  fresh defaultValue prop won't trigger a save on its own. */
  freshnessKey: string;
}) {
  // Keep `save` in a ref so re-renders don't churn the listener cleanup.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let timer: number | null = null;

    function fire() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!isFormDirty(form!)) return;
      saveRef.current();
    }

    function onInput() {
      if (!isFormDirty(form!)) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(fire, debounceMs);
    }

    function onFocusOut(e: FocusEvent) {
      // Ignore focus moves within the same form — only commit when focus
      // genuinely leaves the form's subtree.
      const next = e.relatedTarget as Node | null;
      if (next && form!.contains(next)) return;
      fire();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") fire();
    }

    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      form.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) window.clearTimeout(timer);
    };
    // freshnessKey is intentionally in the deps — a fresh server payload
    // resets defaultValues and clears dirty; we want to drop any pending
    // timer so the next user input restarts cleanly.
  }, [formRef, debounceMs, freshnessKey]);
}

/**
 * Build a stable callback that snapshots the form's current FormData and
 * runs it through the parent's `run(tag, action)` machinery. Memoized so
 * the auto-save hook can hold a stable reference.
 */
export function useFormSaveCallback({
  formRef,
  tag,
  run,
  action,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  tag: string;
  run: RunAction;
  action: ServerFormAction;
}) {
  return useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    run(tag, () => action(fd));
  }, [formRef, tag, run, action]);
}
