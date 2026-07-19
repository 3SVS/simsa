/**
 * project-restore.test.mjs — G8 D-2 (DR-3): 서버 페이로드 → 로컬 재구성 고정.
 * 복원의 목표는 "루프를 계속할 수 있는 상태" — 깨진 서버 값이 UI를 깨지 않게
 * 상태 화이트리스트·기본값·ext 보강을 잠근다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLocalProjectFromServer } from "../src/lib/project-restore.mjs";

const SERVER = {
  id: "proj_x",
  title: "빵집 예약",
  idea: "동네 빵집 예약 앱",
  createdAt: "2026-07-10T09:00:00Z",
  productSpec: {
    productName: "빵집 예약",
    oneLine: "예약하고 찾아가는 앱",
    problem: "헛걸음",
    included: ["예약"],
    excluded: ["결제"],
    openQuestions: ["취소 기한"],
  },
  items: [
    { id: "r1", title: "예약", status: "passed", criteria: ["a"] },
    { id: "r2", title: "결제", status: "weird_status" },
    { id: "", title: "no-id는 버려짐" },
  ],
};

test("full mapping: name/desc/spec/requirements from server payload", () => {
  const { project } = buildLocalProjectFromServer(SERVER, null);
  assert.equal(project.id, "proj_x");
  assert.equal(project.name, "빵집 예약");
  assert.equal(project.description, "예약하고 찾아가는 앱");
  assert.equal(project.createdAt, "2026-07-10");
  assert.deepEqual(project.spec.excluded, ["결제"]);
  assert.deepEqual(project.spec.openDecisions, ["취소 기한"]);
  assert.equal(project.requirements.length, 2); // no-id dropped
  assert.equal(project.requirements[0].status, "passed");
});

test("unknown status normalized to not_started (broken server value never breaks UI)", () => {
  const { project } = buildLocalProjectFromServer(SERVER, null);
  assert.equal(project.requirements[1].status, "not_started");
});

test("server ext wins; productSpec/entryPath backfilled when missing", () => {
  const serverExt = { checkResults: { ok: true, source: "llm", summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [] } };
  const { ext } = buildLocalProjectFromServer(SERVER, serverExt);
  assert.ok(ext.checkResults);
  assert.equal(ext.productSpec.productName, "빵집 예약"); // backfilled from mirror
  assert.equal(ext.entryPath, "idea");
});

test("ext with its own productSpec/entryPath is not overwritten", () => {
  const serverExt = { entryPath: "code", productSpec: { productName: "다른 이름" } };
  const { ext } = buildLocalProjectFromServer(SERVER, serverExt);
  assert.equal(ext.entryPath, "code");
  assert.equal(ext.productSpec.productName, "다른 이름");
});

test("minimal server row (no spec/items) still yields a loadable project", () => {
  const { project, ext } = buildLocalProjectFromServer({ id: "p", idea: "아이디어만" }, null);
  assert.equal(project.name, "복원된 프로젝트");
  assert.equal(project.description, "아이디어만");
  assert.deepEqual(project.requirements, []);
  assert.equal(ext.entryPath, "idea");
});
