/**
 * build-proof — 문 (a) 라이브 실증 3종 판정(순수). 러너(build-proof.mjs)는 네트워크를 쓰므로 여기선 판정·인자·기획만 고정한다.
 * 기획이 서버 검증(validateDevSpec)을 통과하는지는 central-plane 테스트(build-proof-specs.test.mjs)가 본다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brokenSpec, evaluateProof, goodSpec, isTerminal, MISSING_PACKAGE, parseArgs, summaryLine } from "../lib/build-proof.mjs";

describe("evaluateProof", () => {
  it("A: failed(building) · 배포 없음만 통과", () => {
    assert.equal(evaluateProof("A", { status: "failed", failedStage: "building", deployedUrl: null }).pass, true);
    assert.match(evaluateProof("A", { status: "failed", failedStage: "testing", deployedUrl: null }).reason, /failed_at_testing/);
    assert.equal(evaluateProof("A", { status: "done", deployedUrl: "https://x.simsa.page" }).pass, false);
    assert.equal(evaluateProof("A", { status: "failed", failedStage: "building", deployedUrl: "https://x.simsa.page" }).reason, "deployed_despite_failure");
  });

  it("B: done + 주소 + 헬스 ok + 페이지 200·script", () => {
    const done = { status: "done", deployedUrl: "https://bakery.simsa.page" };
    assert.equal(evaluateProof("B", done, { healthOk: true, pageStatus: 200, pageHasScript: true }).pass, true);
    assert.equal(evaluateProof("B", done, null).reason, "site_not_checked");
    assert.equal(evaluateProof("B", done, { healthOk: true, pageStatus: 404, pageHasScript: false }).reason, "page_status_404");
    assert.match(evaluateProof("B", { status: "failed", failedStage: "building", error: "tsc exited 2" }).reason, /expected_done_got_failed/);
  });

  it("C: failed(budget) — 단계 또는 사유에 budget", () => {
    assert.equal(evaluateProof("C", { status: "failed", failedStage: "budget", spentUsd: 0.52, budgetUsd: 0.5 }).pass, true);
    assert.equal(evaluateProof("C", { status: "failed", failedStage: "implementing", error: "stopped: budget exceeded" }).pass, true);
    assert.match(evaluateProof("C", { status: "failed", failedStage: "building", error: "tsc" }).reason, /failed_but_not_budget/);
  });

  it("끝나지 않은 잡·잡 없음은 통과가 아니다", () => {
    assert.equal(evaluateProof("B", null).reason, "no_job");
    assert.equal(evaluateProof("B", { status: "building" }).reason, "not_terminal:building");
    assert.equal(isTerminal({ status: "done" }), true);
    assert.equal(isTerminal({ status: "testing" }), false);
  });
});

describe("기획·인자", () => {
  it("한글 이름(Rule 6)과 깨진 기획의 존재하지 않는 패키지", () => {
    assert.match(goodSpec().brief.productName, /동네빵집/);
    const b = brokenSpec();
    assert.ok(b.workBreakdown[0].title.includes(MISSING_PACKAGE));
    assert.equal(b.features[0].priority, "must");
  });

  it("parseArgs 기본값·--only·--keep", () => {
    const d = parseArgs([]);
    assert.deepEqual(d.only, ["A", "B", "C"]);
    assert.equal(d.keep, false);
    assert.equal(d.budgetC, 0.5);
    const o = parseArgs(["--only", "cb", "--keep", "--budget", "0.3", "--base", "http://localhost:8787/"]);
    assert.deepEqual(o.only, ["C", "B"]);
    assert.equal(o.keep, true);
    assert.equal(o.budgetC, 0.3);
    assert.equal(o.base, "http://localhost:8787");
  });

  it("요약 한 줄", () => {
    assert.match(summaryLine([{ kind: "A", pass: true, reason: "x" }, { kind: "B", pass: false, reason: "y" }]), /^build-proof: 1\/2 통과/);
  });
});
