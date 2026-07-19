"use client";

/**
 * Dashboard client for workspace check/fix/project endpoints.
 * Rate limit 429 → no fallback (propagated to UI).
 * Network/server errors → local heuristic fallback where possible.
 */

import { isExampleProject } from "./mock-data";
import { readStoredLocale } from "@/i18n/dictionary.mjs";

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
  /** RC-2 검증 패널 / RC-3 협의체: 판정의 확인 방식 (없으면 미적용 판정). */
  verification?: "dual_confirmed" | "downgraded" | "single" | "council_agreed" | "council_split";
};

export type CheckDraftResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  results: CheckResultItem[];
  warnings?: string[];
  /** RC-3/RC-4: 이 결과를 만든 검수 방식. 생략 = panel(기본). */
  reviewMode?: "panel" | "council";
  /** RC-3 협의체 메타 — 참여 AI·라운드·불일치 수 (투명성). */
  council?: { vendors: string[]; rounds: number; disagreements: number };
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
  | { ok: false; error: "plan"; message: string }
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
  // Example projects are shared demo fixtures — never mirror them. Writing the
  // fixed shared id would claim it globally (first-writer-owns) and permanently
  // 404 every other user's repo-link on the example. There is nothing to sync
  // for a demo, so "nothing to do" is success (no sync-failed banner).
  if (isExampleProject(payload.id)) return { ok: true, id: payload.id };
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
  /** RC-4: "panel"(기본) | "council"(유료 선택). 서버가 자격을 집행한다. */
  reviewMode?: "panel" | "council";
};

export async function callCheckDraftApi(
  input: CheckDraftInput,
): Promise<CheckDraftResponse | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/check-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 서버 검수 프롬프트가 아직 KO-only — locale 전달은 G14-b(서버 EN화)와 함께.
      body: JSON.stringify({ ...input, locale: "ko" }),
      // council(협의체)은 다중 모델 2라운드라 기본 검수보다 오래 걸린다.
      signal: AbortSignal.timeout(input.reviewMode === "council" ? 90000 : 25000),
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
    // RC-4: 402 = 플랜 부족, 503 council_not_ready = 준비 중 — 서버 메시지를
    // 그대로 보여준다 (일반 서버 오류로 뭉개지 않는다).
    if (resp.status === 402 || resp.status === 503) {
      try {
        const b = (await resp.json()) as { error?: string; message?: string };
        if (b.error === "plan_required" || b.error === "council_not_ready") {
          return { ok: false, error: "plan", message: b.message ?? "이 검수 방식은 지금 플랜에서 사용할 수 없어요." };
        }
      } catch { /* fall through */ }
      return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    }
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    return (await resp.json()) as CheckDraftResponse;
  } catch (err) {
    console.warn("[check-api] network error:", err);
    return { ok: false, error: "network", message: String(err) };
  }
}

// ─── unstick (G2) ────────────────────────────────────────────────────────────

export type UnstickResponse = {
  ok: true;
  source: "llm";
  whatHappened: string;
  nextSteps: string[];
  askAgentMessage?: string;
};

/** G2 막힘 도우미 — 서버와 같은 정직 계약: 실패 시 날조 없이 오류로. */
export async function callUnstickApi(input: {
  problemText: string;
  projectId?: string;
  userKey?: string;
  productName?: string;
  buildTool?: string;
}): Promise<UnstickResponse | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/unstick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // G14: unstick은 서버 EN 지원 — UI 언어를 따른다.
      body: JSON.stringify({ ...input, locale: readStoredLocale(typeof window !== "undefined" ? window.localStorage : null) }),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.status === 429) {
      let msg = "잠시 후 다시 시도해주세요. 요청이 많이 발생했어요.";
      try {
        const b = (await resp.json()) as { message?: string };
        if (b.message) msg = b.message;
      } catch { /* default */ }
      return { ok: false, error: "rate_limited", message: msg };
    }
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    const data = (await resp.json()) as UnstickResponse;
    if (!data.ok || typeof data.whatHappened !== "string" || !Array.isArray(data.nextSteps)) {
      return { ok: false, error: "server", message: "bad_shape" };
    }
    return data;
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

// ─── project list/detail (G8 D-2 restore) ────────────────────────────────────

export type RemoteProjectSummary = { id: string; title: string; idea: string; createdAt: string; updatedAt: string };

/** 소유 프로젝트 서버 목록 — 복원 차집합 계산용. 실패 시 빈 목록(복원 카드만 안 뜸). */
export async function listProjectsFromDb(userKey: string): Promise<RemoteProjectSummary[]> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects?userKey=${encodeURIComponent(userKey)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const b = (await resp.json()) as { ok?: boolean; projects?: RemoteProjectSummary[] };
    return b.ok && Array.isArray(b.projects) ? b.projects : [];
  } catch {
    return [];
  }
}

/** 단건 전체 페이로드 — 복원 실행용 (owned 게이트). */
export async function loadProjectFromDb(
  id: string,
  userKey: string,
): Promise<{ ok: true; project: { id: string; title?: string; idea?: string; productSpec?: unknown; items?: unknown[]; createdAt?: string } } | { ok: false }> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(id)}?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return { ok: false };
    const b = (await resp.json()) as { ok?: boolean; project?: { id: string } };
    if (!b.ok || !b.project || typeof b.project.id !== "string") return { ok: false };
    return { ok: true, project: b.project };
  } catch {
    return { ok: false };
  }
}

// ─── project ext sync (G8 D-1) ───────────────────────────────────────────────

/**
 * ExtendedProjectData 서버 정본 upsert — fire-and-forget용 (DR-2). 예시/체험
 * 프로젝트는 미러 대상 아님(호출측 가드). 404 = 프로젝트가 아직 미러 전 —
 * 실패가 아니라 "다음 저장에서 자연 재시도"이므로 ok:true로 삼키지 않고
 * 구분해 돌려준다(호출측이 sync-failed 마킹을 건너뛰게).
 */
export async function saveExtToDb(
  projectId: string,
  userKey: string,
  ext: unknown,
): Promise<{ ok: true } | { ok: false; error: "not_mirrored" | "server" | "network" }> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/ext`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, ext }),
        signal: AbortSignal.timeout(10000),
        keepalive: true,
      },
    );
    if (resp.status === 404) return { ok: false, error: "not_mirrored" };
    if (!resp.ok) return { ok: false, error: "server" };
    return { ok: true };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** G8 D-2에서 복원 흐름이 사용 — 소유자만 조회. */
export async function loadExtFromDb(
  projectId: string,
  userKey: string,
): Promise<{ ok: true; ext: unknown; updatedAt: string } | { ok: false }> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/ext?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return { ok: false };
    const b = (await resp.json()) as { ok?: boolean; ext?: unknown; updatedAt?: string };
    if (!b.ok || typeof b.ext !== "object" || b.ext === null) return { ok: false };
    return { ok: true, ext: b.ext, updatedAt: b.updatedAt ?? "" };
  } catch {
    return { ok: false };
  }
}

// ─── shares (G11) ────────────────────────────────────────────────────────────

export type SharePayload = {
  title: string;
  oneLine?: string;
  problem?: string;
  included?: string[];
  excluded?: string[];
  decisions?: string[];
  openQuestions?: string[];
  items?: Array<{ title: string; status: string; userLabel?: string; reason?: string; criteria?: string[] }>;
  summary?: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  sharedAtLabel?: string;
};

/** G11: 공유 시점 스냅샷 생성 — 응답은 shareId(추측 불가). */
export async function callCreateShareApi(input: {
  userKey: string;
  projectId?: string;
  payload: SharePayload;
}): Promise<{ ok: true; shareId: string } | ApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });
    if (resp.status === 429) {
      let msg = "잠시 후 다시 시도해주세요.";
      try { const b = (await resp.json()) as { message?: string }; if (b.message) msg = b.message; } catch { /* default */ }
      return { ok: false, error: "rate_limited", message: msg };
    }
    if (!resp.ok) return { ok: false, error: "server", message: `HTTP ${resp.status}` };
    const b = (await resp.json()) as { ok?: boolean; shareId?: string };
    if (!b.ok || typeof b.shareId !== "string") return { ok: false, error: "server", message: "bad_shape" };
    return { ok: true, shareId: b.shareId };
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

/** G11: 공개 열람 — revoked/없음은 동일한 not_found. */
export async function callGetShareApi(
  shareId: string,
): Promise<{ ok: true; payload: SharePayload; createdAt: string } | { ok: false }> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/shares/${encodeURIComponent(shareId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { ok: false };
    const b = (await resp.json()) as { ok?: boolean; payload?: SharePayload; createdAt?: string };
    if (!b.ok || !b.payload || typeof b.payload.title !== "string") return { ok: false };
    return { ok: true, payload: b.payload, createdAt: b.createdAt ?? "" };
  } catch {
    return { ok: false };
  }
}

// ─── plan (RC-4) ─────────────────────────────────────────────────────────────

/** Resolve the user's plan for review-mode gating. Failure → "free" (UI keeps B locked). */
export async function callGetPlanApi(userKey: string): Promise<"free" | "paid"> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/plan?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return "free";
    const b = (await resp.json()) as { ok?: boolean; plan?: string };
    return b.ok && b.plan === "paid" ? "paid" : "free";
  } catch {
    return "free";
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
