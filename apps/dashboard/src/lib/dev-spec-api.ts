/**
 * dev-spec-api.ts — T0 개발 지시서 API 클라이언트 (SI 티어 A4).
 *
 *   POST /workspace/projects/:id/dev-spec/generate  → 생성 + 저장 (서버가 무결성 통과본만 돌려준다)
 *   GET  /workspace/projects/:id/dev-spec?userKey=   → 저장본 조회 (없으면 no_dev_spec)
 *
 * 실패는 종류를 살려 돌려준다 — 화면이 "다시 시도"와 "지금은 불가"를 구분해 말해야 한다
 * (정직성 규칙: 예시로 대체하지 않는다).
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";

export type DevSpecApiError =
  | { ok: false; error: "llm_unavailable" }
  | { ok: false; error: "dev_spec_invalid"; stage: "schema" | "integrity"; issueCount: number }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "no_dev_spec" }
  | { ok: false; error: "server"; status: number }
  | { ok: false; error: "network"; message: string };

export type DevSpecSummary = {
  what: string;
  screenCount: number;
  entityCount: number;
  excluded: string[];
  mustFeatureTitles: string[];
};

export type DevSpecGenerateOk = { ok: true; devSpec: unknown; summary: DevSpecSummary; repaired: boolean; updatedAt: string };
export type DevSpecGetOk = { ok: true; devSpec: unknown; updatedAt: string | null };

export async function generateDevSpecApi(
  projectId: string,
  userKey: string,
  locale: "ko" | "en",
): Promise<DevSpecGenerateOk | DevSpecApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/dev-spec/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, locale }),
      // 세 패스 × 최대 120초 — 한 번의 생성이 몇 분 걸릴 수 있다.
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body["ok"] === true) return body as unknown as DevSpecGenerateOk;
    if (resp.status === 429) return { ok: false, error: "rate_limited", retryAfterSeconds: Number(body["retryAfterSeconds"] ?? 3600) };
    if (resp.status === 404) return { ok: false, error: "not_found" };
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
