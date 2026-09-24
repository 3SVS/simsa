/**
 * SI 티어 Train B — B1: 빌더 컨테이너 자가점검 프로브.
 *
 *   GET /internal/builder/selfcheck — BUILDER 컨테이너를 한 번 띄워 `/selfcheck`를 동기로 부르고
 *                                    툴체인(node·pnpm·git·gh·wrangler)·작업 디렉터리·소요 시간을 돌려준다.
 *
 * 왜 있나: B1 완료 조건은 "기동 확인 + 30초 내 pnpm -v"다. `wrangler containers` CLI는
 * 노트북에 토큰이 없어 못 쓰고(2026-09-24 실측), 컨테이너 stdout은 tail에 안 나온다(2026-07-20
 * 실측). 그래서 **Worker를 경유한 라이브 프로브**가 유일한 증거 경로다. llm-probe와 같은
 * 관측 전용 토큰 게이트(LLM_PROBE_TOKEN ?? INTERNAL_CALLBACK_TOKEN).
 *
 * 정직성: 바인딩이 없으면 503 builder_unavailable, 컨테이너가 실패하면 그 본문을 그대로
 * 전달한다 — "정상"을 꾸미지 않는다.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";

/** 프로브 응답 정규화 — 컨테이너 JSON을 그대로 신뢰하지 않고 필요한 필드만 뽑는다(순수, 테스트 대상). */
export function summarizeSelfCheck(body: unknown, elapsedMs: number): {
  ok: boolean;
  runnerRev: string | null;
  tools: Array<{ name: string; ok: boolean; version: string | null; ms: number }>;
  forbiddenPresent: string[];
  workRootOk: boolean | null;
  containerMs: number | null;
  elapsedMs: number;
} {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const toolsRaw = Array.isArray(b["tools"]) ? b["tools"] : [];
  const tools = toolsRaw
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      name: String(t["name"] ?? "").slice(0, 20),
      ok: t["ok"] === true,
      version: typeof t["version"] === "string" ? t["version"].slice(0, 40) : null,
      ms: typeof t["ms"] === "number" ? t["ms"] : -1,
    }));
  const workRoot = (typeof b["workRoot"] === "object" && b["workRoot"] !== null ? b["workRoot"] : null) as Record<string, unknown> | null;
  return {
    ok: b["ok"] === true,
    runnerRev: typeof b["runnerRev"] === "string" ? b["runnerRev"] : null,
    tools,
    forbiddenPresent: Array.isArray(b["forbiddenPresent"]) ? b["forbiddenPresent"].filter((x): x is string => typeof x === "string") : [],
    workRootOk: workRoot ? workRoot["ok"] === true : null,
    containerMs: typeof b["totalMs"] === "number" ? b["totalMs"] : null,
    elapsedMs,
  };
}

const SELFCHECK_TIMEOUT_MS = 90_000;

export function createBuilderProbeRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/internal/builder/selfcheck", async (c) => {
    const expected = c.env.LLM_PROBE_TOKEN ?? c.env.INTERNAL_CALLBACK_TOKEN;
    if (!expected) return c.json({ ok: false, error: "probe_disabled" }, 503);
    const auth = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || m[1] !== expected) return c.json({ ok: false, error: "unauthorized" }, 401);

    if (!c.env.BUILDER) return c.json({ ok: false, error: "builder_unavailable" }, 503);

    // 자가점검은 잡이 아니므로 고정 이름 하나 — 매번 새 인스턴스를 만들지 않는다.
    const id = c.env.BUILDER.idFromName("build-selfcheck");
    const stub = c.env.BUILDER.get(id);
    const t0 = Date.now();
    try {
      const r = await stub.fetch("http://builder/selfcheck", { method: "GET", signal: AbortSignal.timeout(SELFCHECK_TIMEOUT_MS) });
      const body: unknown = await r.json().catch(() => null);
      const summary = summarizeSelfCheck(body, Date.now() - t0);
      console.log(JSON.stringify({ event: "builder_selfcheck", ok: summary.ok, status: r.status, runnerRev: summary.runnerRev, elapsedMs: summary.elapsedMs }));
      return c.json({ ...summary, containerStatus: r.status }, summary.ok ? 200 : 503);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      console.log(JSON.stringify({ event: "builder_selfcheck", ok: false, error: message, elapsedMs: Date.now() - t0 }));
      return c.json({ ok: false, error: "container_fetch_failed", detail: message, elapsedMs: Date.now() - t0 }, 503);
    }
  });

  return app;
}
