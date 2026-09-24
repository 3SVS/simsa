import { describe, it } from "node:test";
import assert from "node:assert/strict";

// A6 라이브 핫픽스 (2026-09-24, 프로덕션 실측):
//  ① 두 번째 한글 기획에서 모델이 데이터 필드 default를 `null`로 두 번 연속 보내 422(schema)로
//     실패했다. "없음"을 전달하는 방식의 차이지 내용의 결함이 아니다 → 스키마가 받아들이고 벗겨낸다.
//  ② EN 로케일 생성의 본문이 한국어로 나왔다(한글 1,929자) → 프롬프트가 언어를 명시한다.
// 규칙: 이 테스트들은 핫픽스 전 코드에서 실패해야 한다.

const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");
const { generateDevSpec, buildPassPrompt } = await import("../dist/workspace/generate-dev-spec.js");

const brief = { productName: "동네 빵집 픽업 예약", oneLine: "빵을 미리 고르고 픽업 시간을 예약하는 웹앱", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: ["온라인 결제"], userFlow: [], decisions: [], openQuestions: [] };
const items = [{ id: "req_001", title: "예약할 수 있다", status: "not_started", criteria: ["예약이 저장된다"] }];
const P1 = {
  features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 픽업 시간을 예약한다", priority: "must" }],
  acceptance: [{ id: "AC-001", featureId: "FR-001", given: "빵 목록", when: "예약을 누르면", then: "확인 화면이 보인다", verifiedBy: "browser" }],
};
const P2 = (fields) => ({
  screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["예약 버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
  dataModel: [{ name: "reservations", fields, relations: [], ownership: "unknown" }],
  apis: [],
  nonFunctional: [],
});
const P3 = {
  workBreakdown: [{ id: "WBS-001", title: "예약 저장", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
  testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "예약 누름"] }],
  assumptions: [],
  openQuestions: [],
};
const usage = { model: "mock", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1 };
const passOf = (p) => (/작업 분해|work breakdown/i.test(p) ? "plan" : /화면·데이터·API|screens · data/i.test(p) ? "surfaces" : "requirements");
const mock = (res, log = []) => async (prompt) => { const pass = passOf(prompt); log.push(pass); return { text: JSON.stringify(res[pass]), usage }; };

function fullSpec(fields) {
  return { meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-24T03:00:00.000Z" }, brief, features: P1.features, acceptance: P1.acceptance, ...P2(fields), ...P3 };
}

describe("① default: null / \"unknown\" / \"\" → 없음으로 수용", () => {
  it("스키마가 통과시키고 값은 벗겨낸다", () => {
    const v = validateDevSpec(fullSpec([
      { name: "id", type: "text", required: true, default: null },
      { name: "note", type: "text", required: false, default: "unknown" },
      { name: "cnt", type: "integer", required: false, default: "" },
      { name: "kind", type: "text", required: false, default: "walk" },
    ]));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.spec.dataModel[0].fields.map((f) => f.default), [undefined, undefined, undefined, "walk"]);
    assert.equal(JSON.stringify(v.spec).includes('"default":null'), false);
  });

  it("boolean·number default는 실제 기본값 — 문자열로 보존한다 (라이브 2회차: received boolean → 422)", () => {
    const v = validateDevSpec(fullSpec([
      { name: "isPublic", type: "boolean", required: true, default: false },
      { name: "quantity", type: "integer", required: true, default: 1 },
      { name: "ratio", type: "number", required: false, default: 0.5 },
    ]));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.deepEqual(v.spec.dataModel[0].fields.map((f) => f.default), ["false", "1", "0.5"]);
  });

  it("생성기: P2가 null default를 보내도 재시도 없이 통과한다", async () => {
    const log = [];
    const r = await generateDevSpec({ brief, items, locale: "ko", source: "generated" }, mock({ requirements: P1, surfaces: P2([{ name: "id", type: "text", required: true, default: null }]), plan: P3 }, log));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(log, ["requirements", "surfaces", "plan"]);
    assert.equal(r.devSpec.dataModel[0].fields[0].default, undefined);
  });
});

describe("② 프롬프트 언어·default 지침", () => {
  it("EN 프롬프트는 자유 텍스트를 영어로 쓰라고 명시한다", () => {
    const p = buildPassPrompt("requirements", "en", { brief, items: [], idea: "동네 빵집 픽업 예약" });
    assert.ok(/Write ALL free text in \*\*English\*\*/.test(p), p.slice(0, 200));
    assert.ok(/omit the key entirely \(never null or "unknown"\)/.test(p));
  });
  it("KO 프롬프트는 default 생략 지침과 한국어 고정을 담는다", () => {
    const p = buildPassPrompt("surfaces", "ko", { brief, items: [], p1: P1 });
    assert.ok(/없으면 그 키를 아예 생략한다\(null·"unknown" 금지\)/.test(p));
    assert.ok(/모든 자유 텍스트는 \*\*한국어\*\*/.test(p));
  });
});
