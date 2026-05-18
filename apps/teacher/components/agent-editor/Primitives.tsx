"use client";

import { useEffect, useState } from "react";
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
      {hint && <p className="muted text-xs mb-2">{hint}</p>}
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
        className={`btn bg-maroon text-white ${
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
      className="btn px-2 py-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
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
      className="btn px-2 py-1 text-xs text-red-700 hover:bg-red-50"
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
          <span className="muted">
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
              className="btn px-2 py-0.5 text-xs"
            >
              reset to default
            </button>
          )}
        </>
      ) : (
        <span className="muted">
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
