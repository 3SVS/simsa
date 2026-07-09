"use client";

/**
 * Dashboard client for workspace check/fix/project endpoints.
 * Rate limit 429 → no fallback (propagated to UI).
 * Network/server errors → local heuristic fallback where possible.
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

// ─── Types (mirroring central-plane shapes) ───────────────────────────────────

export type CheckItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

export type CheckResultItem = {
  itemId: string;
  status: CheckItemStatus;
  title: string;
  userLabel: "통과" | "안 맞음" | "확인 부족" | "결정 필요";
  reason: string;
  evidence: string[];
  nextAction: string;
};

export type CheckDraftResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  results: CheckResultItem[];
  warnings?: string[];
};

export type FixSuggestionResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  itemId: string;
  suggestion: {
    plainSummary: string;
    productSpecPatch: {
      addDecisions: string[];
      addCriteria: string[];
      addOpenQuestions: string[];
      removeOrClarify?: string[];
    };
    builderBrief: {
      title: string;
      goal: string;
      context: string[];
      tasks: string[];
      doneWhen: string[];
      doNotDo: string[];
      verifyBy: string[];
    };
  };
  warnings?: string[];
};

export type ApiError =
  | { ok: false; error: "rate_limited"; message: string; retryAfterSeconds?: number }
  | { ok: false; error: "network" | "server"; message: string };

// ─── save / load project ──────────────────────────────────────────────────────

export async function saveProjectToDb(payload: {
  id: string;
  userKey: string;
  title: string;
  idea: string;
  understood: unknown;
  productSpec: unknown;
  items: unknown;
  builtWith?: unknown;
  entryPath?: "idea" | "code" | "spec";
}): Promise<{ ok: true; id: string } | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.status === 429) return { ok: false, error: "rate_limited", message: "요청이 너무 많습니다." };
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as { ok: true; id: string };
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

/**
 * Best-effort server mirror of a project delete. The localStorage delete is
 * authoritative for the UI (the list reads local only); this removes the D1 rows
 * + R2 objects so an account never keeps an orphaned copy. Ownership is enforced
 * server-side; a 404 (never mirrored, or not owned) is reported but not fatal —
 * callers delete locally regardless.
 */
export async function deleteProjectFromDb(
  id: string,
  userKey: string,
): Promise<{ ok: true } | ApiError> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(id)}?userKey=${encodeURIComponent(userKey)}`,
      { method: "DELETE", signal: AbortSignal.timeout(10000) },
    );
    // A local-first project may never have been mirrored to D1 — a 404 (missing
    // or not-owned) means there is nothing to clean up server-side, which for an
    // idempotent delete is success, not a failure to surface.
    if (resp.status === 404) return { ok: true };
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

// ─── check-draft ─────────────────────────────────────────────────────────────

export type CheckDraftInput = {
  projectId?: string;
  /** Required by the server when projectId is present (ownership-gated persistence). */
  userKey?: string;
  productSpec: unknown;
  items: Array<{ id: string; title: string; status: string; criteria: string[] }>;
};

export async function callCheckDraftApi(
  input: CheckDraftInput,
): Promise<CheckDraftResponse | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/check-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, locale: "ko" }),
      signal: AbortSignal.timeout(25000),
    });
    if (resp.status === 429) {
      let msg = "잠시 후 다시 시도해주세요. 확인 요청이 너무 많이 발생했어요.";
      let retryAfterSeconds: number | undefined;
      try {
        const b = (await resp.json()) as { message?: string; retryAfterSeconds?: number };
        if (b.message) msg = b.message;
        if (b.retryAfterSeconds) retryAfterSeconds = b.retryAfterSeconds;
      } catch { /* ignore */ }
      return { ok: false, error: "rate_limited", message: msg, retryAfterSeconds };
    }
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as CheckDraftResponse;
  } catch (err) {
    console.warn("[check-api] network error:", err);
    return { ok: false, error: "network", message: String(err) };
  }
}

// ─── fix-suggestion ───────────────────────────────────────────────────────────

export type FixSuggestionInput = {
  projectId?: string;
  /** Required by the server when projectId is present (ownership-gated persistence). */
  userKey?: string;
  item: { id: string; title: string; status: string; criteria: string[] };
  checkResult: { reason: string; evidence: string[]; nextAction: string };
  productSpec: unknown;
};

export async function callFixSuggestionApi(
  input: FixSuggestionInput,
): Promise<FixSuggestionResponse | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/fix-suggestion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, locale: "ko" }),
      signal: AbortSignal.timeout(25000),
    });
    if (resp.status === 429) {
      let msg = "잠시 후 다시 시도해주세요.";
      try {
        const b = (await resp.json()) as { message?: string };
        if (b.message) msg = b.message;
      } catch { /* ignore */ }
      return { ok: false, error: "rate_limited", message: msg };
    }
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as FixSuggestionResponse;
  } catch (err) {
    console.warn("[fix-api] network error:", err);
    return { ok: false, error: "network", message: String(err) };
  }
}
