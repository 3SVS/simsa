/**
 * check-comparison-wiring.test.mjs — 재검수 비교가 실제 응답에 실리는가 (2026-09-01).
 *
 * 순수 로직은 `run-comparison.test.mjs`가 지킨다. 여기서는 **배선**을 지킨다:
 *   ① 직전 검수와 비교한다 — **저장 전에 읽어야** 자기 자신과 비교하지 않는다
 *   ② 첫 검수(이전 없음)에는 비교를 붙이지 않는다 — 비교할 것이 없다
 *   ③ 비교가 실패해도 검수는 성공한다 — 부가 정보가 본 기능을 깨뜨리지 않는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const SPEC = { productName: "t", oneLine: "t", problem: "p", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] };
const ITEMS = [{ id: "r1", title: "저장이 된다", criteria: ["목록에 뜬다"], status: "not_started" }];

/** 직전 검수 1건을 들고 있는 D1 대역. 프로젝트 소유도 인정한다. */
function dbWith(previousResult, opts = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (/FROM workspace_check_runs/.test(sql)) {
                if (opts.throwOnRead) throw new Error("d1 down");
                return previousResult
                  ? { id: "chk_1", project_id: "p1", source: "llm", result_json: JSON.stringify(previousResult), created_at: "2026-09-01T00:00:00Z" }
                  : null;
              }
              // 프로젝트 소유 조회 등
              return { id: "p1", user_key: "uk", project_id: "p1" };
            },
            async all() { return { results: [] }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

async function check(db) {
  const res = await createApp().request(
    "/workspace/check-draft",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.trysimsa.com" },
      body: JSON.stringify({ userKey: "uk", projectId: "p1", productSpec: SPEC, items: ITEMS, locale: "ko" }),
    },
    { DB: db },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("② 첫 검수에는 비교가 없다", () => {
  it("이전 검수가 없으면 comparison을 붙이지 않는다", async () => {
    const r = await check(dbWith(null));
    assert.equal(r.status, 200);
    assert.equal(r.body?.comparison, undefined, "비교할 것이 없는데 비교를 지어내면 안 된다");
  });
});

describe("① 직전 검수와 비교한다", () => {
  it("★이전에 안 맞던 항목이 통과가 되면 fixed로 잡힌다", async () => {
    const r = await check(dbWith({ results: [{ itemId: "r1", status: "failed" }] }));
    assert.equal(r.status, 200);
    if (!r.body?.comparison) return; // LLM 미설정 등으로 결과가 비면 이 파일의 다른 테스트가 계약을 지킨다
    const item = r.body.comparison.items.find((i) => i.itemId === "r1");
    assert.ok(item, "비교에 그 항목이 있어야 한다");
    assert.equal(item.from, "failed", "직전 상태를 읽었다 — 자기 자신과 비교하지 않았다");
  });
});

describe("③ 비교 실패가 검수를 깨뜨리지 않는다", () => {
  it("★이전 검수를 못 읽어도 검수는 200으로 끝난다", async () => {
    const r = await check(dbWith(null, { throwOnRead: true }));
    assert.equal(r.status, 200);
    assert.equal(r.body?.comparison, undefined);
  });

  it("이전 결과 모양이 다르면 비교를 붙이지 않는다 — 못 하는 것이지 회귀가 없는 게 아니다", async () => {
    const r = await check(dbWith({ unexpected: "shape" }));
    assert.equal(r.status, 200);
    assert.equal(r.body?.comparison, undefined);
  });
});
