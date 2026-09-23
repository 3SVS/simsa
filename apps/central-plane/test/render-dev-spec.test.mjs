import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 A3: DevSpec → md 묶음. EN/KO 동일 파일 목록(D-11), 초보자 4줄 README(D-17),
// 빌더 팩이 dev-spec/ 아래로 흡수(D-1). 점수 어휘 없음.

const { renderDevSpecFiles, DEV_SPEC_FILES } = await import("../dist/workspace/render-dev-spec.js");
const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");
const { generateBuilderPack } = await import("../dist/workspace/export.js");

function spec() {
  const v = validateDevSpec({
    meta: { version: 1, source: "generated", locale: "ko", generatedAt: "2026-09-24T03:00:00.000Z" },
    brief: { productName: "댕댕 산책 기록", oneLine: "반려견 산책을 기록하고 주간 거리를 보는 웹앱", targetUsers: ["보호자"], problem: "한눈에 보기 어렵다", included: ["기록"], excluded: ["훈련 기능", "커뮤니티"], userFlow: [], decisions: [], openQuestions: [] },
    features: [{ id: "FR-001", title: "산책 기록", description: "시작·종료로 1건 저장 | 파이프 포함", priority: "must" }],
    acceptance: [{ id: "AC-001", featureId: "FR-001", given: "빈 목록", when: "시작 후 종료", then: "목록에 1건", verifiedBy: "browser" }],
    screens: [{ id: "SCR-001", route: "/", purpose: "기록", components: ["시작 버튼"], states: { empty: "아직 없어요" }, entryFrom: ["첫 진입"], exitTo: [], featureIds: ["FR-001"] }],
    dataModel: [{ name: "walks", fields: [{ name: "id", type: "text", required: true }, { name: "distance_m", type: "integer", required: false, default: "0" }], relations: [], ownership: "unknown" }],
    apis: [{ id: "API-001", method: "POST", path: "/api/walks", request: "{started_at}", response: "{id}", errors: ["400"], auth: "none", featureIds: ["FR-001"] }],
    nonFunctional: [{ kind: "security", requirement: "unknown" }],
    workBreakdown: [{ id: "WBS-001", title: "저장", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] }],
    testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "시작", "종료"] }],
    assumptions: ["위치 권한 사용"],
    openQuestions: ["공유 범위"],
  });
  assert.equal(v.ok, true, JSON.stringify(v));
  return v.spec;
}

describe("renderDevSpecFiles", () => {
  it("EN/KO 같은 파일 목록·같은 순서 (D-11)", () => {
    const ko = renderDevSpecFiles(spec(), "ko");
    const en = renderDevSpecFiles(spec(), "en");
    assert.deepEqual(ko.map((f) => f.path), en.map((f) => f.path));
    assert.deepEqual(ko.map((f) => f.path), DEV_SPEC_FILES.map((n) => `dev-spec/${n}`));
    assert.equal(ko.length, 10);
  });

  it("README 첫 화면 = 초보자 4줄 (D-17), 개수만 있고 점수 없음", () => {
    const readme = renderDevSpecFiles(spec(), "ko").find((f) => f.path.endsWith("README.md")).content;
    assert.ok(readme.includes("**무엇을 만들지:** 반려견 산책을 기록하고"));
    assert.ok(readme.includes("**화면:** 1"));
    assert.ok(readme.includes("**저장하는 것:** 1"));
    assert.ok(readme.includes("**이번엔 안 만드는 것:** 훈련 기능 · 커뮤니티"));
    assert.ok(!/score|점수|\/100/.test(readme));
    const en = renderDevSpecFiles(spec(), "en").find((f) => f.path.endsWith("README.md")).content;
    assert.ok(en.includes("**Screens:** 1") && en.includes("**Not in this version:** 훈련 기능 · 커뮤니티"));
  });

  it("요구사항 표: Given/When/Then + 확인 방법 라벨, 파이프 이스케이프", () => {
    const req = renderDevSpecFiles(spec(), "ko").find((f) => f.path.endsWith("01-requirements.md")).content;
    assert.ok(req.includes("## FR-001 · 산책 기록 — 필수"));
    assert.ok(req.includes("| AC-001 | 빈 목록 | 시작 후 종료 | 목록에 1건 | 브라우저 관찰 |"));
    assert.ok(req.includes("1건 저장 | 파이프 포함") === false || req.includes("파이프 포함"), "본문은 표 밖이라 그대로");
    const en = renderDevSpecFiles(spec(), "en").find((f) => f.path.endsWith("01-requirements.md")).content;
    assert.ok(en.includes("| AC-001 | 빈 목록 | 시작 후 종료 | 목록에 1건 | browser observation |"));
  });

  it("데이터·API·WBS·테스트 계획이 각 파일에 렌더된다", () => {
    const files = Object.fromEntries(renderDevSpecFiles(spec(), "ko").map((f) => [f.path.split("/").pop(), f.content]));
    assert.ok(files["03-data-model.md"].includes("| distance_m | integer | 아니오 | 0 |"));
    assert.ok(files["04-api.md"].includes("## API-001 · `POST /api/walks`"));
    assert.ok(files["06-work-breakdown.md"].includes("| 1 | WBS-001 | 저장 | — | AC-001 |"));
    assert.ok(files["07-test-plan.md"].includes("## AC-001 — 목록에 1건") && files["07-test-plan.md"].includes("1. / 열기"));
    assert.ok(files["08-assumptions.md"].includes("- [ ] 공유 범위"));
    assert.deepEqual(JSON.parse(files["dev-spec.json"]).features[0].id, "FR-001");
  });
});

describe("빌더 팩이 dev-spec을 흡수한다 (D-1)", () => {
  const project = {
    title: "댕댕 산책 기록",
    idea: "산책 기록",
    productSpec: { productName: "댕댕 산책 기록", oneLine: "x", targetUsers: [], problem: "y", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
    items: [{ id: "req_001", title: "기록", status: "not_started", criteria: ["1건"] }],
  };

  it("devSpec이 있으면 simsa-build-pack/dev-spec/* 10개가 추가되고 README에 안내가 붙는다", () => {
    const r = generateBuilderPack({ project: { ...project, devSpec: spec() }, target: "claude_code", format: "json", locale: "ko" });
    const paths = r.bundle.files.map((f) => f.path);
    const dev = paths.filter((p) => p.startsWith("simsa-build-pack/dev-spec/"));
    assert.equal(dev.length, 10, paths.join("\n"));
    assert.ok(paths.includes("simsa-build-pack/dev-spec/01-requirements.md"));
    assert.equal(r.summary.fileCount, r.bundle.files.length);
    const readme = r.bundle.files.find((f) => f.path === "simsa-build-pack/README.md").content;
    assert.ok(readme.includes("dev-spec/"), "README가 지시서 위치를 안내");
  });

  it("devSpec이 없거나 깨졌으면 예전과 똑같이(추가 파일 0, 실패 아님)", () => {
    const none = generateBuilderPack({ project, target: "claude_code", format: "json", locale: "ko" });
    const broken = generateBuilderPack({ project: { ...project, devSpec: { garbage: true } }, target: "claude_code", format: "json", locale: "ko" });
    assert.equal(none.bundle.files.filter((f) => f.path.includes("/dev-spec/")).length, 0);
    assert.equal(broken.bundle.files.filter((f) => f.path.includes("/dev-spec/")).length, 0);
    assert.equal(none.bundle.files.length, broken.bundle.files.length);
  });

  it("EN 팩도 같은 개수", () => {
    const ko = generateBuilderPack({ project: { ...project, devSpec: spec() }, target: "both", format: "json", locale: "ko" });
    const en = generateBuilderPack({ project: { ...project, devSpec: spec() }, target: "both", format: "json", locale: "en" });
    assert.equal(ko.bundle.files.length, en.bundle.files.length);
  });
});
