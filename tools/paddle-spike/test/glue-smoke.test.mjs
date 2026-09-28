/**
 * 글루 스모크 — 진입 스크립트를 실제 프로세스로 돌리되 fetch 는 메모리 가짜 Paddle(fake-paddle.mjs)로 바꾼다.
 * 네트워크 0. **Paddle 동작의 증거가 아니다**(가짜는 "trialing /charge → 즉시 completed"를 가정) —
 * 확인하는 것은 우리 쪽 배선뿐:
 *  ① setup 멱등(두 번 돌려도 상품 2·가격 4) · $0 가격 거부 시 rejected 로 기록하고 계속
 *  ② 풀 → 시나리오 → 증거 파일 흐름(S-A~S-F), 시나리오별 구독 소비 기록
 *  ③ 증거에 키·포털 URL 토큰이 없고 한글 프로젝트명은 그대로
 *  ④ 풀이 비었거나 관측 시점 전이면 코드 3(실행 대기) — 성공으로 세지 않는다
 *  ⑤ verdict 가 증거 파일을 읽어 판정
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAKE_SANDBOX_KEY, KO_PROJECT_NAME, fakeId, fakeTrialingSubscription } from "./helpers/fakes.mjs";

const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = pathToFileURL(join(SPIKE_DIR, "test", "helpers", "fake-paddle.mjs")).href;

function makeEnv(tmp, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("PADDLE_") && v !== undefined) env[k] = v;
  return {
    ...env,
    PADDLE_SPIKE_ENV_FILE: join(tmp, "none.env.local"),
    PADDLE_SPIKE_EVIDENCE_DIR: join(tmp, "evidence"),
    PADDLE_FAKE_STATE: join(tmp, "fake-state.json"),
    PADDLE_SANDBOX_API_KEY: FAKE_SANDBOX_KEY,
    PADDLE_SPIKE_SETTLE_MS: "0",
    ...extra,
  };
}
function run(env, script, ...args) {
  const res = spawnSync(process.execPath, ["--import", FAKE, join(SPIKE_DIR, script), ...args], { cwd: SPIKE_DIR, env, encoding: "utf8", timeout: 60_000 });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const ev = (env, name) => readJson(join(env.PADDLE_SPIKE_EVIDENCE_DIR, `${name}.json`));

describe("① setup 멱등 · $0 가격 관측", () => {
  it("두 번 돌려도 상품 2 · 가격 4, 두 번째는 전부 existing", () => {
    const env = makeEnv(mkdtempSync(join(tmpdir(), "paddle-glue-setup-")));
    const r1 = run(env, "setup.mjs");
    assert.equal(r1.status, 0, r1.out);
    const c1 = ev(env, "catalog");
    assert.deepEqual(Object.values(c1.prices).map((p) => p.status), ["created", "created", "created", "created"]);
    assert.equal(c1.zeroPriceAccepted, true);
    const r2 = run(env, "setup.mjs");
    assert.equal(r2.status, 0, r2.out);
    const c2 = ev(env, "catalog");
    assert.deepEqual(Object.values(c2.prices).map((p) => p.status), ["existing", "existing", "existing", "existing"]);
    assert.deepEqual(c2.prices.build_once_199.id, c1.prices.build_once_199.id);
    const state = readJson(env.PADDLE_FAKE_STATE);
    assert.equal(state.products.length, 2);
    assert.equal(state.prices.length, 4);
  });

  it("$0 반복 가격이 거부되면 rejected 로 기록하고 종료 코드 0(관측 결과이지 오류가 아님)", () => {
    const env = makeEnv(mkdtempSync(join(tmpdir(), "paddle-glue-zero-")), { PADDLE_FAKE_REJECT_ZERO: "1" });
    const r = run(env, "setup.mjs");
    assert.equal(r.status, 0, r.out);
    const c = ev(env, "catalog");
    assert.equal(c.prices.card_trial_0.status, "rejected");
    assert.equal(c.prices.card_trial_0.error.code, "fake_zero_recurring_not_allowed");
    assert.equal(c.zeroPriceAccepted, false);
  });
});

describe("② ~ ⑤ 풀 → 시나리오 → 증거 → 판정", () => {
  const tmp = mkdtempSync(join(tmpdir(), "paddle-glue-flow-"));
  const env = makeEnv(tmp);
  const subs = ["sa", "sb", "sc", "sf1", "sf2"].map((s) => fakeId("sub", s));

  before(() => {
    const r = run(env, "setup.mjs");
    assert.equal(r.status, 0, r.out);
    const catalog = ev(env, "catalog");
    const state = readJson(env.PADDLE_FAKE_STATE);
    state.subscriptions = subs.map((id) => fakeTrialingSubscription(id, catalog.prices.card_trial_19.id));
    writeFileSync(env.PADDLE_FAKE_STATE, JSON.stringify(state), "utf8");
    mkdirSync(env.PADDLE_SPIKE_EVIDENCE_DIR, { recursive: true });
    const entries = subs.map((id, i) => ({ subscriptionId: id, transactionId: null, variant: i === 0 ? "trial0" : "trial19", createdAt: "2026-10-01T00:00:00Z", usedBy: null }));
    writeFileSync(join(env.PADDLE_SPIKE_EVIDENCE_DIR, "pool.json"), JSON.stringify({ entries }), "utf8");
  });

  it("S-A: trialing 에 /charge → 거래 정산 관측, trial0 구독을 우선 사용", () => {
    const r = run(env, "scenarios.mjs", "S-A");
    assert.equal(r.status, 0, r.out);
    const sa = ev(env, "S-A");
    assert.equal(sa.subscriptionId, subs[0]);
    assert.equal(sa.observations.directCharge.httpOk, true);
    assert.equal(sa.observations.directCharge.transactionStatus, "completed");
    assert.match(sa.observations.directCharge.transactionId, /^txn_[a-z\d]{26}$/);
    assert.deepEqual(sa.steps.map((s) => s.name).slice(0, 3), ["get subscription (before)", "preview charge $199", "charge $199 immediately"]);
  });

  it("S-B: 즉시 취소 → 청구 0", () => {
    const r = run(env, "scenarios.mjs", "S-B");
    assert.equal(r.status, 0, r.out);
    const sb = ev(env, "S-B");
    assert.equal(sb.observations.subscriptionStatusAfter, "canceled");
    assert.equal(sb.observations.zeroCharge.ok, true);
  });

  it("S-C: cancel 예약 생성 → /charge 뒤 예약 비교", () => {
    const r = run(env, "scenarios.mjs", "S-C");
    assert.equal(r.status, 0, r.out);
    const sc = ev(env, "S-C");
    assert.equal(sc.observations.scheduledCancelCreated, true);
    assert.equal(typeof sc.observations.scheduledChange.changed, "boolean");
  });

  it("S-D: S-A 구독에 두 번째 청구 → 청구 거래 2건", () => {
    const r = run(env, "scenarios.mjs", "S-D");
    assert.equal(r.status, 0, r.out);
    const sd = ev(env, "S-D");
    assert.equal(sd.subscriptionId, subs[0]);
    assert.equal(sd.observations.chargeTransactionsOnSubscription.length, 2);
  });

  it("S-E --no-wait: S-A 청구 거래에 전액 환불 조정", () => {
    const r = run(env, "scenarios.mjs", "S-E", "--no-wait");
    assert.equal(r.status, 0, r.out);
    const se = ev(env, "S-E");
    assert.equal(se.observations.adjustment.action, "refund");
    assert.equal(se.observations.adjustment.type, "full");
    assert.equal(se.observations.adjustment.status, "pending_approval");
  });

  it("S-F 시작 → 바로 --observe 하면 코드 3(아직 이름)", () => {
    const r = run(env, "scenarios.mjs", "S-F");
    assert.equal(r.status, 0, r.out);
    const sf = ev(env, "S-F");
    assert.equal(sf.phase, "started");
    assert.deepEqual(sf.subs.map((s) => s.subscriptionId), [subs[3], subs[4]]);
    const obs = run(env, "scenarios.mjs", "S-F", "--observe");
    assert.equal(obs.status, 3, obs.out);
    assert.match(obs.out, /실행 대기/);
    const state = readJson(env.PADDLE_FAKE_STATE);
    const f2 = state.subscriptions.find((s) => s.id === subs[4]);
    assert.equal(f2.scheduled_change.action, "cancel", "F2 에는 cancel 예약");
    assert.equal(state.subscriptions.find((s) => s.id === subs[3]).scheduled_change, null, "F1 에는 보호 없음");
  });

  it("풀: 시나리오별 소비 기록, 남은 구독 없으면 코드 3", () => {
    const pool = ev(env, "pool");
    assert.deepEqual(
      Object.fromEntries(pool.entries.map((e) => [e.subscriptionId, e.usedBy])),
      { [subs[0]]: "S-A", [subs[1]]: "S-B", [subs[2]]: "S-C", [subs[3]]: "S-F1", [subs[4]]: "S-F2" },
    );
    const fresh = makeEnv(mkdtempSync(join(tmpdir(), "paddle-glue-empty-")));
    assert.equal(run(fresh, "setup.mjs").status, 0);
    const r = run(fresh, "scenarios.mjs", "S-B");
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /풀에 없습니다/);
  });

  it("verdict: 증거로 분기 판정(가짜 Paddle 에서는 A — 진짜 판정은 샌드박스에서)", () => {
    const r = run(env, "scenarios.mjs", "verdict");
    assert.equal(r.status, 0, r.out);
    assert.equal(ev(env, "verdict").branch, "A");
  });

  it("증거 전체: 키·포털 토큰 없음, 한글 프로젝트명 보존", () => {
    const dir = env.PADDLE_SPIKE_EVIDENCE_DIR;
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    assert.ok(!all.includes(FAKE_SANDBOX_KEY));
    assert.ok(!all.includes("portal-token-should-be-redacted"));
    assert.ok(!all.includes("4242"), "카드 끝자리도 증거에 없다");
    assert.ok(all.includes(KO_PROJECT_NAME));
  });
});
