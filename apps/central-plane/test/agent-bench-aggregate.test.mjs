/**
 * H4: 벤치 하네스 --repeat — 런별 지표와 여러 런의 평균·최소·최대.
 * 2026-10-18(HANDOFF §3-3): "3회 판정 동일"을 두 층으로 — ① 질문 동일성(AC 목록) ② 판정 동일성(같은 AC의 status).
 * 순수 집계(agent-bench-aggregate.mjs)는 의존성이 없어 늘 돈다. 하네스 본체(agent-bench1-local.mjs)는 dist + Playwright(spike 폴더)를
 * 읽으므로 없으면 그 부분만 건너뛴다(= 미측정).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, "..", "..", "..", "tools");
const fixtures = join(tools, "simsa-inspection-fixtures");
const skip = existsSync(join(tools, "simsa-completion-loop-spike", "node_modules", "playwright")) ? false : "playwright(spike) 없음 — 미측정";
const { summarize, aggregate, compareRuns } = await import(pathToFileURL(join(fixtures, "agent-bench-aggregate.mjs")).href);

describe("벤치 하네스 집계", () => {
  it("런 지표 → 평균·최소·최대", async () => {
    const apps = [{ id: "a", mustFailed: ["A1", "A2"] }, { id: "b", mustFailed: [] }];
    const r1 = summarize(apps, [
      { app: "a", decision: "Needs Fix", match: true, opposite: false, mustIdentified: ["A1"], costUsd: 0.3 },
      { app: "b", decision: "Ready", match: true, opposite: false, mustIdentified: [], costUsd: 0.2 },
    ]);
    // 2026-10-19: status 분포 필드가 추가됐다(아래 describe) — 기존 지표는 그대로.
    const { statusCounts: _sc, notVerifiedShare: _nv, notVerifiedByReason: _nr, ...base } = r1;
    assert.deepEqual(base, { oppositeErrors: 0, appMatch: 2, apps: 2, mustIdentified: 1, mustTotal: 2, costPerRunMean: 0.25, costPerRunMax: 0.3, errors: 0 });
    const r2 = { ...r1, mustIdentified: 2, costPerRunMean: 0.35, appMatch: 1 };
    const agg = aggregate([r1, r2]);
    assert.deepEqual(agg.mustIdentified, { mean: 1.5, min: 1, max: 2 });
    assert.deepEqual(agg.appMatch, { mean: 1.5, min: 1, max: 2 });
    assert.equal(agg.runs, 2);
  });

  it("프로덕션 하네스도 같은 집계를 내보낸다(이름 호환)", async () => {
    const prod = await import(pathToFileURL(join(fixtures, "agent-bench1.mjs")).href).catch(() => null);
    if (!prod) return; // dist·playwright 없으면 하네스 본체는 못 읽는다 — 순수 집계는 위에서 이미 봤다
    assert.equal(prod.summarize, summarize);
    assert.equal(prod.aggregate, aggregate);
    assert.equal(prod.compareRuns, compareRuns);
  });

  it("로컬 결과의 비용은 {generation, agent} 합으로 센다", () => {
    const r = summarize([{ id: "a", mustFailed: [] }], [{ app: "a", decision: "Ready", match: true, opposite: false, mustIdentified: [], costUsd: { generation: 0.1, agent: 0.25 } }]);
    assert.equal(r.costPerRunMean, 0.35);
  });
});

describe("두 층 — 질문 동일성 · 판정 동일성 (compareRuns, 옛 코드에는 없다)", () => {
  const table = (rows) => rows.map(([id, status, title = `기준 ${id}`]) => ({ id, title, then: `${id} 결과`, status }));
  const run = (results) => ({ results });

  it("같은 질문·같은 판정 3회 → 앱 질문 동일 · 불일치 0", () => {
    const r = { app: "a", decision: "Needs Fix", acTable: table([["A1", "pass"], ["A3", "fail"]]) };
    const c = compareRuns([run([r]), run([r]), run([r])]);
    assert.equal(c.runs, 3);
    assert.deepEqual(c.totals, { appsQuestionIdentical: 1, appsDecisionIdentical: 1, apps: 1, acCellsCompared: 2, acCellsDisagreeing: 0, acCellsIncomparable: 0 });
    assert.deepEqual(c.apps[0].acs.map((x) => x.statuses), [["pass", "pass", "pass"], ["fail", "fail", "fail"]]);
  });

  it("같은 질문인데 한 런만 판정이 다르면 그 셀 1개가 불일치, 앱 판정 불일치도 센다", () => {
    const a1 = { app: "a", decision: "Needs Fix", acTable: table([["A1", "pass"], ["A3", "fail"]]) };
    const a2 = { app: "a", decision: "Not Verified", acTable: table([["A1", "pass"], ["A3", "not_verified"]]) };
    const c = compareRuns([run([a1]), run([a2]), run([a1])]);
    assert.equal(c.totals.appsQuestionIdentical, 1);
    assert.equal(c.totals.appsDecisionIdentical, 0);
    assert.equal(c.totals.acCellsDisagreeing, 1);
    const row = c.rows.find((x) => x.acId === "A3");
    assert.deepEqual(row.statuses, ["fail", "not_verified", "fail"]);
    assert.equal(row.identical, false);
    assert.deepEqual(c.apps[0].decisions, ["Needs Fix", "Not Verified", "Needs Fix"]);
  });

  it("질문이 다르면(제목·개수·순서) 질문 불일치로 세고, 전 런에 없는 AC는 '비교 불가'로 따로 센다", () => {
    const a1 = { app: "a", decision: "Needs Fix", acTable: table([["AC-001", "pass", "예약하기"], ["AC-002", "fail", "중복 막기"]]) };
    const a2 = { app: "a", decision: "Needs Fix", acTable: table([["AC-001", "pass", "날짜 고르기"], ["AC-002", "fail", "중복 막기"], ["AC-003", "pass", "취소"]]) };
    const c = compareRuns([run([a1]), run([a2])]);
    assert.equal(c.totals.appsQuestionIdentical, 0);
    assert.deepEqual(c.apps[0].acCounts, [2, 3]);
    // id가 양쪽에 있는 AC-001·AC-002만 비교(제목이 달라도 id로만 — 그래서 질문 동일성 층이 따로 있다)
    assert.equal(c.totals.acCellsCompared, 2);
    assert.equal(c.totals.acCellsIncomparable, 1);
    assert.equal(c.rows.find((x) => x.acId === "AC-003").comparable, false);
  });

  it("한 런이 오류로 끝나면 질문·판정 모두 동일 아님, 오류는 판정 자리에 남긴다", () => {
    const ok = { app: "a", decision: "Needs Fix", acTable: table([["A1", "fail"]]) };
    const bad = { app: "a", error: "agent_failed: timeout" };
    const c = compareRuns([run([ok]), run([bad])]);
    assert.equal(c.totals.appsQuestionIdentical, 0);
    assert.equal(c.totals.appsDecisionIdentical, 0);
    assert.match(c.apps[0].decisions[1], /^error:agent_failed/);
    assert.equal(c.totals.acCellsCompared, 0);
    assert.equal(c.totals.acCellsIncomparable, 1);
  });
});

describe("사전 등록 조건 주입(--acs=prereg)", { skip }, () => {
  it("A1~A10 그대로(must 7 · should 3 · 전부 확인됨) — 정답지 mustFailed와 id로 맞물린다", async () => {
    const { BENCH1_PREREG_ACS, APPS } = await import(pathToFileURL(join(fixtures, "agent-bench1-local.mjs")).href);
    assert.deepEqual(BENCH1_PREREG_ACS.map((a) => a.id), ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);
    assert.equal(BENCH1_PREREG_ACS.filter((a) => a.priority === "must").length, 7);
    assert.equal(BENCH1_PREREG_ACS.filter((a) => a.priority === "should").length, 3);
    assert.ok(BENCH1_PREREG_ACS.every((a) => a.confirmed === true && a.given && a.when && a.then));
    const ids = new Set(BENCH1_PREREG_ACS.map((a) => a.id));
    for (const app of APPS) for (const m of app.mustFailed) assert.ok(ids.has(m), `${app.id} 정답지 조건 ${m}이 주입 AC에 있다`);
  });

  it("주입 모드의 짚음 = 그 조건 id의 AC가 fail (키워드 대조 아님)", async () => {
    const { score } = await import(pathToFileURL(join(fixtures, "agent-bench1-local.mjs")).href);
    const app = { id: "x", expected: "broken_or_hold", mustFailed: ["A3", "A6"] };
    const acTable = [
      { id: "A3", title: "이미 예약된 시간", then: "t", status: "fail", reason: "같은 시간이 또 예약됐어요" },
      { id: "A6", title: "관리 화면", then: "t", status: "not_verified", reason: "관리 화면 목록을 확인하지 못했어요" },
    ];
    const pre = score(app, { decision: "Needs Fix", acMode: "prereg", acTable });
    assert.deepEqual(pre.mustIdentified, ["A3"], "A6은 fail이 아니므로 짚은 것이 아니다(키워드 '관리'가 있어도)");
    const inf = score(app, { decision: "Needs Fix", acMode: "inferred", acTable });
    assert.deepEqual(inf.mustIdentified, ["A3"], "추론 모드는 fail 문장 키워드 대조 — A6 문장은 fail이 아니라 제외");
    assert.equal(pre.match, true);
  });
});

describe("2026-10-19 PR4 통과 기준 집계 — not_verified 비율(3회 합산) · 반대 판정 0 (옛 코드에는 없다)", () => {
  it("summarize에 status 분포·비율·사유별, aggregate에 합산 비율과 oppositeZeroAllRuns", () => {
    const apps = [{ id: "a", mustFailed: [] }];
    const t = (rows) => rows.map(([status, reasonCode]) => ({ id: "x", status, ...(reasonCode ? { reasonCode } : {}) }));
    const r1 = summarize(apps, [{ app: "a", decision: "Needs Fix", match: true, opposite: false, mustIdentified: [], costUsd: 0.2, acTable: t([["pass"], ["fail"], ["not_verified", "precondition_not_met"], ["not_verified"]]) }]);
    assert.deepEqual(r1.statusCounts, { pass: 1, fail: 1, not_verified: 2 });
    assert.equal(r1.notVerifiedShare, 0.5);
    assert.deepEqual(r1.notVerifiedByReason, { precondition_not_met: 1, "-": 1 });
    const r2 = summarize(apps, [{ app: "a", decision: "Ready", match: true, opposite: true, mustIdentified: [], costUsd: 0.2, acTable: t([["pass"], ["pass"]]) }]);
    const agg = aggregate([r1, r2]);
    assert.deepEqual(agg.notVerifiedPooled, { cells: 6, notVerified: 2, share: 0.3333 });
    assert.equal(agg.oppositeZeroAllRuns, false);
    assert.equal(aggregate([r1]).oppositeZeroAllRuns, true);
  });
});
