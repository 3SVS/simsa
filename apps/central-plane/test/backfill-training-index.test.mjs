/**
 * backfill-training-index.test.mjs — PR #574 검증 #574-2: 0071 이전(색인 없는) 학습 사본을 본문의
 * subject_hash(= sha256(userKey))·project_id로 찾아 색인에 넣는 일회성 도구.
 *
 * 새 도구라 옛 코드에서는 전부 실패한다(파일 없음) — 회귀 증거가 아니라 도구 검증이다. 대신 "과거 사본은
 * 사람을 찾을 수 없다"는 옛 전제가 틀렸다는 것을 실제 캡처 코드(buildTrainingRecord·buildJourneyRecord)의
 * 본문으로 먼저 보이고, 만든 SQL을 실제 SQLite(0001~0071)에 적용한 뒤 크론·프로젝트 삭제가 과거분까지 지우는지
 * 확인한다. 네트워크 없음(R2 S3 호출은 하지 않는다 — 라이브 백필 = 미측정).
 * 리얼 데이터(Rule 6): 한글 userKey·프로젝트 id, 작은따옴표·괄호가 든 프로젝트 id(SQL 이스케이프).
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { SQLITE_SKIP, openSqliteD1, makeMemoryR2 } from "./_sqlite-d1.mjs";

const tool = await import("../scripts/backfill-training-index.mjs");
const trainingStore = await import("../dist/workspace/training-store.js");
const journeyStore = await import("../dist/workspace/journey-store.js");
const tindex = await import("../dist/workspace/training-records-index.js");
const { deleteProject } = await import("../dist/workspace/db.js");
const { TRAINING_CONSENT_VERSION } = await import("../dist/workspace/training-consent-db.js");

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const UK_A = "uk_빵집사장_a1"; // 지금 동의 중
const UK_B = "uk_꽃집사장_b2"; // 0071 이전에 철회(옛 코드: consented 0 · 버전 NULL)
const P_BAKERY = "wsp_빵집_예약";
const P_GONE = "wsp_(주)사장님's_가게"; // 0071 이전에 삭제된 프로젝트 — 작은따옴표·괄호
const P_FLOWER = "wsp_꽃집_주문";

function trainingBody(userKey, projectId, runId, capturedAt) {
  return JSON.stringify(
    trainingStore.buildTrainingRecord(
      {
        userKey, projectId, reviewRunId: runId, repoFullName: "acme/동네빵집", prNumber: 1, headSha: "x",
        productSpec: {}, items: [], prFiles: [],
        review: { source: "llm", summary: { passed: 0, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [] },
        finalStatus: "passed",
      },
      sha(userKey),
      capturedAt,
    ),
  );
}

function journeyBody(userKey, projectId, eventId, capturedAt) {
  return JSON.stringify(
    journeyStore.buildJourneyRecord(
      { userKey, projectId, eventType: "pr_reviewed", builtWith: null, eventId, payload: { a: 1 } },
      sha(userKey),
      capturedAt,
    ),
  );
}

test("전제 정정: 0071 이전에도 사본 본문에 subject_hash = sha256(userKey)와 원문 project_id가 있다(키는 뭉개져도)", () => {
  const cap = "2026-09-01T00:00:00.000Z";
  const jKey = journeyStore.journeyRecordKey(cap, P_BAKERY, "wprr_1");
  assert.ok(jKey.includes("/wsp______/"), `the key squashes the Korean id: ${jKey}`);
  for (const body of [journeyBody(UK_A, P_BAKERY, "wprr_1", cap), trainingBody(UK_A, P_BAKERY, "wprr_1", cap)]) {
    const p = tool.parseCopyBody(body);
    assert.equal(p.ok, true);
    assert.equal(p.subjectHash, sha(UK_A));
    assert.equal(p.projectId, P_BAKERY, "exact (un-squashed) project id");
    assert.equal(p.capturedAt, cap);
  }
});

test("본문 파싱은 추측하지 않는다: JSON 아님·해시 없음·해시 모양 틀림·project_id 모양 틀림은 invalid", () => {
  assert.deepEqual(tool.parseCopyBody("{not json"), { ok: false, reason: "not_json" });
  assert.deepEqual(tool.parseCopyBody("[]"), { ok: false, reason: "not_object" });
  assert.deepEqual(tool.parseCopyBody(JSON.stringify({ project_id: P_BAKERY })), { ok: false, reason: "no_subject_hash" });
  assert.deepEqual(tool.parseCopyBody(JSON.stringify({ subject_hash: "deadbeef" })), { ok: false, reason: "no_subject_hash" });
  const h = sha(UK_A);
  assert.deepEqual(tool.parseCopyBody(JSON.stringify({ subject_hash: h, project_id: 7 })), { ok: false, reason: "bad_project_id" });
  assert.deepEqual(tool.parseCopyBody(JSON.stringify({ subject_hash: h, project_id: "a\u0000b" })), { ok: false, reason: "bad_project_id" });
  assert.deepEqual(tool.parseCopyBody(JSON.stringify({ subject_hash: h })), { ok: true, subjectHash: h, projectId: null, capturedAt: null });
});

test("행 id는 캡처와 같은 규칙(trainingIndexId) — 백필한 행과 나중 캡처가 같은 행을 가리킨다", async () => {
  for (const k of ["events/KR/2026/08/01/wprr_a.json", "journey/2026/09/01/wsp______/wprr_1.json"]) {
    assert.equal(tool.indexIdForKey(k), await tindex.trainingIndexId(k));
  }
  assert.equal(tool.kindForKey("journey/x.json"), "journey");
  assert.equal(tool.kindForKey("events/KR/x.json"), "training");
  assert.equal(tool.kindForKey("training/x.json"), "training");
  assert.equal(tool.kindForKey("evidence/x.png"), null);
});

test("user-keys 파일: wrangler --json 모양 · [{user_key}] · 문자열 배열 — 모르는 모양·빈 목록은 던진다", () => {
  const wr = JSON.stringify([{ results: [{ user_key: UK_A }, { user_key: UK_B }], success: true, meta: {} }]);
  assert.deepEqual(tool.parseUserKeysFile(wr), [UK_A, UK_B]);
  assert.deepEqual(tool.parseUserKeysFile(JSON.stringify([{ user_key: UK_A }, UK_A])), [UK_A]);
  assert.throws(() => tool.parseUserKeysFile(JSON.stringify({ results: [] })));
  assert.throws(() => tool.parseUserKeysFile(JSON.stringify([{ results: [] }])));
  assert.throws(() => tool.parseUserKeysFile(JSON.stringify([42])));
});

test("SQL 리터럴: 작은따옴표는 두 번 · NULL · NUL 거부", () => {
  assert.equal(tool.sqlString(P_GONE), "'wsp_(주)사장님''s_가게'");
  assert.equal(tool.sqlString(null), "NULL");
  assert.throws(() => tool.sqlString("a\u0000b"));
});

test("인자: --user-keys·--out 필수 · --out이 저장소 안이면 거부(user_key 원문) · 모르는 인자 거부 · 요약은 개수뿐", () => {
  const repoRoot = path.resolve("/repo/conclave-ai");
  const outside = path.join(tmpdir(), "backfill.sql");
  assert.ok("error" in tool.parseArgs([], { repoRoot }));
  assert.ok("error" in tool.parseArgs(["--user-keys=k.json"], { repoRoot }));
  assert.match(
    tool.parseArgs(["--user-keys=k.json", `--out=${path.join(repoRoot, "apps", "x.sql")}`], { repoRoot }).error,
    /outside the repository/,
  );
  assert.ok("error" in tool.parseArgs(["--user-keys=k.json", `--out=${outside}`, "--apply"], { repoRoot }));
  assert.ok("error" in tool.parseArgs(["--user-keys=k.json", `--out=${outside}`, "--before=nope"], { repoRoot }));
  assert.deepEqual(tool.parseArgs(["--user-keys=k.json", `--out=${outside}`], { repoRoot }), {
    bucket: "simsa-evidence", before: null, userKeys: "k.json", out: outside,
  });
  const summary = tool.renderSummary({ scanned: 3, matched: 2, unmatched: 1, invalid: 0, byKind: { training: 1, journey: 1 } }, outside);
  assert.match(summary, /\| 3 \| 2 \| 1 \| 1 \| 1 \| 0 \|/);
  assert.doesNotMatch(summary, /uk_|wsp_|wprr_/);
});

describe("만든 SQL을 실제 SQLite(0001~0071)에 적용 → 크론·프로젝트 삭제가 과거분까지 지운다", { skip: SQLITE_SKIP }, () => {
  it("동의 중·프로젝트 있음 = 색인만 · 삭제된 프로젝트·철회자 = 삭제 요청 → 크론이 지움 · 이미 색인된 키·해시 불일치는 건너뜀 · 다시 적용해도 같다", async () => {
    const h = openSqliteD1();
    const r2 = makeMemoryR2();
    const env = { ENVIRONMENT: "test", DB: h.d1, EVIDENCE: r2 };
    h.db.prepare(`INSERT INTO workspace_training_consent (user_key, consented, consent_version, created_at, updated_at) VALUES (?, 1, ?, 't', 't')`).run(UK_A, TRAINING_CONSENT_VERSION);
    h.db.prepare(`INSERT INTO workspace_training_consent (user_key, consented, consent_version, created_at, updated_at) VALUES (?, 0, NULL, 't', 't')`).run(UK_B);
    for (const [id, uk] of [[P_BAKERY, UK_A], [P_FLOWER, UK_B]]) {
      h.db
        .prepare(`INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, created_at, updated_at) VALUES (?, ?, '가게', '아이디어', '{}', '{}', '[]', 't', 't')`)
        .run(id, uk);
    }
    const cap = "2026-09-01T00:00:00.000Z";
    const keep = journeyStore.journeyRecordKey(cap, P_BAKERY, "wprr_keep"); // A · 프로젝트 있음 → 색인만
    const gone = journeyStore.journeyRecordKey(cap, P_GONE, "wprr_gone"); // A · 프로젝트 이미 삭제 → 요청
    const goneT = "events/KR/2026/07/01/wprr_gone_t.json"; // A · 삭제된 프로젝트의 검수 사본(검수 런 행 없음) → 요청
    const withdrawn = journeyStore.journeyRecordKey(cap, P_FLOWER, "wprr_b"); // B · 철회 → 요청
    const already = "events/KR/2026/08/01/wprr_already.json"; // 이미 'trl_' 행으로 색인됨 → 건너뜀
    const stranger = "journey/2026/09/01/wsp_x/wprr_stranger.json"; // 해시 불일치 → 건너뜀
    const copies = [
      { key: keep, lastModified: cap, text: journeyBody(UK_A, P_BAKERY, "wprr_keep", cap) },
      { key: gone, lastModified: cap, text: journeyBody(UK_A, P_GONE, "wprr_gone", cap) },
      { key: goneT, lastModified: cap, text: trainingBody(UK_A, P_GONE, "wprr_gone_t", cap) },
      { key: withdrawn, lastModified: cap, text: journeyBody(UK_B, P_FLOWER, "wprr_b", cap) },
      { key: already, lastModified: cap, text: trainingBody(UK_A, P_BAKERY, "wprr_already", cap) },
      { key: stranger, lastModified: cap, text: journeyBody("uk_누군가", "wsp_x", "wprr_stranger", cap) },
      { key: "journey/2026/09/01/wsp_x/broken.json", lastModified: cap, text: "{broken" },
    ];
    for (const c of copies) await r2.put(c.key, c.text);
    h.db
      .prepare(`INSERT INTO training_records_index (id, user_key, project_id, r2_key, kind, captured_at) VALUES ('trl_wprr_already', ?, ?, ?, 'training', 't')`)
      .run(UK_A, P_BAKERY, already);

    const plan = tool.planBackfill(copies, tool.hashUserKeys([UK_A, UK_B]));
    assert.deepEqual(plan.counts, { scanned: 7, matched: 5, unmatched: 1, invalid: 1, byKind: { training: 2, journey: 3 } });
    const sql = tool.renderBackfillSql(plan.rows, "2026-10-01T00:00:00.000Z");
    h.db.exec(sql);
    h.db.exec(sql); // idempotent

    const rows = new Map(h.db.prepare(`SELECT * FROM training_records_index`).all().map((r) => [r.r2_key, { ...r }]));
    assert.equal(rows.size, 5, "keep, gone, goneT, withdrawn + the pre-existing 'trl_' row (no duplicate for `already`)");
    assert.equal(rows.get(already).id, "trl_wprr_already");
    assert.equal(rows.get(keep).delete_requested_at, null);
    assert.equal(rows.get(keep).project_id, P_BAKERY, "exact project id from the body, not the squashed key");
    assert.equal(rows.get(keep).user_key, UK_A);
    for (const k of [gone, goneT, withdrawn]) assert.equal(rows.get(k).delete_requested_at, "2026-10-01T00:00:00.000Z", k);
    assert.equal(rows.get(goneT).project_id, P_GONE, "quote and parentheses survived the SQL literal");
    assert.ok(!rows.has(stranger));

    // 다음 6시간 크론이 요청된 과거 사본을 지운다.
    const cron = await tindex.runTrainingPrivacyCron(env, new Date("2026-10-01T06:00:00.000Z"));
    assert.equal(cron.sweep.deleted, 3);
    for (const k of [gone, goneT, withdrawn]) assert.equal(r2.objects.has(k), false, `deleted: ${k}`);
    for (const k of [keep, already, stranger]) assert.equal(r2.objects.has(k), true, `kept: ${k}`);

    // 예전에는 닿지 않던 과거 여정 사본이 이제 프로젝트 삭제로 지워진다.
    await deleteProject(env, P_BAKERY, UK_A);
    assert.equal(r2.objects.has(keep), false, "pre-0071 journey copy deleted with its project");
    assert.ok(h.db.prepare(`SELECT deleted_at FROM training_records_index WHERE r2_key = ?`).get(keep).deleted_at);
  });
});
