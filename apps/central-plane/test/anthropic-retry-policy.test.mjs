/**
 * anthropic-retry-policy.test.mjs — A-1/A-2 (2026-08-21 라이브 QA 대응).
 *
 * 배경: 동일 페이로드 동시 4건 중 2건이 503으로 실패했다. 원인은 재시도 예산이
 * `500ms × attempt`(총 ~7.5초)뿐이라 **분 단위로 리셋되는 용량 오류(429/503/529)를
 * 넘지 못한 것**. 그 예산은 403(공유 egress) 전용으로 튜닝된 값이었다.
 *
 * 여기서 고정하는 계약:
 *   A-1 ① 용량 오류는 지수 백오프 + `retry-after` 우선
 *        ② egress성 오류(403 등)는 종전 공식 유지(무회귀)
 *        ③ 총 예산을 넘길 대기는 하지 않고 정직하게 실패
 *   A-2 ④ 실패도 한 줄 구조화 로그(`llm_failure`)로 원인 분류가 남는다
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

const { anthropicMessages, retryDelayMs, parseRetryAfterMs } = await import("../dist/workspace/anthropic-fetch.js");

const BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

const okResponse = () =>
  new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
const errResponse = (status, headers = {}) => new Response("upstream said no", { status, headers });

/**
 * 실제로 자지 않고 **가상 시계를 전진**시킨다 — 대기 값과 총 예산 계약을
 * 실시간 없이 검증하기 위함(mock at the seam).
 */
function recorder() {
  const slept = [];
  let clock = 1_000_000;
  return {
    slept,
    sleepImpl: async (ms) => { slept.push(ms); clock += ms; },
    nowImpl: () => clock,
    advance: (ms) => { clock += ms; },
  };
}

describe("retryDelayMs — 오류 종류별 대기 (A-1)", () => {
  it("용량 오류(429/503/529)는 지수 백오프 — 1s·2s·4s… 상한 6s", () => {
    for (const status of [429, 503, 529]) {
      const d1 = retryDelayMs(status, 1, null);
      const d2 = retryDelayMs(status, 2, null);
      const d3 = retryDelayMs(status, 3, null);
      // A′-4 equal jitter: [base/2, base*1.5]. rand를 고정해 결정론 검증.
      const mid = (a, n) => retryDelayMs(status, a, null, () => 0.5);
      assert.equal(mid(1), 1000, `${status} attempt1 중앙값`);
      assert.equal(mid(2), 2000, `${status} attempt2 중앙값`);
      assert.equal(mid(3), 4000, `${status} attempt3 중앙값`);
      assert.equal(retryDelayMs(status, 6, null, () => 1), 9000, "상한 6s의 최대 지터");
      assert.ok(retryDelayMs(status, 1, null, () => 0) === 500, "최소는 base/2");
    }
  });

  it("egress성 오류(403)와 네트워크 예외(null)는 종전 공식 유지 — 무회귀", () => {
    // 종전: 500 * attempt + 지터. 용량 오류보다 촘촘해야 한다.
    for (const status of [403, null]) {
      assert.ok(retryDelayMs(status, 1, null, () => 0.5) <= 500, `${status} attempt1`);
      assert.ok(retryDelayMs(status, 3, null, () => 0.5) <= 1500, `${status} attempt3`);
    }
    assert.ok(retryDelayMs(403, 2, null, () => 0.5) < retryDelayMs(429, 2, null, () => 0.5), "403이 429보다 짧다");
  });

  it("retry-after가 있으면 용량 백오프보다 우선한다", () => {
    assert.ok(retryDelayMs(429, 3, 800, () => 0.5) < 1300, "서버가 0.8s라면 4s를 기다리지 않는다");
    assert.ok(retryDelayMs(429, 1, 5000, () => 0) >= 5000, "서버가 5s라면 그만큼 기다린다(하한 준수)");
  });
});

describe("parseRetryAfterMs", () => {
  it("초 단위 숫자를 ms로", () => assert.equal(parseRetryAfterMs("2", Date.now()), 2000));
  it("HTTP date를 남은 시간으로", () => {
    const ms = parseRetryAfterMs(new Date(Date.now() + 3000).toUTCString(), Date.now());
    assert.ok(ms !== null && ms > 1000 && ms <= 3000);
  });
  it("없음·파싱불가·과대값은 무시", () => {
    assert.equal(parseRetryAfterMs(null, Date.now()), null);
    assert.equal(parseRetryAfterMs("soon", Date.now()), null);
    assert.equal(parseRetryAfterMs("9999", Date.now()), null);
  });
});

describe("anthropicMessages — 예산과 실패 로그 (A-1·A-2)", () => {
  it("용량 오류가 계속되면 총 예산에서 끊고 실패한다 (클라 타임아웃 전에)", async () => {
    const { slept, sleepImpl, nowImpl } = recorder();
    const fetchImpl = async () => errResponse(529);
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "check", { maxTotalMs: 5000, sleepImpl, nowImpl }),
      /Anthropic 529/,
    );
    const total = slept.reduce((a, b) => a + b, 0);
    assert.ok(total <= 5000, `누적 대기 ${total}ms 는 예산 이내여야 한다`);
    assert.ok(slept.length >= 1 && slept.length < 6, "예산에서 잘려 6회를 다 쓰지 않는다");
  });

  it("예산은 **대기 총합**만 센다 — 느린 호출(generate)도 재시도를 받는다", async () => {
    // 각 시도가 8초씩 걸리고 실패하는 상황: 요청 시간을 예산에 넣으면 첫 실패
    // 직후 예산이 소진돼 재시도가 0회가 된다. 대기만 세면 정상적으로 재시도한다.
    const { slept, sleepImpl, nowImpl, advance } = recorder();
    let n = 0;
    const fetchImpl = async () => {
      advance(8000); // 느린 요청
      return ++n < 3 ? errResponse(429) : okResponse();
    };
    const data = await anthropicMessages("k", BODY, 30_000, fetchImpl, "https://x/v1/messages", "generate", {
      maxTotalMs: 12_000,
      sleepImpl,
      nowImpl,
    });
    assert.equal(data.content[0].text, "ok");
    assert.equal(n, 3, "요청이 느려도 재시도가 이뤄져야 한다");
    assert.ok(slept.length === 2);
  });

  it("예산이 넉넉하면 재시도 후 성공한다", async () => {
    const { sleepImpl, nowImpl } = recorder();
    let n = 0;
    const fetchImpl = async () => (++n < 3 ? errResponse(429) : okResponse());
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "check", { maxTotalMs: 60_000, sleepImpl, nowImpl });
    assert.equal(data.content[0].text, "ok");
    assert.equal(n, 3);
  });

  it("403은 종전처럼 촘촘히 재시도해 회복한다 (무회귀)", async () => {
    const { slept, sleepImpl, nowImpl } = recorder();
    let n = 0;
    const fetchImpl = async () => (++n < 4 ? errResponse(403) : okResponse());
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "generate", { sleepImpl, nowImpl });
    assert.equal(data.content[0].text, "ok");
    assert.ok(slept.every((ms) => ms < 2000), "403 재시도는 촘촘하다");
  });

  it("재시도 불가 오류(400)는 즉시 던진다", async () => {
    const { slept, sleepImpl, nowImpl } = recorder();
    const fetchImpl = async () => errResponse(400);
    await assert.rejects(anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "check", { sleepImpl, nowImpl }), /Anthropic 400/);
    assert.equal(slept.length, 0, "재시도 없음");
  });

  it("A-2: 실패는 llm_failure 한 줄로 원인 분류와 함께 남는다", async () => {
    const logged = [];
    const orig = console.log;
    console.log = (...a) => { logged.push(String(a[0])); };
    try {
      const { sleepImpl, nowImpl } = recorder();
      const fetchImpl = async () => errResponse(529);
      await assert.rejects(
        anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "check", { maxTotalMs: 3000, sleepImpl, nowImpl }),
      );
    } finally {
      console.log = orig;
    }
    const line = logged.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((j) => j && j.event === "llm_failure");
    assert.ok(line, "llm_failure 로그가 있어야 한다");
    assert.equal(line.call_site, "check");
    assert.equal(line.final_status, 529);
    assert.equal(line.failure_class, "capacity", "용량 오류로 분류되어 집계 가능해야 한다");
    assert.ok(line.attempts >= 1);
    assert.equal(typeof line.latency_ms, "number");
  });

  it("A-2: egress성 실패는 capacity와 구분되어 분류된다", async () => {
    const logged = [];
    const orig = console.log;
    console.log = (...a) => { logged.push(String(a[0])); };
    try {
      const { sleepImpl, nowImpl } = recorder();
      const fetchImpl = async () => errResponse(403);
      await assert.rejects(anthropicMessages("k", BODY, 1000, fetchImpl, "https://x/v1/messages", "fix", { sleepImpl, nowImpl }));
    } finally {
      console.log = orig;
    }
    const line = logged.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((j) => j && j.event === "llm_failure");
    assert.ok(line);
    assert.equal(line.failure_class, "egress");
  });
});

describe("A′-4 — 지터가 동시 요청의 재시도를 흩는다", () => {
  it("★같은 순간 실패한 요청들의 재시도 시각이 서로 달라진다 (종전엔 완전 동기화)", () => {
    // 동시에 실패한 8건이 각자 다른 난수를 받으면 재시도 시각이 흩어져야 한다.
    // 종전 결정론 지터에서는 8건 모두 같은 값이 나와 재시도가 뭉쳐 다녔다.
    const delays = Array.from({ length: 8 }, (_, i) => retryDelayMs(403, 1, null, () => i / 8));
    const unique = new Set(delays);
    assert.ok(unique.size >= 6, `재시도 시각이 흩어져야 한다 — 서로 다른 값 ${unique.size}/8`);
    const spread = Math.max(...delays) - Math.min(...delays);
    assert.ok(spread >= 300, `분산이 충분해야 한다 — 폭 ${spread}ms`);
  });

  it("흩뿌려도 하한이 있어 폭주하지 않는다 (base/2 이상, base*1.5 이하)", () => {
    for (const attempt of [1, 2, 3]) {
      const lo = retryDelayMs(403, attempt, null, () => 0);
      const hi = retryDelayMs(403, attempt, null, () => 1);
      const base = 500 * attempt;
      assert.equal(lo, base / 2);
      assert.equal(hi, Math.round(base * 1.5));
    }
  });

  it("retry-after는 하한으로 존중하고 그 위에만 흩뿌린다", () => {
    const lo = retryDelayMs(429, 2, 2000, () => 0);
    const hi = retryDelayMs(429, 2, 2000, () => 1);
    assert.equal(lo, 2000, "서버 지시보다 일찍 가지 않는다");
    assert.ok(hi > 2000 && hi <= 2500, "그 위에서만 흩어진다");
  });
});
