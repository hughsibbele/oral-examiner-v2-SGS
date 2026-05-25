"use client";

// Reusable Google Drive Picker. On click, lazy-loads gapi + the picker
// module, mints a fresh access token via /api/google/picker-token, opens the
// picker scoped to drive.file, and calls `onPick` with the chosen file ref.
//
// Used by:
// - exam template intake config (attaches PDFs / Docs as exam materials)
// - save template to Drive (2b.1i — picks a destination folder)
//
// Configuration via NEXT_PUBLIC env (both public-by-design):
// - NEXT_PUBLIC_GOOGLE_APP_ID         — Google Cloud project number (1064664034087)
// - NEXT_PUBLIC_GOOGLE_PICKER_API_KEY — Google Cloud API key (Picker / Drive APIs)

import { useState } from "react";

export type DriveFileRef = {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
};

export type DrivePickerMode = "files" | "folders";

type Props = {
  /** Triggered after the user picks a file (or folder, in folders mode). */
  onPick: (file: DriveFileRef) => void;
  /** Triggered if the user closes the picker without selecting. Optional. */
  onCancel?: () => void;
  /**
   * Restrict the file picker to specific MIME types. Ignored in folders mode.
   * Defaults to PDFs + Google Docs + plain text, since those are what the
   * intake-pack PDF→text helper can extract from cleanly.
   */
  mimeTypes?: string[];
  /** "files" (default) lets the user pick documents. "folders" lets them pick a Drive folder. */
  mode?: DrivePickerMode;
  /** Button label. Defaults to "Pick from Drive". */
  label?: string;
  /** className passthrough — falls back to default outline button styling. */
  className?: string;
  /** Disable the button (e.g. while parent is saving). */
  disabled?: boolean;
};

const DEFAULT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.google-apps.document",
  "text/plain",
];

// Minimal ambient typing to avoid pulling in @types/google.picker. We touch
// the surface in three call sites only; full types would cost an install.
type PickerCallbackData = {
  action: string;
  docs?: Array<{
    id: string;
    name: string;
    mimeType: string;
    url?: string;
  }>;
};

type PickerLib = {
  PickerBuilder: new () => unknown;
  DocsView: new (viewId?: unknown) => unknown;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Feature: { NAV_HIDDEN: unknown; MINE_ONLY: unknown };
  Action: { PICKED: string; CANCEL: string };
};

declare global {
  interface Window {
    // gapi + google.picker are loaded at runtime; keep these minimal.
    gapi?: {
      load: (api: string, opts: { callback: () => void; onerror?: () => void }) => void;
    };
    google?: {
      picker?: PickerLib;
    };
  }
}

const GAPI_SRC = "https://apis.google.com/js/api.js";
let gapiLoadingPromise: Promise<void> | null = null;
let pickerReadyPromise: Promise<void> | null = null;

function loadGapi(): Promise<void> {
  if (gapiLoadingPromise) return gapiLoadingPromise;
  gapiLoadingPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("DrivePicker can only load in the browser."));
      return;
    }
    if (window.gapi) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GAPI_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load gapi script.")),
      );
      return;
    }
    const tag = document.createElement("script");
    tag.src = GAPI_SRC;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("Failed to load gapi script."));
    document.head.appendChild(tag);
  });
  return gapiLoadingPromise;
}

function loadPickerModule(): Promise<void> {
  if (pickerReadyPromise) return pickerReadyPromise;
  pickerReadyPromise = loadGapi().then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!window.gapi) {
          reject(new Error("gapi missing after script load."));
          return;
        }
        window.gapi.load("picker", {
          callback: () => resolve(),
          onerror: () => reject(new Error("Failed to load picker module.")),
        });
      }),
  );
  return pickerReadyPromise;
}

async function fetchAccessToken(): Promise<string> {
  const res = await fetch("/api/google/picker-token", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ?? `picker-token endpoint returned ${res.status}`,
    );
  }
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

export function DrivePicker({
  onPick,
  onCancel,
  mimeTypes,
  mode = "files",
  label,
  className,
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // appId is the Google Cloud project number. Required when using drive.file
  // scope — without it, Picker shows files the Drive API will then reject as
  // unauthorized. Static for the whole suite, no creation step in GCP.
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
  // developerKey is a Google Cloud API key — strictly OPTIONAL for the
  // Picker widget. Per Google's "Create credentials" wizard ("This API
  // doesn't require that you create credentials. You're already good to
  // go!"), the picker works on the user's OAuth grant alone. Setting it
  // attributes quota to our project instead of a shared anonymous bucket;
  // useful at scale, not strictly needed for a single-school deployment.
  const developerKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "";

  async function open() {
    if (!appId) {
      setError(
        "Drive Picker not configured. Set NEXT_PUBLIC_GOOGLE_APP_ID=1064664034087.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [accessToken] = await Promise.all([
        fetchAccessToken(),
        loadPickerModule(),
      ]);
      const picker = window.google?.picker;
      if (!picker) {
        throw new Error("Picker library missing after load.");
      }

      const allowedMimes = (mimeTypes ?? DEFAULT_MIME_TYPES).join(",");
      const view =
        mode === "folders"
          ? new (picker.DocsView as new (v: unknown) => unknown)(
              picker.ViewId.FOLDERS,
            )
          : new (picker.DocsView as new () => unknown)();

      // Apply view configuration via the chainable methods. The picker API's
      // `as` casts are unavoidable without @types/google.picker.
      const v = view as {
        setMimeTypes?: (m: string) => unknown;
        setSelectFolderEnabled?: (b: boolean) => unknown;
        setIncludeFolders?: (b: boolean) => unknown;
      };
      if (mode === "folders") {
        v.setSelectFolderEnabled?.(true);
        v.setIncludeFolders?.(true);
      } else {
        v.setMimeTypes?.(allowedMimes);
      }

      const handleCallback = (data: PickerCallbackData) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          if (doc) {
            onPick({
              id: doc.id,
              name: doc.name,
              mimeType: doc.mimeType,
              url: doc.url,
            });
          }
        } else if (data.action === picker.Action.CANCEL) {
          onCancel?.();
        }
      };

      type Builder = {
        addView: (v: unknown) => Builder;
        setOAuthToken: (t: string) => Builder;
        setDeveloperKey: (k: string) => Builder;
        setAppId: (a: string) => Builder;
        setCallback: (cb: (data: PickerCallbackData) => void) => Builder;
        enableFeature: (f: unknown) => Builder;
        build: () => { setVisible: (v: boolean) => void };
      };
      type SizedBuilder = Builder & {
        setSize: (w: number, h: number) => Builder;
      };
      const builder = new (picker.PickerBuilder as new () => SizedBuilder)();

      // Fit-to-viewport sizing — the default picker is a small modal that
      // freezes when its internal list overflows. Use most of the viewport
      // but cap so it stays a dialog, not full-screen.
      const w = Math.min(1100, window.innerWidth - 40);
      const h = Math.min(720, window.innerHeight - 60);

      let chain = builder
        .setSize(w, h)
        .addView(view)
        .setOAuthToken(accessToken)
        .setAppId(appId)
        .setCallback(handleCallback);
      // NAV_HIDDEN drops the left sidebar (Recent / Shared / Starred) —
      // removed because under drive.file scope the user often needs those
      // filters to navigate to files this app hasn't yet seen.

      // Only attach the API key if one was configured — Google's wizard
      // explicitly says the Picker doesn't need it; setting it improves
      // thumbnail loading + quota attribution.
      if (developerKey) {
        chain = chain.setDeveloperKey(developerKey);
      }
      chain.build().setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Picker failed to open.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={open}
        disabled={busy || disabled}
        className={className ?? "inline-flex items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-medium border border-light-blue text-ink transition-colors hover:border-maroon hover:text-maroon disabled:opacity-40 disabled:cursor-not-allowed"}
      >
        {busy
          ? "Loading…"
          : (label ?? (mode === "folders" ? "Pick a folder" : "Pick from Drive"))}
      </button>
      {error && (
        <p className="text-xs text-maroon" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
