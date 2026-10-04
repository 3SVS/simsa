/**
 * train-c-a7-provenance-rollback.test.mjs — C-A7 정확성 검증 P2-4: 이 PR 뒤 central-plane을 되돌릴 때.
 *
 * 문제: PR #577 이후 기존 앱 문 지시서에 저장되는 `meta.provenance`를 이전 코드의 `DevSpecMetaSchema`
 * (`.strict()`)는 모르는 키로 거부한다 → 되돌리면 지시서가 조용히 무효(검수가 AC 없이 돈다).
 * 실측(2026-10-01): origin/main 3a1ca07의 dev-spec.ts를 그대로 불러 같은 지시서를 검증 →
 * `meta: Unrecognized key(s) in object: 'provenance'`. 절차: docs/rollback-c-a7-dev-spec-provenance.md
 *
 * 고정하는 것:
 *   ① 롤백 변환 SQL(scripts/rollback/c-a7-provenance-strip.sql)을 실제 SQLite(node:sqlite, JSON1)에서 돌리면
 *      provenance가 빠지고 inferred → generated, must/should를 포함한 나머지는 그대로. provenance 없는 행·
 *      NULL·깨진 JSON은 건드리지 않고, dev_spec_updated_at도 그대로, 두 번째 실행은 0행(멱등).
 *   ② 변환본은 이 PR 이후 코드에서도 유효하다(다시 올려도 무효가 되지 않는다). provenance만 지운 것은
 *      inferred_must_unconfirmed로 무효 — 그래서 source까지 내린다.
 *   ③ 이전 코드의 meta 모양(provenance 없는 strict) 근사: 저장본은 거부, 변환본은 통과.
 *   ④ 개수 SQL은 SELECT 하나 — 개수만 낸다.
 * node:sqlite가 없는 Node 20에서는 SQLite 실행 부분만 skip한다. 한글 리얼 데이터(Rule 6).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STRIP_SQL = readFileSync(path.join(HERE, "../scripts/rollback/c-a7-provenance-strip.sql"), "utf8");
const COUNT_SQL = readFileSync(path.join(HERE, "../scripts/rollback/c-a7-provenance-count.sql"), "utf8");
const { validateDevSpec, DevSpecMetaSchema } = await import("../dist/workspace/dev-spec.js");

/** 이 PR 이후 생성기가 저장하는 모양: 확인된 FR-001만 must, 확인 안 된 FR-101은 should로 강등, 출처 동봉. */
function storedInferred() {
  return {
    meta: {
      version: 1,
      source: "inferred",
      locale: "ko",
      generatedAt: "2026-10-01T01:00:00.000Z",
      provenance: {
        builtWith: "lovable",
        entryPath: "code",
        detectedStack: { hosting: "lovable", data: "supabase" },
        userConfirmedAcIds: ["AC-001"],
      },
    },
    brief: {
      productName: "(주)트루픽셀 예약 앱",
      oneLine: "손님이 원하는 날짜를 골라 미용실 예약을 잡는 웹앱",
      targetUsers: ["동네 미용실 손님"],
      problem: "전화 예약이 번거롭다",
      included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [],
    },
    features: [
      { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "must" },
      { id: "FR-101", title: "후기 작성", description: "방문 후기를 남긴다", priority: "should" },
    ],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "10월 3일을 고르고 '예약하기'를 누르면", then: "예약 확인에 10월 3일이 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-101", given: "방문 후", when: "후기를 등록하면", then: "후기 목록에 새 글이 보인다", verifiedBy: "browser" },
    ],
    screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: [], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001", "FR-101"] }],
    dataModel: [], apis: [], nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "예약", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002"] }],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "'예약하기' 누르기"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["/ 열기", "'등록' 누르기"] },
    ],
    assumptions: [], openQuestions: [],
  };
}

/** 이전 코드의 meta 모양 근사: provenance 키가 없는 strict 객체(zod omit은 strict를 유지한다). */
const OldMetaApprox = DevSpecMetaSchema.omit({ provenance: true });

/** 롤백 SQL과 같은 변환(JS) — ②의 "provenance만 지운 것"과 비교하려고. */
const withoutProvenance = (spec) => {
  const s = structuredClone(spec);
  delete s.meta.provenance;
  return s;
};

async function sqliteOrSkip(t) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    t.skip("node:sqlite unavailable on this Node version");
    return null;
  }
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE workspace_projects (id TEXT PRIMARY KEY, user_key TEXT NOT NULL, dev_spec_json TEXT, dev_spec_updated_at TEXT)");
  return db;
}

describe("P2-4 롤백 호환 — meta.provenance를 모르는 이전 코드로 되돌릴 때", () => {
  it("③ 저장본은 이 PR 이후 코드에서 유효하지만 이전 meta 모양(strict, provenance 없음)은 거부한다 — 되돌리면 조용히 무효", () => {
    const stored = storedInferred();
    assert.equal(validateDevSpec(stored).ok, true);
    assert.equal(OldMetaApprox.safeParse(stored.meta).success, false);
    assert.match(JSON.stringify(OldMetaApprox.safeParse(stored.meta).error.issues), /provenance/);
  });

  it("② provenance만 지우면 다시 올렸을 때 inferred_must_unconfirmed로 무효 — 그래서 변환은 source까지 내린다", () => {
    const r = validateDevSpec(withoutProvenance(storedInferred()));
    assert.equal(r.ok, false);
    assert.match(JSON.stringify(r), /inferred_must_unconfirmed/);
  });

  it("④ 개수 SQL은 SELECT 하나이고 개수만 낸다(내용·id 없음)", () => {
    const body = COUNT_SQL.replace(/^--.*$/gm, "").trim();
    assert.match(body, /^SELECT\b/i);
    assert.doesNotMatch(body, /\b(UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
    assert.doesNotMatch(body, /\bSELECT\s+(id|user_key|dev_spec_json)\b/i);
    assert.equal((body.match(/;/g) ?? []).length, 1);
  });

  it("①② 롤백 SQL을 실제 SQLite에서: provenance 제거·inferred → generated, 나머지 불변, 두 버전 모두 유효, 멱등", async (t) => {
    const db = await sqliteOrSkip(t);
    if (!db) return;
    const stored = storedInferred();
    const generatedWithProv = { ...storedInferred(), meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-10-01T02:00:00.000Z", provenance: { entryPath: "idea" } } };
    generatedWithProv.features = generatedWithProv.features.map((f) => ({ ...f, priority: "must" }));
    const legacy = { ...storedInferred(), meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-20T00:00:00.000Z" } };
    const legacyText = JSON.stringify(legacy);
    const ins = db.prepare("INSERT INTO workspace_projects (id, user_key, dev_spec_json, dev_spec_updated_at) VALUES (?, ?, ?, ?)");
    ins.run("wsp_inferred", "uk_트루픽셀_대표", JSON.stringify(stored), "2026-10-01T01:00:00.000Z");
    ins.run("wsp_generated_prov", "uk_꽃집_사장", JSON.stringify(generatedWithProv), "2026-10-01T02:00:00.000Z");
    ins.run("wsp_legacy", "uk_카페_주인", legacyText, "2026-09-20T00:00:00.000Z");
    ins.run("wsp_null", "uk_빈_프로젝트", null, null);
    ins.run("wsp_broken", "uk_깨진_행", "{깨진 json", "2026-09-01T00:00:00.000Z");

    const before = db.prepare(COUNT_SQL).get();
    assert.deepEqual({ ...before }, { rows_with_provenance: 2, inferred_rows: 1 });

    const res = db.prepare(STRIP_SQL).run();
    assert.equal(Number(res.changes), 2);

    const row = (id) => db.prepare("SELECT dev_spec_json, dev_spec_updated_at FROM workspace_projects WHERE id = ?").get(id);
    const after = JSON.parse(row("wsp_inferred").dev_spec_json);
    assert.equal(after.meta.provenance, undefined);
    assert.equal(after.meta.source, "generated");
    const { meta: _m1, ...restAfter } = after;
    const { meta: _m2, ...restStored } = stored;
    assert.deepEqual(restAfter, restStored, "must/should·AC·화면·계획은 그대로");
    assert.deepEqual(after.features.map((f) => `${f.id}:${f.priority}`), ["FR-001:must", "FR-101:should"]);
    assert.equal(row("wsp_inferred").dev_spec_updated_at, "2026-10-01T01:00:00.000Z");
    // 두 버전 모두에서 유효: 이 PR 이후 코드(다시 올렸을 때) + 이전 meta 모양
    assert.equal(validateDevSpec(after).ok, true, JSON.stringify(validateDevSpec(after)));
    assert.equal(OldMetaApprox.safeParse(after.meta).success, true);

    const afterGen = JSON.parse(row("wsp_generated_prov").dev_spec_json);
    assert.equal(afterGen.meta.provenance, undefined);
    assert.equal(afterGen.meta.source, "generated");
    assert.equal(validateDevSpec(afterGen).ok, true);

    assert.equal(row("wsp_legacy").dev_spec_json, legacyText, "provenance 없는 행은 한 글자도 안 바뀐다");
    assert.equal(row("wsp_null").dev_spec_json, null);
    assert.equal(row("wsp_broken").dev_spec_json, "{깨진 json", "깨진 JSON은 건드리지 않는다(문장이 실패하지도 않는다)");

    assert.equal(Number(db.prepare(STRIP_SQL).run().changes), 0, "멱등");
    assert.deepEqual({ ...db.prepare(COUNT_SQL).get() }, { rows_with_provenance: 0, inferred_rows: 0 });
  });
});
