/**
 * sample-project.test.mjs — G10 예시 프로젝트 정합성 고정.
 * 예시가 깨진 상태를 보여주면 첫인상이 곧 제품 불신이 된다 — 내용 간 정합을
 * 테스트로 잠근다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSampleProject, SAMPLE_ID_PREFIX } from "../src/lib/sample-project.mjs";
import { packReadiness } from "../src/lib/project-steps.mjs";
import { computeCheckComparison } from "../src/lib/check-compare.mjs";

test("sample is marked and id-prefixed; two builds get distinct ids", () => {
  const a = buildSampleProject();
  const b = buildSampleProject();
  assert.ok(a.project.id.startsWith(SAMPLE_ID_PREFIX));
  assert.notEqual(a.project.id, b.project.id);
  assert.equal(a.ext.isSample, true);
  assert.equal(a.ext.entryPath, "idea");
});

test("check results align with requirements (ids, statuses, summary)", () => {
  const { project, ext } = buildSampleProject();
  const reqIds = new Set(project.requirements.map((r) => r.id));
  for (const r of ext.checkResults.results) {
    assert.ok(reqIds.has(r.itemId), `unknown itemId ${r.itemId}`);
  }
  const byId = new Map(ext.checkResults.results.map((r) => [r.itemId, r.status]));
  for (const req of project.requirements) {
    assert.equal(byId.get(req.id), req.status, `status mismatch for ${req.id}`);
  }
  const s = ext.checkResults.summary;
  assert.equal(s.passed, ext.checkResults.results.filter((r) => r.status === "passed").length);
  assert.equal(s.failed, ext.checkResults.results.filter((r) => r.status === "failed").length);
  assert.equal(s.inconclusive, ext.checkResults.results.filter((r) => r.status === "inconclusive").length);
});

test("showcases the verification badge and a fix for every failed item (fixes_ready)", () => {
  const { ext } = buildSampleProject();
  const failed = ext.checkResults.results.filter((r) => r.status === "failed");
  assert.ok(failed.length >= 1, "sample must include a failed item to demo the loop");
  assert.ok(failed.some((r) => r.verification === "dual_confirmed"), "must demo the dual-check badge");
  const readiness = packReadiness(ext.checkResults, ext.fixSuggestions);
  assert.equal(readiness.state, "fixes_ready", "export screen must show the green fixes-ready state");
});

test("every requirement has criteria; failed item conflicts with an excluded scope entry", () => {
  const { project, ext } = buildSampleProject();
  for (const req of project.requirements) {
    assert.ok((ext.itemCriteria?.[req.id] ?? []).length >= 1, `criteria missing for ${req.id}`);
  }
  const failed = ext.checkResults.results.find((r) => r.status === "failed");
  assert.ok(failed.evidence.some((e) => ext.productSpec.excluded.includes(e)));
});

test("re-checking the sample can demo the comparison path (self-consistent baseline)", () => {
  const { ext } = buildSampleProject();
  // 같은 결과로 비교하면 회귀/회복 0 — 예시 자체가 회귀 상태로 시작하지 않는다.
  const cmp = computeCheckComparison(ext.checkResults.results, ext.checkResults.results);
  assert.equal(cmp.regressions.length, 0);
  assert.equal(cmp.recovered.length, 0);
  assert.equal(cmp.comparedCount, ext.checkResults.results.length);
});
