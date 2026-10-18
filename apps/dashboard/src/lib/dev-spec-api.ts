/**
 * dev-spec-api.ts — T0 개발 지시서 API 클라이언트 (SI 티어 A4).
 *
 *   POST /workspace/projects/:id/dev-spec/generate  → 생성 + 저장 (서버가 무결성 통과본만 돌려준다)
 *   GET  /workspace/projects/:id/dev-spec?userKey=   → 저장본 조회 (없으면 no_dev_spec)
 *
 * 실패는 종류를 살려 돌려준다 — 화면이 "다시 시도"와 "지금은 불가"를 구분해 말해야 한다
 * (정직성 규칙: 예시로 대체하지 않는다).
 */

import { capacityFromResponse, type GenerationCapacityError } from "./generation-capacity.mjs";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";

export type DevSpecApiError =
  | { ok: false; error: "llm_unavailable" }
  /** 비용 권고 ③ — today's dev-spec capacity (service-wide) is full; no AI call was made. */
  | GenerationCapacityError
  | { ok: false; error: "dev_spec_invalid"; stage: "schema" | "integrity"; issueCount: number }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "no_dev_spec" }
  /** 2026-10-18: 지시서가 이미 있다 — 기획을 바꿨다고 명시(reason:"plan_changed")해야 다시 뽑는다. AI 호출 없었음. */
  | { ok: false; error: "dev_spec_exists"; acCount: number }
  | { ok: false; error: "server"; status: number }
  | { ok: false; error: "network"; message: string };

/** 기획 변경 재생성 때 서버가 돌려주는 이전 기준과의 차이(같은 기준 = 제목+결과가 같은 것, id 무관). */
export type DevSpecAcDiff = {
  added: Array<{ id: string; title: string; then: string }>;
  removed: Array<{ id: string; title: string; then: string }>;
  kept: Array<{ prevId: string; nextId: string; title: string }>;
};

export type DevSpecSummary = {
  what: string;
  screenCount: number;
  entityCount: number;
  excluded: string[];
  mustFeatureTitles: string[];
};

export type DevSpecGenerateOk = { ok: true; devSpec: unknown; summary: DevSpecSummary; repaired: boolean; updatedAt: string; diff?: DevSpecAcDiff };
export type DevSpecGetOk = { ok: true; devSpec: unknown; updatedAt: string | null };

export async function generateDevSpecApi(
  projectId: string,
  userKey: string,
  locale: "ko" | "en",
  /**
   * C-A7 (D-2 amend): 기존 앱 문에서 유저가 확인한 항목 id. 서버가 역추론 지시서의
   * userConfirmedAcIds로 바꾼다 — must는 여기서만 나온다. 없으면 보내지 않는다(서버 = 빈 배열).
   */
  opts: {
    confirmedItemIds?: readonly string[];
    /** 2026-10-18: 지시서가 이미 있을 때 다시 뽑는 유일한 길 — 사용자가 "기획을 바꿨다"고 명시한 때만 보낸다. */
    reason?: "plan_changed";
  } = {},
): Promise<DevSpecGenerateOk | DevSpecApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/dev-spec/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userKey,
        locale,
        ...(opts.confirmedItemIds ? { confirmedItemIds: [...opts.confirmedItemIds].slice(0, 60) } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
      }),
      // 세 패스 × 최대 120초 — 한 번의 생성이 몇 분 걸릴 수 있다.
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });
    const capacity = await capacityFromResponse(resp);
    if (capacity) return { ok: false, error: "generation_capacity", resetAt: capacity.resetAt };
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body["ok"] === true) return body as unknown as DevSpecGenerateOk;
    if (resp.status === 429) return { ok: false, error: "rate_limited", retryAfterSeconds: Number(body["retryAfterSeconds"] ?? 3600) };
    if (resp.status === 404) return { ok: false, error: "not_found" };
    if (resp.status === 409 && body["error"] === "dev_spec_exists") return { ok: false, error: "dev_spec_exists", acCount: Number(body["acCount"] ?? 0) };
    if (resp.status === 503) return { ok: false, error: "llm_unavailable" };
    if (resp.status === 422) {
      const issues = Array.isArray(body["issues"]) ? body["issues"].length : 0;
      return { ok: false, error: "dev_spec_invalid", stage: body["stage"] === "schema" ? "schema" : "integrity", issueCount: issues };
    }
    return { ok: false, error: "server", status: resp.status };
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}

export async function getDevSpecApi(projectId: string, userKey: string): Promise<DevSpecGetOk | DevSpecApiError> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/dev-spec?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body["ok"] === true) return { ok: true, devSpec: body["devSpec"], updatedAt: typeof body["updatedAt"] === "string" ? body["updatedAt"] : null };
    if (resp.status === 404) return { ok: false, error: body["error"] === "no_dev_spec" ? "no_dev_spec" : "not_found" };
    return { ok: false, error: "server", status: resp.status };
  } catch (err) {
    return { ok: false, error: "network", message: String(err) };
  }
}
