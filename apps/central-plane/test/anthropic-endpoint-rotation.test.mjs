/**
 * anthropic-endpoint-rotation.test.mjs — A′-1 (2026-08-21 실측 대응).
 *
 * A-2 계측이 밝힌 진범: 용량(429/529)이 아니라 **403 egress**. 라이브 로그상
 * `attempt 1~6 got 403` — 재시도 6회가 **모두 같은 경로**로 나가 통째로 막혔다.
 *
 * 여기서 고정하는 계약:
 *   ① 게이트웨이가 설정돼 있으면 시도마다 경로를 번갈아 쓴다(gateway↔direct)
 *   ② 한 경로가 403으로 막혀도 다른 경로가 열려 있으면 회복한다
 *   ③ 게이트웨이 미설정이면 직행만 — 종전 동작 무회귀
 *   ④ 성공·실패 로그 모두 endpoint_kind를 남겨 **경로별 성공률 집계**가 가능하다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { anthropicMessages, endpointRotation, DIRECT_ANTHROPIC_ENDPOINT } =
  await import("../dist/workspace/anthropic-fetch.js");

const GATEWAY = "https://gateway.ai.cloudflare.com/v1/acct/simsa/anthropic/v1/messages";
const BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

const ok = () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
const forbidden = () => new Response('{"type":"forbidden","message":"Request not allowed"}', { status: 403 });

function recorder() {
  const slept = [];
  let clock = 1_000_000;
  return { slept, sleepImpl: async (ms) => { slept.push(ms); clock += ms; }, nowImpl: () => clock };
}

/** console.log을 가로채 구조화 로그만 걷어온다. */
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(String(a[0])); };
  try { return { result: await fn(), lines }; }
  catch (err) { return { error: err, lines }; }
  finally { console.log = orig; }
}
const jsonLines = (lines) => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

describe("endpointRotation (A′-1 ①③)", () => {
  it("게이트웨이가 있으면 gateway → direct 두 경로", () => {
    assert.deepEqual(endpointRotation(GATEWAY), [
      { url: GATEWAY, kind: "gateway" },
      { url: DIRECT_ANTHROPIC_ENDPOINT, kind: "direct" },
    ]);
  });

  it("게이트웨이 미설정(직행 URL)이면 직행 하나 — 무회귀", () => {
    assert.deepEqual(endpointRotation(DIRECT_ANTHROPIC_ENDPOINT), [
      { url: DIRECT_ANTHROPIC_ENDPOINT, kind: "direct" },
    ]);
    assert.equal(endpointRotation("").length, 1);
  });
});

describe("anthropicMessages — 경로 교대 (A′-1 ②)", () => {
  it("시도마다 경로가 번갈아 나간다", async () => {
    const { sleepImpl, nowImpl } = recorder();
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return forbidden(); };
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", { maxTotalMs: 60_000, sleepImpl, nowImpl }),
      /Anthropic 403/,
    );
    assert.equal(urls.length, 6, "6회 시도");
    assert.equal(urls[0], GATEWAY);
    assert.equal(urls[1], DIRECT_ANTHROPIC_ENDPOINT);
    assert.equal(urls[2], GATEWAY);
    assert.equal(urls[3], DIRECT_ANTHROPIC_ENDPOINT);
    const gw = urls.filter((u) => u === GATEWAY).length;
    assert.equal(gw, 3, "두 경로가 균등하게 3회씩");
  });

  it("★게이트웨이가 403으로 막혀도 직행이 열려 있으면 회복한다 (라이브 결함의 형태)", async () => {
    const { sleepImpl, nowImpl } = recorder();
    let gwCalls = 0;
    const fetchImpl = async (url) => {
      if (url === GATEWAY) { gwCalls++; return forbidden(); }
      return ok();
    };
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", { sleepImpl, nowImpl });
    assert.equal(data.content[0].text, "ok");
    assert.equal(gwCalls, 1, "게이트웨이 1회 실패 후 직행에서 바로 성공");
  });

  it("반대 방향도 성립한다 — 직행이 막히고 게이트웨이가 열린 경우", async () => {
    const { sleepImpl, nowImpl } = recorder();
    let n = 0;
    const fetchImpl = async (url) => {
      n++;
      if (url === DIRECT_ANTHROPIC_ENDPOINT) return forbidden();
      return n === 1 ? forbidden() : ok(); // 첫 게이트웨이는 실패, 세 번째 시도(게이트웨이)에서 성공
    };
    const data = await anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "generate", { sleepImpl, nowImpl });
    assert.equal(data.content[0].text, "ok");
    assert.equal(n, 3);
  });

  it("게이트웨이 미설정이면 직행만 6회 — 종전 동작 무회귀", async () => {
    const { sleepImpl, nowImpl } = recorder();
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return forbidden(); };
    await assert.rejects(
      anthropicMessages("k", BODY, 1000, fetchImpl, DIRECT_ANTHROPIC_ENDPOINT, "check", { maxTotalMs: 60_000, sleepImpl, nowImpl }),
    );
    assert.ok(urls.every((u) => u === DIRECT_ANTHROPIC_ENDPOINT));
  });
});

describe("경로별 계측 (A′-1 ④)", () => {
  it("성공 로그에 endpoint_kind와 몇 번째 시도였는지가 남는다", async () => {
    const { sleepImpl, nowImpl } = recorder();
    const fetchImpl = async (url) => (url === GATEWAY ? forbidden() : ok());
    const { lines } = await captureLogs(() =>
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", { sleepImpl, nowImpl }),
    );
    const usage = jsonLines(lines).find((j) => j.event === "anthropic_usage");
    assert.ok(usage, "성공 로그가 있어야 한다");
    assert.equal(usage.endpoint_kind, "direct", "성공한 경로가 기록된다");
    assert.equal(usage.attempt, 2);
  });

  it("실패 로그에 경로별 시도 횟수가 남는다 — 어느 출구가 막히는지 집계 가능", async () => {
    const { sleepImpl, nowImpl } = recorder();
    const fetchImpl = async () => forbidden();
    const { lines } = await captureLogs(() =>
      anthropicMessages("k", BODY, 1000, fetchImpl, GATEWAY, "check", { maxTotalMs: 60_000, sleepImpl, nowImpl }),
    );
    const fail = jsonLines(lines).find((j) => j.event === "llm_failure");
    assert.ok(fail);
    assert.equal(fail.failure_class, "egress");
    assert.deepEqual(fail.tried_by_endpoint, { gateway: 3, direct: 3 });
  });
});
