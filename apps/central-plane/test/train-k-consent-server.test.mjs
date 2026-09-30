/**
 * train-k-consent-server.test.mjs — Train K 서버(동의·프라이버시 D-21 집행, 가격·동의 계획 §4·§5.2 K-1·K-2·K-3).
 *
 * 고정하는 계약(번호 = 워크플로 계약의 테스트 목록):
 *   ① 거절 저장: consent_version = 현재 버전 · decided_at · 재조회 declined (옛 코드는 NULL로 지워 재초대)
 *   ② 철회 → 그 사람의 학습 사본(색인 + 0071 이전 검수 사본) R2 삭제 + deleted_at, 다른 사람 사본 무접촉
 *   ③ 프로젝트 삭제 → 그 프로젝트 사본만 삭제, D1(요청 표시) 먼저 · R2 나중
 *   ④ 운영 정보 '끔' 사용자 → 런 insert·완료 콜백·프로젝트 생성·수리 잡·재검수의 운영 정보 칸 NULL, '켬'이면 채움
 *   ⑤ 기본값: DE·GB·CH 등은 off(명시 on이면 채움), KR은 on
 *   ⑥ /workspace/privacy-prefs GET/POST — Zod 경계·userKey 범위(남의 선택을 읽거나 바꾸지 못함)
 *   ⑦ 캡처 시 색인 행(색인 먼저 → put) · 동의 없으면 행도 사본도 없음 · 색인 실패면 사본 저장 안 함
 *   ⑧ 크론(6시간): 실패한 삭제 재시도 · 과거 철회자의 0071 이전 검수 사본 · 묘비 30일 청소
 *   ⑨ 0071 SQL은 additive만 (+ 실제 SQLite에 0001~0071 전부 적용)
 *   ⑩ 대시보드 방침 가드(NOT_OPS_META)가 0071 추가분을 이유와 함께 가진다 — 가드 자체는 대시보드 테스트가 돌린다
 *
 * 표시 규칙: [가드] = 옛 코드에서도 통과할 수 있는 형태 검사(회귀 증거 아님). 표시 없음 = 고치기 전 코드에서 실패.
 * 실제 SQLite(node:sqlite) 테스트는 Node 20에서 건너뛴다(건너뜀 = 미측정, 통과 아님). 네트워크 없음.
 * 리얼 데이터(Rule 6): 한글 프로젝트 id·제목·의도 문장을 섞는다 — 색인이 R2 키(비ASCII는 _로 뭉개짐)가 아니라
 * project_id 칸으로 찾는지가 여기서 드러난다.
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { SQLITE_SKIP, openSqliteD1, makeMemoryR2, migrationFiles } from "./_sqlite-d1.mjs";
import { makeFakeD1, projectRow, websiteSource, checkRow, makeDoStub, send } from "./_train-c-fake-d1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0071_consent_k.sql");

const load = (p) => import(p).catch(() => ({}));
const consentDb = await import("../dist/workspace/training-consent-db.js");
const { createWorkspaceTrainingConsentRoutes } = await import("../dist/routes/workspace-training-consent.js");
const trainingStore = await import("../dist/workspace/training-store.js");
const journeyStore = await import("../dist/workspace/journey-store.js");
const { deleteProject } = await import("../dist/workspace/db.js");
const { createApp } = await import("../dist/router.js");
const { runVerifySweep, REPAIR_MERGED_EVENT } = await import("../dist/workspace/verify-sweep.js");
const prefs = await load("../dist/workspace/privacy-prefs.js");
const tindex = await load("../dist/workspace/training-records-index.js");

const { TRAINING_CONSENT_VERSION } = consentDb;
const UK_A = "uk_mq3x9k2ab1c";
const UK_B = "uk_mq3x9zz9zzz";
const P_BAKERY = "wsp_빵집_예약"; // client-supplied ids can be non-ASCII; journey keys squash them to "_"
const P_FLOWER = "wsp_꽃집_주문";

// ─── helpers ──────────────────────────────────────────────────────────────────

function sqliteEnv(opts = {}) {
  const h = openSqliteD1();
  const r2 = makeMemoryR2(opts);
  return { h, env: { ENVIRONMENT: "test", DB: h.d1, EVIDENCE: r2 }, r2 };
}

function consentRow(h, userKey, { consented, version = TRAINING_CONSENT_VERSION, decidedAt = null } = {}) {
  h.db
    .prepare(
      `INSERT INTO workspace_training_consent (user_key, consented, consent_version, decided_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 't0', 't0')`,
    )
    .run(userKey, consented ? 1 : 0, version, decidedAt);
}

function projectSql(h, id, userKey, title = "동네 빵집 예약") {
  h.db
    .prepare(
      `INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at)
       VALUES (?, ?, ?, '빵 예약', '{}', '{}', '[]', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    )
    .run(id, userKey, title);
}

/** A pre-0071 review run whose training copy exists in R2 but was never indexed (0057 training_r2_key only). */
function legacyReviewRun(h, r2, { id, projectId, userKey, key }) {
  h.db
    .prepare(
      `INSERT INTO workspace_pr_review_runs (id, project_id, user_key, repo_full_name, pr_number, status, created_at, updated_at, training_r2_key)
       VALUES (?, ?, ?, 'acme/동네빵집', 3, 'passed', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', ?)`,
    )
    .run(id, projectId, userKey, key);
  r2.objects.set(key, JSON.stringify({ event_id: id }));
}

const indexRows = (h) =>
  h.db.prepare(`SELECT * FROM training_records_index ORDER BY r2_key`).all().map((r) => ({ ...r }));

function trainingInput(over = {}) {
  return {
    userKey: UK_A,
    projectId: P_BAKERY,
    reviewRunId: "wprr_a1",
    repoFullName: "acme/동네빵집",
    prNumber: 7,
    headSha: "abc",
    productSpec: { title: "동네 빵집 예약" },
    items: [{ id: "i1", text: "손님이 빵을 예약할 수 있어야 한다" }],
    prFiles: [{ filename: "src/예약.tsx", patch: "+ const x = 1" }],
    review: { source: "llm", summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [{ itemId: "i1", status: "passed" }] },
    finalStatus: "passed",
    envelope: { region: "KR" },
    now: "2026-09-30T01:00:00.000Z",
    subjectHash: "deadbeef",
    ...over,
  };
}

function journeyInput(over = {}) {
  return {
    userKey: UK_A,
    projectId: P_BAKERY,
    eventType: "pr_reviewed",
    builtWith: { tools: ["lovable"] },
    eventId: "wprr_a1",
    payload: { reviewRunId: "wprr_a1", finalStatus: "passed" },
    now: "2026-09-30T01:00:00.000Z",
    subjectHash: "deadbeef",
    ...over,
  };
}

function consentRoute(env, method, body, query = "") {
  const app = createWorkspaceTrainingConsentRoutes();
  const init = method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  return app.fetch(new Request(`http://localhost/workspace/training-consent${query}`, init), env);
}

// ─── ① 거절 저장 ─────────────────────────────────────────────────────────────────

describe("① 거절 저장 — 재초대 없음", { skip: SQLITE_SKIP }, () => {
  it("거절은 consent_version = 현재 버전 + consented 0 + decided_at으로 저장되고, 재조회하면 declined다", async () => {
    const { h, env } = sqliteEnv();
    const res = await consentRoute(env, "POST", { userKey: UK_A, consented: false });
    assert.equal(res.status, 200);
    const row = h.db.prepare(`SELECT * FROM workspace_training_consent WHERE user_key = ?`).get(UK_A);
    assert.equal(row.consented, 0);
    assert.equal(row.consent_version, TRAINING_CONSENT_VERSION, "a 'no' is stored against the clause it answered — not NULL");
    assert.ok(typeof row.decided_at === "string" && row.decided_at.length > 0, "decided_at stamped");

    const get = await (await consentRoute(env, "GET", null, `?userKey=${UK_A}`)).json();
    assert.equal(get.state, "declined");
    assert.equal(get.active, false);
    assert.equal(get.decidedAt, row.decided_at);
  });

  it("동의 → 거절(철회)도 버전을 지우지 않는다 · 동의도 decided_at을 찍는다", async () => {
    const { h, env } = sqliteEnv();
    await consentRoute(env, "POST", { userKey: UK_A, consented: true });
    const yes = h.db.prepare(`SELECT * FROM workspace_training_consent WHERE user_key = ?`).get(UK_A);
    assert.equal(yes.consented, 1);
    assert.ok(yes.decided_at, "opt-in stamps decided_at too");
    await consentRoute(env, "POST", { userKey: UK_A, consented: false });
    const no = h.db.prepare(`SELECT * FROM workspace_training_consent WHERE user_key = ?`).get(UK_A);
    assert.equal(no.consented, 0);
    assert.equal(no.consent_version, TRAINING_CONSENT_VERSION);
    const get = await (await consentRoute(env, "GET", null, `?userKey=${UK_A}`)).json();
    assert.equal(get.state, "declined");
  });

  it("상태 규칙: 행 없음 = undecided · 옛 조항 동의 = undecided(다시 묻는다) · 옛 코드의 거절(버전 NULL) = declined(다시 묻지 않는다)", () => {
    assert.equal(typeof consentDb.trainingConsentState, "function", "trainingConsentState export");
    const s = consentDb.trainingConsentState;
    assert.equal(s(null), "undecided");
    assert.equal(s({ consented: true, consentVersion: TRAINING_CONSENT_VERSION }), "consented");
    assert.equal(s({ consented: true, consentVersion: "1970-01-01" }), "undecided");
    assert.equal(s({ consented: false, consentVersion: null }), "declined");
    assert.equal(s({ consented: false, consentVersion: TRAINING_CONSENT_VERSION }), "declined");
  });
});

// ─── ⑦ 캡처 시 색인 ─────────────────────────────────────────────────────────────

describe("⑦ 캡처 시 색인 행 — 색인 먼저, 그다음 사본", { skip: SQLITE_SKIP }, () => {
  it("동의한 사람의 검수·여정 사본 → 색인 행(원문 user_key·project_id·r2_key·kind)이 사본 키와 1:1", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: true });
    // Shared clock between D1 and R2: how many SQL statements had run when each put happened.
    const putAt = [];
    const put = r2.put.bind(r2);
    r2.put = async (k, v) => {
      putAt.push(h.log.length);
      return put(k, v);
    };
    const t = await trainingStore.captureTrainingRecord(env, trainingInput());
    const j = await journeyStore.captureJourneyEvent(env, journeyInput());
    assert.equal(t.stored, true);
    assert.equal(j.stored, true);
    const rows = indexRows(h);
    assert.deepEqual(
      rows.map((r) => ({ user_key: r.user_key, project_id: r.project_id, r2_key: r.r2_key, kind: r.kind, deleted_at: r.deleted_at })),
      [
        { user_key: UK_A, project_id: P_BAKERY, r2_key: t.key, kind: "training", deleted_at: null },
        { user_key: UK_A, project_id: P_BAKERY, r2_key: j.key, kind: "journey", deleted_at: null },
      ].sort((a, b) => (a.r2_key < b.r2_key ? -1 : 1)),
    );
    const squashed = P_BAKERY.replace(/[^A-Za-z0-9_-]/g, "_");
    assert.ok(j.key.includes(`/${squashed}/`), `journey key squashes the Korean project id: ${j.key}`);
    assert.equal(P_FLOWER.replace(/[^A-Za-z0-9_-]/g, "_"), squashed, "two Korean ids collide in the key path — the index must not parse keys");
    assert.ok(r2.objects.has(t.key) && r2.objects.has(j.key));
    // Order: each copy's index row is written before the object lands.
    const inserts = h.log.map((sql, i) => [sql, i]).filter(([sql]) => /INSERT INTO training_records_index/.test(sql)).map(([, i]) => i);
    assert.equal(inserts.length, 2);
    assert.equal(putAt.length, 2);
    assert.ok(inserts[0] < putAt[0] && inserts[1] < putAt[1], `index ${inserts} before put ${putAt}`);
  });

  it("[가드] 동의 없으면 색인 행도 사본도 없다 (옛 코드도 캡처하지 않았다 — 행동 보존)", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: false });
    assert.deepEqual(await trainingStore.captureTrainingRecord(env, trainingInput()), { stored: false, reason: "no_consent" });
    assert.equal(indexRows(h).length, 0);
    assert.equal(r2.calls.filter((c) => c[0] === "put").length, 0);
  });

  it("색인을 못 쓰면 사본을 저장하지 않는다(지울 수 없는 사본 금지) — 요청은 던지지 않는다", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: true });
    h.db.exec("DROP TABLE training_records_index");
    const res = await trainingStore.captureTrainingRecord(env, trainingInput());
    assert.equal(res.stored, false);
    assert.equal(res.reason, "index_error");
    assert.equal(r2.calls.filter((c) => c[0] === "put").length, 0, "no unindexed copy");
    const jres = await journeyStore.captureJourneyEvent(env, journeyInput());
    assert.equal(jres.stored, false);
    assert.equal(r2.calls.filter((c) => c[0] === "put").length, 0);
  });

  it("색인 문장 자체가 '지금 유효한 동의'를 조건으로 한다 — 동의 확인과 색인 사이에 철회가 끼면 행이 생기지 않는다", async () => {
    assert.equal(typeof tindex.indexTrainingRecord, "function");
    const { h, env } = sqliteEnv();
    consentRow(h, UK_A, { consented: false });
    const r = await tindex.indexTrainingRecord(env, {
      userKey: UK_A, projectId: P_BAKERY, r2Key: "events/KR/2026/09/30/x.json", kind: "training",
      capturedAt: "2026-09-30T00:00:00.000Z", consentVersion: TRAINING_CONSENT_VERSION,
    });
    assert.deepEqual(r, { indexed: false, reason: "no_consent" });
    assert.equal(indexRows(h).length, 0);
  });

  it("put 뒤 재확인: 캡처 도중 삭제가 요청됐으면 방금 쓴 사본을 바로 지운다", async () => {
    assert.equal(typeof tindex.settleAfterPut, "function");
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: true });
    const key = "events/KR/2026/09/30/wprr_race.json";
    const idx = await tindex.indexTrainingRecord(env, {
      userKey: UK_A, projectId: P_BAKERY, r2Key: key, kind: "training", capturedAt: "2026-09-30T00:00:00.000Z",
      consentVersion: TRAINING_CONSENT_VERSION,
    });
    assert.equal(idx.indexed, true);
    await r2.put(key, "{}");
    h.db.prepare(`UPDATE training_records_index SET delete_requested_at = 't1' WHERE id = ?`).run(idx.id);
    assert.equal(await tindex.settleAfterPut(env, idx.id, key, () => "t2"), false);
    assert.equal(r2.objects.has(key), false);
    assert.equal(indexRows(h)[0].deleted_at, "t2");
  });
});

// ─── ② 철회 → 삭제 ───────────────────────────────────────────────────────────────

describe("② 철회 → 그 사람의 학습 사본 삭제, 다른 사람 무접촉", { skip: SQLITE_SKIP }, () => {
  it("색인 사본 + 0071 이전 검수 사본(training_r2_key)을 지우고 deleted_at을 찍는다 · 다른 사람 사본·행은 그대로", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: true });
    consentRow(h, UK_B, { consented: true });
    const a1 = await trainingStore.captureTrainingRecord(env, trainingInput());
    const a2 = await journeyStore.captureJourneyEvent(env, journeyInput());
    const b1 = await trainingStore.captureTrainingRecord(env, trainingInput({ userKey: UK_B, projectId: P_FLOWER, reviewRunId: "wprr_b1" }));
    const b2 = await journeyStore.captureJourneyEvent(env, journeyInput({ userKey: UK_B, projectId: P_FLOWER, eventId: "wprr_b1" }));
    const legacyA = "events/KR/2026/08/01/wprr_legacy_a.json";
    const legacyB = "events/KR/2026/08/01/wprr_legacy_b.json";
    legacyReviewRun(h, r2, { id: "wprr_legacy_a", projectId: P_BAKERY, userKey: UK_A, key: legacyA });
    legacyReviewRun(h, r2, { id: "wprr_legacy_b", projectId: P_FLOWER, userKey: UK_B, key: legacyB });

    const res = await consentRoute(env, "POST", { userKey: UK_A, consented: false });
    assert.equal(res.status, 200);

    for (const k of [a1.key, a2.key, legacyA]) assert.equal(r2.objects.has(k), false, `A's copy deleted: ${k}`);
    for (const k of [b1.key, b2.key, legacyB]) assert.equal(r2.objects.has(k), true, `B's copy untouched: ${k}`);
    const deletes = r2.calls.filter((c) => c[0] === "delete").map((c) => c[1]);
    for (const k of [b1.key, b2.key, legacyB]) assert.ok(!deletes.includes(k), `no delete call for B's key ${k}`);

    const rows = indexRows(h);
    const aRows = rows.filter((r) => r.user_key === UK_A);
    assert.equal(aRows.length, 3, "A: 2 indexed + 1 legacy backfilled");
    for (const r of aRows) {
      assert.ok(r.delete_requested_at, "request recorded");
      assert.ok(r.deleted_at, "deleted_at stamped after R2 delete");
    }
    for (const r of rows.filter((r) => r.user_key === UK_B)) {
      assert.equal(r.delete_requested_at, null);
      assert.equal(r.deleted_at, null);
    }
    const legacyRun = h.db.prepare(`SELECT training_r2_key FROM workspace_pr_review_runs WHERE id = 'wprr_legacy_a'`).get();
    assert.equal(legacyRun.training_r2_key, null, "stale pointer to a deleted copy is cleared");
    const legacyRunB = h.db.prepare(`SELECT training_r2_key FROM workspace_pr_review_runs WHERE id = 'wprr_legacy_b'`).get();
    assert.equal(legacyRunB.training_r2_key, legacyB);
  });

  it("R2 삭제가 실패하면 요청이 남고(deleted_at 없음) 응답은 그대로 성공한다", async () => {
    const { h, env, r2 } = sqliteEnv({ failDelete: () => true });
    consentRow(h, UK_A, { consented: true });
    const a1 = await trainingStore.captureTrainingRecord(env, trainingInput());
    const res = await consentRoute(env, "POST", { userKey: UK_A, consented: false });
    assert.equal(res.status, 200);
    assert.equal(r2.objects.has(a1.key), true);
    const [row] = indexRows(h);
    assert.ok(row.delete_requested_at);
    assert.equal(row.deleted_at, null, "never claim a deletion that did not happen");
  });
});

// ─── ③ 프로젝트 삭제 ─────────────────────────────────────────────────────────────

describe("③ 프로젝트 삭제 → 그 프로젝트 사본만, D1 먼저 R2 나중", { skip: SQLITE_SKIP }, () => {
  it("빵집 프로젝트를 지우면 빵집의 색인·옛 검수 사본만 지우고 꽃집 사본은 남는다; 요청 표시는 D1 배치 안, R2 삭제는 배치 뒤", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: true });
    projectSql(h, P_BAKERY, UK_A, "동네 빵집 예약");
    projectSql(h, P_FLOWER, UK_A, "꽃집 주문");
    const bakeryT = await trainingStore.captureTrainingRecord(env, trainingInput());
    const bakeryJ = await journeyStore.captureJourneyEvent(env, journeyInput());
    const flowerT = await trainingStore.captureTrainingRecord(env, trainingInput({ projectId: P_FLOWER, reviewRunId: "wprr_f1" }));
    const flowerJ = await journeyStore.captureJourneyEvent(env, journeyInput({ projectId: P_FLOWER, eventId: "wprr_f1" }));
    const legacyBakery = "events/unknown/2026/08/01/wprr_legacy_bakery.json";
    legacyReviewRun(h, r2, { id: "wprr_legacy_bakery", projectId: P_BAKERY, userKey: UK_A, key: legacyBakery });

    // Shared sequence across D1 batch and R2 deletes.
    const seq = [];
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = async (stmts) => {
      const out = await batch(stmts);
      seq.push(["d1-batch", stmts.map((s) => s._sql)]);
      return out;
    };
    const del = r2.delete.bind(r2);
    r2.delete = async (k) => {
      seq.push(["r2-delete", k]);
      return del(k);
    };

    await deleteProject(env, P_BAKERY, UK_A);

    for (const k of [bakeryT.key, bakeryJ.key, legacyBakery]) assert.equal(r2.objects.has(k), false, `bakery copy deleted: ${k}`);
    for (const k of [flowerT.key, flowerJ.key]) assert.equal(r2.objects.has(k), true, `flower copy kept: ${k}`);

    const batchAt = seq.findIndex((e) => e[0] === "d1-batch");
    assert.ok(batchAt >= 0, "cascade batch ran");
    const batchSql = seq[batchAt][1].join("\n");
    assert.match(batchSql, /UPDATE training_records_index\s+SET delete_requested_at/, "deletion request is part of the D1 batch");
    assert.match(batchSql, /INSERT INTO training_records_index[\s\S]*FROM workspace_pr_review_runs/, "legacy copies backfilled in the batch");
    const backfillAt = seq[batchAt][1].findIndex((s) => /FROM workspace_pr_review_runs/.test(s) && /INSERT INTO training_records_index/.test(s));
    const runsDeleteAt = seq[batchAt][1].findIndex((s) => /DELETE FROM workspace_pr_review_runs/.test(s));
    assert.ok(backfillAt >= 0 && backfillAt < runsDeleteAt, "legacy keys are read before their review-run rows are deleted");
    const trainingDeletes = seq
      .map((e, i) => [e, i])
      .filter(([e]) => e[0] === "r2-delete" && [bakeryT.key, bakeryJ.key, legacyBakery].includes(e[1]));
    assert.equal(trainingDeletes.length, 3);
    for (const [, i] of trainingDeletes) assert.ok(i > batchAt, "R2 delete happens after the D1 batch commits");

    const rows = indexRows(h);
    for (const r of rows.filter((r) => r.project_id === P_BAKERY)) assert.ok(r.deleted_at, `bakery row deleted_at: ${r.r2_key}`);
    for (const r of rows.filter((r) => r.project_id === P_FLOWER)) {
      assert.equal(r.delete_requested_at, null);
      assert.equal(r.deleted_at, null);
    }
    assert.equal(h.db.prepare(`SELECT COUNT(*) AS n FROM workspace_projects WHERE id = ?`).get(P_BAKERY).n, 0);
    assert.equal(h.db.prepare(`SELECT COUNT(*) AS n FROM workspace_projects WHERE id = ?`).get(P_FLOWER).n, 1);
  });
});

// ─── ⑧ 크론 ──────────────────────────────────────────────────────────────────────

describe("⑧ 크론(6시간) — 재시도 · 과거 철회자 · 묘비 청소", { skip: SQLITE_SKIP }, () => {
  it("철회 때 실패한 R2 삭제를 다음 크론이 끝낸다", async () => {
    let failing = true;
    const { h, env, r2 } = sqliteEnv({ failDelete: () => failing });
    consentRow(h, UK_A, { consented: true });
    const a1 = await trainingStore.captureTrainingRecord(env, trainingInput());
    await consentRoute(env, "POST", { userKey: UK_A, consented: false });
    assert.equal(r2.objects.has(a1.key), true, "first attempt failed");
    failing = false;
    assert.equal(typeof tindex.runTrainingPrivacyCron, "function");
    const r = await tindex.runTrainingPrivacyCron(env, new Date("2026-09-30T06:00:00.000Z"));
    assert.equal(r2.objects.has(a1.key), false);
    assert.equal(r.sweep.deleted, 1);
    assert.ok(indexRows(h)[0].deleted_at);
    assert.doesNotThrow(() => JSON.stringify(r));
  });

  it("0071 이전에 철회한 사람(옛 코드: consented 0 · 버전 NULL)의 옛 검수 사본을 크론이 찾아 지운다 · 다시 동의한 사람은 건드리지 않는다", async () => {
    const { h, env, r2 } = sqliteEnv();
    consentRow(h, UK_A, { consented: false, version: null });
    consentRow(h, UK_B, { consented: true });
    const ka = "events/KR/2026/07/10/wprr_old_a.json";
    const kb = "events/KR/2026/07/10/wprr_old_b.json";
    legacyReviewRun(h, r2, { id: "wprr_old_a", projectId: P_BAKERY, userKey: UK_A, key: ka });
    legacyReviewRun(h, r2, { id: "wprr_old_b", projectId: P_FLOWER, userKey: UK_B, key: kb });
    await tindex.runTrainingPrivacyCron(env, new Date("2026-09-30T06:00:00.000Z"));
    assert.equal(r2.objects.has(ka), false);
    assert.equal(r2.objects.has(kb), true);
    // A second tick is a no-op (no duplicate rows, nothing new to delete).
    const again = await tindex.runTrainingPrivacyCron(env, new Date("2026-09-30T12:00:00.000Z"));
    assert.equal(again.sweep.pending, 0);
    assert.equal(indexRows(h).length, 1);
  });

  it("삭제한 지 30일 지난 묘비 행은 지우고, 최근 묘비와 살아 있는 행은 남긴다", async () => {
    const { h, env } = sqliteEnv();
    const ins = h.db.prepare(
      `INSERT INTO training_records_index (id, user_key, project_id, r2_key, kind, captured_at, delete_requested_at, deleted_at)
       VALUES (?, ?, ?, ?, 'training', 't', ?, ?)`,
    );
    ins.run("tri_old", UK_A, P_BAKERY, "events/KR/a.json", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    ins.run("tri_recent", UK_A, P_BAKERY, "events/KR/b.json", "2026-09-25T00:00:00.000Z", "2026-09-25T00:00:00.000Z");
    ins.run("tri_live", UK_A, P_BAKERY, "events/KR/c.json", null, null);
    assert.equal(tindex.TRAINING_INDEX_TOMBSTONE_DAYS, 30);
    const r = await tindex.runTrainingPrivacyCron(env, new Date("2026-09-30T06:00:00.000Z"));
    assert.equal(r.tombstones.deleted, 1);
    assert.deepEqual(indexRows(h).map((x) => x.id).sort(), ["tri_live", "tri_recent"]);
  });

  // The Worker entry (dist/index.js) imports @cloudflare/containers, which does not load under Node —
  // so the wiring is pinned on the source, like rate-limit-ip-keyed-hash.test.mjs ④ 배선 does.
  it("배선: 워커의 6시간 크론(0 */6 * * *)이 runTrainingPrivacyCron을 부르고, 실패는 잡아 한 줄 JSON으로 남긴다", () => {
    const indexTs = readFileSync(join(here, "..", "src", "index.ts"), "utf8");
    const start = indexTs.indexOf('if (event.cron === "0 */6 * * *")');
    assert.ok(start >= 0, "6-hourly branch");
    const branch = indexTs.slice(start, indexTs.indexOf("return;", start));
    assert.match(branch, /runTrainingPrivacyCron\(env\)/);
    assert.match(branch, /cron: "training-privacy"/);
    assert.match(branch, /catch \(err\)/);
    const wrangler = readFileSync(join(here, "..", "wrangler.toml"), "utf8");
    assert.match(wrangler, /crons = \[[^\]]*"0 \*\/6 \* \* \*"/, "the cron is actually scheduled");
  });
});

// ─── ⑤ 기본값 ───────────────────────────────────────────────────────────────────

describe("⑤ 운영 정보 기본값 — 접속 국가", () => {
  it("EU/EEA·GB·CH는 off, KR·US·PH는 on, 엣지 밖(null)은 on", () => {
    assert.equal(typeof prefs.defaultOpsMetaForRegion, "function");
    const d = prefs.defaultOpsMetaForRegion;
    for (const c of ["DE", "FR", "GR", "IE", "PL", "SE", "IS", "LI", "NO", "GB", "CH"]) assert.equal(d(c), "off", c);
    for (const c of ["KR", "US", "PH", "TH", "JP", "SG"]) assert.equal(d(c), "on", c);
    assert.equal(d(null), "on");
    assert.equal(d("de"), "off", "case-insensitive");
  });

  it("[가드] EU 27개국이 전부 들어 있다 · 같은 법 영역(올란드·프랑스 해외 주)·Tor·미상도 off", () => {
    const eu27 = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");
    assert.equal(eu27.length, 27);
    for (const c of [...eu27, "AX", "GF", "GP", "MQ", "RE", "YT", "MF", "T1", "XX"]) {
      assert.ok(prefs.OPS_META_DEFAULT_OFF_REGIONS.has(c), c);
    }
  });

  it("선택이 기본값을 이긴다: DE + 명시 on → on(user) · KR + 명시 off → off(user)", () => {
    const r = prefs.resolveOpsMetaFrom;
    assert.deepEqual(r(null, "DE"), { opsMeta: "off", source: "default" });
    assert.deepEqual(r("on", "DE"), { opsMeta: "on", source: "user" });
    assert.deepEqual(r(null, "KR"), { opsMeta: "on", source: "default" });
    assert.deepEqual(r("off", "KR"), { opsMeta: "off", source: "user" });
  });
});

// ─── ④⑤ 캡처 게이트 (가짜 D1 — Node 20에서도 돈다) ──────────────────────────────

/** _train-c-fake-d1에 privacy_prefs 조회를 더한다(user_key → 'on'|'off'). 조회 실패도 흉내낸다. */
function withPrefs(fake, choices = new Map(), { failRead = false } = {}) {
  const orig = fake.prepare.bind(fake);
  fake.prepare = (sql) => {
    if (sql.includes("FROM privacy_prefs")) {
      const h = (args) => ({
        async first() {
          if (failRead) throw new Error("no such table: privacy_prefs");
          return choices.has(args[0]) ? { ops_meta: choices.get(args[0]) } : null;
        },
      });
      return { bind: (...a) => h(a), first: () => h([]).first() };
    }
    return orig(sql);
  };
  return fake;
}

const USER = "uk_owner";
const PROJECT = "proj_c4a";
const TOKEN = "tok_internal_secret";
const RUN_PATH = `/workspace/projects/${PROJECT}/visual-checks/run`;
const INTENT = "손님이 빵 예약 버튼을 눌러 예약을 마칠 수 있어야 한다";

function runEnv({ choices, failRead } = {}) {
  const projects = new Map([[PROJECT, projectRow(PROJECT, USER, {
    title: "동네 빵집 예약",
    built_with_json: JSON.stringify({ tools: ["lovable"], primary: "lovable" }),
    entry_path: "code",
  })]]);
  return {
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: TOKEN,
    INSPECTOR: makeDoStub({ names: [], calls: [] }),
    DB: withPrefs(makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER)] }), choices, { failRead }),
  };
}

const REPORT = {
  title: "Simsa 검수 리포트", target: "https://golf-now.example.app/", intent: INTENT, verdict: "작동 안 해요", oneLine: "x", works: false,
  findings: [{ severity: "high", what: "서버가 오류를 돌려줬어요.", why: "w", how: "h", evidence: "HTTP 502", code: "network_5xx" }],
  nextSteps: [], notes: [],
};

async function runAndFinish(env, cf) {
  const app = createApp();
  const created = await send(app, env, RUN_PATH, { body: { userKey: USER, intent: INTENT }, ...(cf ? { cf } : {}) });
  assert.equal(created.status, 202, JSON.stringify(created.json));
  const done = await send(app, env, "/internal/visual-check-done", {
    body: { runId: created.json.check.id, ok: true, decision: "Needs Fix", works: false, report: REPORT },
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(done.status, 200);
  return env.DB._checks.at(-1);
}

describe("④ 운영 정보 '끔' → 운영 정보 칸 NULL, '켬' → 채움 (검수 런 insert + 완료 콜백)", () => {
  it("KR + 명시 off → region·envelope_json·finding_codes_json 모두 NULL · 기능 칸(locale·intent·판정)은 그대로", async () => {
    const env = runEnv({ choices: new Map([[USER, "off"]]) });
    const row = await runAndFinish(env, { country: "KR" });
    assert.equal(row.region, null);
    assert.equal(row.envelope_json, null);
    assert.equal(row.finding_codes_json, null);
    assert.equal(row.locale, "ko");
    assert.equal(row.intent, INTENT);
    assert.equal(row.status, "done");
    assert.equal(row.decision, "Needs Fix");
  });

  it("[가드] KR + 선택 없음(기본 on) → 세 칸 모두 채움 (0069 행동 보존)", async () => {
    const env = runEnv();
    const row = await runAndFinish(env, { country: "KR" });
    assert.equal(row.region, "KR");
    assert.equal(JSON.parse(row.envelope_json).builtWith.primary, "lovable");
    assert.deepEqual(JSON.parse(row.finding_codes_json), ["network_5xx"]);
  });

  it("⑤ DE·GB·CH + 선택 없음(기본 off) → NULL · DE + 명시 on → 채움", async () => {
    for (const country of ["DE", "GB", "CH"]) {
      const row = await runAndFinish(runEnv(), { country });
      assert.equal(row.region, null, country);
      assert.equal(row.envelope_json, null, country);
      assert.equal(row.finding_codes_json, null, country);
    }
    const on = await runAndFinish(runEnv({ choices: new Map([[USER, "on"]]) }), { country: "DE" });
    assert.equal(on.region, "DE");
    assert.ok(on.envelope_json);
    assert.deepEqual(JSON.parse(on.finding_codes_json), ["network_5xx"]);
  });

  it("런을 만든 뒤 '끔'으로 바꾸면 완료 콜백의 실패 유형 코드도 기록하지 않는다", async () => {
    const choices = new Map();
    const env = runEnv({ choices });
    const app = createApp();
    const created = await send(app, env, RUN_PATH, { body: { userKey: USER, intent: INTENT }, cf: { country: "KR" } });
    choices.set(USER, "off");
    await send(app, env, "/internal/visual-check-done", {
      body: { runId: created.json.check.id, ok: true, decision: "Needs Fix", works: false, report: REPORT },
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(env.DB._checks.at(-1).finding_codes_json, null);
  });

  it("선택을 못 읽으면(0071 미적용·D1 오류) 기록하지 않는다(fail-closed) — 검수 자체는 진행", async () => {
    const env = runEnv({ failRead: true });
    const errs = [];
    const orig = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    let row;
    try {
      row = await runAndFinish(env, { country: "KR" });
    } finally {
      console.error = orig;
    }
    assert.equal(row.region, null);
    assert.equal(row.envelope_json, null);
    assert.equal(row.finding_codes_json, null);
    assert.equal(row.status, "done");
    assert.ok(errs.some((l) => l.includes('"at":"ops-meta-gate"')), "one-line JSON log on the fail-closed path");
  });

  it("프로젝트 생성: 명시 off → region_at_create NULL · 기본 on(TH) → 채움 · 기본 off(FR) → NULL", async () => {
    const make = async (choices, country, id) => {
      const env = { ENVIRONMENT: "test", DB: withPrefs(makeFakeD1(), choices) };
      const r = await send(createApp(), env, "/workspace/projects", {
        body: { id, userKey: "uk_빵집사장", title: "댕댕 산책 기록", idea: "산책 기록", understood: {}, productSpec: {}, items: [] },
        cf: { country },
      });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      return env.DB.state.projects.get(r.json.id).region_at_create;
    };
    assert.equal(await make(new Map([["uk_빵집사장", "off"]]), "TH", "wsp_a"), null);
    assert.equal(await make(new Map(), "TH", "wsp_b"), "TH");
    assert.equal(await make(new Map(), "FR", "wsp_c"), null);
    assert.equal(await make(new Map([["uk_빵집사장", "on"]]), "FR", "wsp_d"), "FR");
  });

  it("재검수(verify-sweep, 요청 없음): 명시 off → 원 런의 region·봉투를 물려받지 않는다 · 선택 없음 → 물려받음", async () => {
    const NOW = Date.parse("2026-09-30T12:00:00Z");
    const iso = (ms) => new Date(NOW - ms).toISOString();
    const RUN = "wvc_fixme";
    const mk = (choices) => {
      const origin = checkRow({
        id: RUN, project_id: PROJECT, user_key: USER, locale: "ko", region: "KR",
        envelope_json: JSON.stringify({ builtWith: { tools: ["bolt"] }, entryPath: "code", topicTags: null, locale: "ko", contentLang: "ko" }),
        created_at: iso(3600_000), updated_at: iso(3600_000),
      });
      const job = {
        id: "wrj_done", project_id: PROJECT, user_key: USER, visual_check_id: RUN, repo_full_name: "acme/동네빵집",
        status: "done", branch_name: `fix/simsa-${RUN}`, pr_url: "https://github.com/acme/x/pull/9", pr_number: 9,
        env_cause: 0, mode: "auto_fix", changed_files: 1, error: null, region: "KR", verify_check_id: null, resolved: null,
        created_at: iso(1800_000), updated_at: iso(1800_000),
      };
      const events = [{
        id: "evt1", user_key: USER, project_id: PROJECT, event_type: REPAIR_MERGED_EVENT,
        metadata_json: JSON.stringify({ runId: RUN, prNumber: 9 }), created_at: iso(10 * 60_000),
      }];
      return {
        ENVIRONMENT: "test", INTERNAL_CALLBACK_TOKEN: TOKEN, PUBLIC_BASE_URL: "https://base",
        INSPECTOR: makeDoStub({ names: [], calls: [] }),
        DB: withPrefs(makeFakeD1({ projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]), checks: [origin], jobs: [job], events }), choices),
      };
    };
    const off = mk(new Map([[USER, "off"]]));
    assert.equal((await runVerifySweep(off, { nowMs: NOW })).dispatched, 1);
    const reOff = off.DB._checks.find((c) => c.id !== RUN);
    assert.equal(reOff.region, null);
    assert.equal(reOff.envelope_json, null);
    assert.equal(reOff.source_check_id, RUN, "lineage (functional) is kept");

    const dflt = mk(new Map());
    await runVerifySweep(dflt, { nowMs: NOW });
    const reOn = dflt.DB._checks.find((c) => c.id !== RUN);
    assert.equal(reOn.region, "KR");
    assert.ok(reOn.envelope_json);
  });
});

describe("④ 수리 잡 region", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const RUN = "wvc_fixme";
  const REPAIR_PATH = `/workspace/projects/${PROJECT}/visual-checks/${RUN}/repair`;
  const gh = async (url) => {
    const u = String(url);
    if (/\/repos\/[^/]+\/[^/]+\/installation$/.test(u)) return new Response(JSON.stringify({ id: 4242 }), { status: 200 });
    if (/\/app\/installations\/\d+\/access_tokens$/.test(u)) {
      return new Response(JSON.stringify({ token: "ghs_fixture_not_a_real_token", expires_at: "2099-01-01T00:00:00Z" }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  const mk = (choices) => {
    const repo = {
      id: "wpr_1", project_id: PROJECT, user_key: USER, github_connection_id: null,
      repo_id: "1", repo_full_name: "acme/golf-now", repo_owner: "acme", repo_name: "golf-now",
      default_branch: "main", private: 0, html_url: "https://github.com/acme/golf-now",
      created_at: "2026-09-27T00:00:00.000Z", updated_at: "2026-09-27T00:00:00.000Z",
    };
    return {
      ENVIRONMENT: "test", INTERNAL_CALLBACK_TOKEN: TOKEN, GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: privateKey,
      SANDBOX: makeDoStub({ names: [], calls: [] }),
      DB: withPrefs(
        makeFakeD1({
          projects: new Map([[PROJECT, projectRow(PROJECT, USER)]]),
          sources: [websiteSource(PROJECT, USER)],
          checks: [checkRow({ id: RUN, project_id: PROJECT, user_key: USER })],
          repos: [repo],
        }),
        choices,
      ),
    };
  };

  it("명시 off → region NULL · 선택 없음(PH 기본 on) → PH · 선택 없음(NO 기본 off) → NULL", async () => {
    const off = mk(new Map([[USER, "off"]]));
    const r1 = await send(createApp({ fetch: gh }), off, REPAIR_PATH, { body: { userKey: USER }, cf: { country: "PH" } });
    assert.equal(r1.status, 202, JSON.stringify(r1.json));
    assert.equal(off.DB._jobs[0].region, null);

    const on = mk(new Map());
    await send(createApp({ fetch: gh }), on, REPAIR_PATH, { body: { userKey: USER }, cf: { country: "PH" } });
    assert.equal(on.DB._jobs[0].region, "PH");

    const no = mk(new Map());
    await send(createApp({ fetch: gh }), no, REPAIR_PATH, { body: { userKey: USER }, cf: { country: "NO" } });
    assert.equal(no.DB._jobs[0].region, null);
  });
});

// ─── ⑥ /workspace/privacy-prefs ─────────────────────────────────────────────────

describe("⑥ /workspace/privacy-prefs — Zod 경계 · userKey 범위", { skip: SQLITE_SKIP }, () => {
  const req = (env, method, { query = "", body, cf } = {}) => {
    const init = method === "GET" ? { method } : { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) };
    const r = new Request(`http://localhost/workspace/privacy-prefs${query}`, init);
    if (cf) Object.defineProperty(r, "cf", { value: cf, enumerable: false });
    return createApp().fetch(r, env).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
  };

  it("GET 기본값(KR) → on/default · 학습 동의 상태 포함", async () => {
    const { env } = sqliteEnv();
    const r = await req(env, "GET", { query: `?userKey=${UK_A}`, cf: { country: "KR" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, {
      ok: true,
      opsMeta: "on",
      opsMetaSource: "default",
      region: "KR",
      training: { state: "undecided", version: null, decidedAt: null, currentVersion: TRAINING_CONSENT_VERSION },
    });
  });

  it("GET 기본값(DE) → off/default", async () => {
    const { env } = sqliteEnv();
    const r = await req(env, "GET", { query: `?userKey=${UK_A}`, cf: { country: "DE" } });
    assert.equal(r.json.opsMeta, "off");
    assert.equal(r.json.opsMetaSource, "default");
    assert.equal(r.json.region, "DE");
  });

  it("POST off → 저장 · 같은 사람 GET은 off/user · 다른 사람은 기본값 그대로", async () => {
    const { h, env } = sqliteEnv();
    const p = await req(env, "POST", { body: { userKey: UK_A, opsMeta: "off" }, cf: { country: "KR" } });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.opsMeta, "off");
    assert.equal(p.json.opsMetaSource, "user");
    const a = await req(env, "GET", { query: `?userKey=${UK_A}`, cf: { country: "KR" } });
    assert.equal(a.json.opsMeta, "off");
    const b = await req(env, "GET", { query: `?userKey=${UK_B}`, cf: { country: "KR" } });
    assert.equal(b.json.opsMeta, "on");
    assert.equal(b.json.opsMetaSource, "default");
    const rows = h.db.prepare(`SELECT user_key, ops_meta FROM privacy_prefs`).all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [{ user_key: UK_A, ops_meta: "off" }], "one row, only for the caller");
    // Toggle back on (EU user opting in).
    const on = await req(env, "POST", { body: { userKey: UK_A, opsMeta: "on" }, cf: { country: "DE" } });
    assert.equal(on.json.opsMeta, "on");
    assert.equal(on.json.opsMetaSource, "user");
  });

  it("잘못된 입력은 400 — userKey 없음·빈 값·너무 김·opsMeta 모름·JSON 아님", async () => {
    const { env } = sqliteEnv();
    assert.equal((await req(env, "GET", { query: "" })).status, 400);
    assert.equal((await req(env, "GET", { query: "?userKey=" })).status, 400);
    assert.equal((await req(env, "GET", { query: `?userKey=${"x".repeat(300)}` })).status, 400);
    assert.equal((await req(env, "POST", { body: { userKey: UK_A, opsMeta: "maybe" } })).status, 400);
    assert.equal((await req(env, "POST", { body: { opsMeta: "off" } })).status, 400);
    assert.equal((await req(env, "POST", { body: { userKey: UK_A, opsMeta: true } })).status, 400);
    assert.equal((await req(env, "POST", { body: "{not json" })).status, 400);
  });
});

// ─── ⑨ 0071 형태 ────────────────────────────────────────────────────────────────

describe("⑨ 0071 SQL — additive만", () => {
  const code = () => readFileSync(MIGRATION, "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  it("[가드] ALTER TABLE ADD COLUMN · CREATE TABLE IF NOT EXISTS · CREATE INDEX IF NOT EXISTS만 — 파괴적 문장 0", () => {
    assert.ok(existsSync(MIGRATION));
    const statements = code().split(";").map((s) => s.trim()).filter(Boolean);
    for (const s of statements) {
      assert.match(s, /^(ALTER TABLE \w+ ADD COLUMN \w+ TEXT|CREATE TABLE IF NOT EXISTS \w+|CREATE INDEX IF NOT EXISTS \w+)/, `non-additive: ${s.slice(0, 80)}`);
    }
    assert.doesNotMatch(code(), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|REPLACE)\b/i);
  });

  it("[가드] 계약의 칸: decided_at · privacy_prefs(user_key PK, ops_meta CHECK on/off, updated_at) · training_records_index + 인덱스(user_key)·(project_id)", () => {
    const c = code();
    assert.match(c, /ALTER TABLE workspace_training_consent ADD COLUMN decided_at TEXT/);
    assert.match(c, /CREATE TABLE IF NOT EXISTS privacy_prefs \(\s*user_key TEXT PRIMARY KEY,\s*ops_meta TEXT CHECK \(ops_meta IN \('on','off'\)\),\s*updated_at TEXT NOT NULL\s*\)/);
    for (const col of ["id TEXT PRIMARY KEY", "user_key TEXT NOT NULL", "project_id TEXT", "r2_key TEXT NOT NULL", "kind TEXT NOT NULL", "captured_at TEXT NOT NULL", "deleted_at TEXT"]) {
      assert.ok(c.includes(col), col);
    }
    assert.match(c, /ON training_records_index\s*\(user_key\)/);
    assert.match(c, /ON training_records_index\s*\(project_id\)/);
    const numbered = migrationFiles();
    assert.equal(numbered.filter((f) => f.startsWith("0071_")).length, 1, "exactly one 0071");
  });

  it("[가드] 실제 SQLite: 0001~0071이 순서대로 적용되고, ops_meta CHECK가 모르는 값을 막고, 크론 조회가 부분 인덱스를 탄다", { skip: SQLITE_SKIP }, () => {
    const h = openSqliteD1();
    assert.ok(h);
    h.db.prepare(`INSERT INTO privacy_prefs (user_key, ops_meta, updated_at) VALUES ('u', 'off', 't')`).run();
    assert.throws(() => h.db.prepare(`INSERT INTO privacy_prefs (user_key, ops_meta, updated_at) VALUES ('v', 'maybe', 't')`).run(), /CHECK constraint failed/);
    const cols = h.db.prepare(`PRAGMA table_info(workspace_training_consent)`).all().map((r) => r.name);
    assert.ok(cols.includes("decided_at"));
    // The cron's pending scan uses the partial index (no full scan of tombstones/live rows).
    const plan = h.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id, r2_key FROM training_records_index WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL ORDER BY delete_requested_at LIMIT 200`)
      .all()
      .map((r) => r.detail)
      .join(" | ");
    assert.match(plan, /training_records_index_pending_idx/, plan);
  });
});

// ─── ⑩ 대시보드 방침 가드 ────────────────────────────────────────────────────────

test("⑩ [가드] 대시보드 가드의 NOT_OPS_META가 0071 추가분(decided_at·privacy_prefs·training_records_index)을 이유와 함께 가진다", () => {
  const guard = readFileSync(join(here, "..", "..", "dashboard", "test", "privacy-ops-info.test.mjs"), "utf8");
  const start = guard.indexOf("const NOT_OPS_META = new Map([");
  assert.ok(start >= 0);
  const body = guard.slice(start, guard.indexOf("]);", start));
  for (const name of ["decided_at", "table:privacy_prefs", "table:training_records_index"]) {
    const m = new RegExp(`\\["${name}",\\s*"([^"]{8,})"\\]`).exec(body);
    assert.ok(m, `NOT_OPS_META has ${name} with a reason`);
  }
});
