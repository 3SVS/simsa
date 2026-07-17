"use client";

/**
 * Dashboard client for the workspace export-builder-pack endpoint.
 * Deterministic on the server side — no rate limits.
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

// ─── Types (mirrors central-plane export.ts) ──────────────────────────────────

export type ExportTarget = "claude_code" | "codex" | "both" | "web_builder";

export type ExportFile = {
  path: string;
  content: string;
};

export type ExportBuilderPackResponse = {
  ok: true;
  source: "deterministic";
  bundle: { files: ExportFile[] };
  summary: { fileCount: number; totalItems: number; selectedItems: number; recommendedNextStep: string };
};

export type ExportApiError =
  | { ok: false; error: "network" | "server"; message: string };

export type ExportBuilderPackInput = {
  projectId?: string;
  /** Required by the server when loading the project by projectId (ownership check). */
  userKey?: string;
  project?: {
    title: string;
    idea?: string;
    productSpec: unknown;
    items: Array<{ id: string; title: string; status: string; criteria: string[] }>;
    checkResults?: unknown;
    fixSuggestions?: unknown;
  };
  /** When provided, only these item IDs are included in items/checks/fixes/prompts. */
  selectedItemIds?: string[];
  /** Prep layer: collected external services + env values. Values are gathered in
   *  the browser and sent per-export so the pack can bake .env; never persisted
   *  server-side (no-store, Rule 3). Omit when the user set nothing up. */
  services?: Array<{
    id: string;
    label: string;
    setupUrl?: string;
    setupSteps?: string[];
    envVars: Array<{
      key: string;
      description: string;
      secret?: boolean;
      example?: string;
      value?: string;
    }>;
  }>;
  target: ExportTarget;
};

export async function callExportBuilderPackApi(
  input: ExportBuilderPackInput,
): Promise<ExportBuilderPackResponse | ExportApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/export-builder-pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, format: "json", locale: "ko" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as ExportBuilderPackResponse;
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

// ─── Builder pack outcomes API ────────────────────────────────────────────────

export type OutcomeStatus = "worked" | "partial" | "failed" | "not_checked";

export type RemoteOutcome = {
  id: string;
  projectId: string;
  target: ExportTarget;
  selectedItemIds: string[];
  outcome: OutcomeStatus;
  note?: string;
  createdAt: string;
};

export type SaveOutcomeInput = {
  projectId: string;
  /** Required — the server enforces project ownership. */
  userKey: string;
  target: ExportTarget;
  selectedItemIds: string[];
  outcome: OutcomeStatus;
  note?: string;
};

export type SaveOutcomeResult =
  | { ok: true; outcome: RemoteOutcome }
  | { ok: false; error: "network" | "server"; message: string };

export type ListOutcomesResult =
  | { ok: true; outcomes: RemoteOutcome[] }
  | { ok: false; error: "network" | "server"; message: string };

export async function callSaveOutcomeApi(
  input: SaveOutcomeInput,
): Promise<SaveOutcomeResult> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/builder-pack-outcomes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as SaveOutcomeResult;
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

export async function callListOutcomesApi(
  projectId: string,
  userKey: string,
): Promise<ListOutcomesResult> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/builder-pack-outcomes?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as ListOutcomesResult;
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}
