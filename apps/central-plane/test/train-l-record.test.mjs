// train L3·L5 (2026-10-24) — 기계 후보 라벨 저장(0076, 닫힌 어휘만) + 관리자 집계(같은 결함 묶음은 1건). 실제 마이그레이션 SQLite.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

const R = await import("../dist/dataset/record.js");

function v2Report() {
  const verdict = (acId, claim, summary, cls, basis) => ({
    acId, verdict: "fail", confirmed: true, reasons: [], claim, quotes: ["심사테스트 010-1234-5678 님 예약"],
    evidence: [{ id: "E9", kind: "screen", summary, excerpt: "심사테스트 010-1234-5678 님 예약" }],
    cause: { cls, basis, location: { file: "/app.js", line: null }, source: [], seen: [] },
  });
  return {
    engine: "agent", engineVersion: "v2", target: "https://salon.example/",
    acTable: [
      { id: "A5", priority: "must", status: "fail", actions: ["새로고침"] },
      { id: "A6", priority: "must", status: "fail", actions: ["새 브라우저(다른 손님)"] },
      { id: "A8", priority: "should", status: "pass", actions: ['"가격" 보기'] },
    ],
    agent: { builder: "lovable", acs: [{ id: "A5", title: "새로고침해도 예약이 남는다", then: "다른 방문자에게도" }, { id: "A6", title: "다른 손님은 그 시간을 고를 수 없다", then: "막힌다" }, { id: "A8", title: "가격" }] },
    v2: {
      runnerRev: "agent-v2-1", entry: null, intentMismatch: [],
      defectGroups: [{ key: "H1:client_only_storage", cls: "client_only_storage", hypothesisId: "H1", acIds: ["A5", "A6"], rootAcId: "A5" }],
      verdicts: [
        verdict("A5", "새로고침하면 예약이 사라진다", "same /: 예약 없음", "client_only_storage", "static_fact"),
        verdict("A6", "다른 손님에게 10:30이 열려 있다", "fresh /: 10:30 예약 가능", "client_only_storage", "static_fact"),
        { acId: "A8", verdict: "pass", confirmed: true, reasons: [], claim: "15,000원", quotes: ["커트 15,000원"], evidence: [{ id: "E3", kind: "diff", summary: "가격 보기 — 화면 바뀜", excerpt: "커트 15,000원" }] },
      ],
      fix: null,
    },
  };
}

describe("기계 후보 라벨 저장 · 집계", { skip: SQLITE_SKIP }, () => {
  let db;
  let env;
  before(() => {
    const o = openSqliteD1();
    db = o.db;
    env = { DB: o.d1 };
  });

  it("app_id는 주소 해시 — 주소 자체는 저장하지 않고, 같은 앱이면 같은 id(끝 / · 대소문자 무관)", async () => {
    const a = await R.appIdFor("https://Salon.example/");
    assert.equal(a, await R.appIdFor("https://salon.example"));
    assert.match(a, /^app_[0-9a-f]{16}$/);
    assert.notEqual(a, await R.appIdFor("https://other.example/"));
  });

  it("v2 리포트 → 판정 3행 + 실패 사건 2행, 화면 글자·전화번호·문장은 어디에도 없다", async () => {
    const out = await R.recordMachineLabels(env, { runId: "vc_l1", targetUrl: "https://salon.example/", report: v2Report(), now: "2026-10-24T01:00:00.000Z" });
    assert.deepEqual(out, { acLabels: 3, failures: 2, invalid: 0 });
    const f = db.prepare(`SELECT * FROM label_failure_events WHERE run_id = 'vc_l1' ORDER BY ac_id`).all();
    assert.deepEqual(f.map((x) => [x.ac_id, x.w1, x.y, x.k, x.c, x.s, x.builder, x.defect_group]), [
      ["A5", "persist", "not_saved", "client_only_storage", "browser_only_storage", "S2", "lovable", "H1:client_only_storage"],
      ["A6", "share", "not_visible_to_others", "client_only_storage", "browser_only_storage", "S2", "lovable", "H1:client_only_storage"],
    ]);
    const dump = JSON.stringify([...f, ...db.prepare(`SELECT * FROM label_ac_verdicts WHERE run_id = 'vc_l1'`).all()]);
    assert.doesNotMatch(dump, /010-1234-5678|심사테스트|salon\.example|예약이 사라진다/, "내용·연락처·주소·문장은 저장하지 않는다");
    // append-only: 같은 런을 다시 넣어도 늘지 않는다
    await R.recordMachineLabels(env, { runId: "vc_l1", targetUrl: "https://salon.example/", report: v2Report(), now: "2026-10-24T02:00:00.000Z" });
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM label_failure_events WHERE run_id = 'vc_l1'`).get().n, 2);
  });

  it("v1 리포트는 저장하지 않는다(근거 사슬 없음)", async () => {
    const out = await R.recordMachineLabels(env, { runId: "vc_v1", targetUrl: "https://x.example/", report: { engine: "agent", acTable: [] } });
    assert.deepEqual(out, { acLabels: 0, failures: 0, invalid: 0 });
  });

  it("집계: 빌더 × 단계 × 증상 × 분류 × 심각도, 런 수·앱 수 — 출처 섞지 않음", async () => {
    await R.recordMachineLabels(env, { runId: "vc_l2", targetUrl: "https://salon.example/", report: v2Report(), now: "2026-10-24T03:00:00.000Z" });
    const rows = await R.failureStats(env, { since: "2026-10-01T00:00:00.000Z" });
    const share = rows.find((r) => r.w1 === "share");
    assert.equal(share.builder, "lovable");
    assert.equal(share.failures, 2, "런 2개 × 묶음 1개");
    assert.equal(share.runs, 2);
    assert.equal(share.apps, 1, "같은 앱");
    assert.deepEqual(await R.failureStats(env, { since: "2026-10-01T00:00:00.000Z", source: "user" }), []);
  });
});
