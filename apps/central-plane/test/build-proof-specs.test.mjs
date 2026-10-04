/**
 * 2026-10-04 — 문 (a) 라이브 실증 러너(tools/simsa-completion-loop-spike/build-proof.mjs)가 PUT하는 기획 두 개가
 * 서버 검증(validateDevSpec)을 통과하는가. 통과 못 하면 실증이 빌드 전에 422로 끝나 아무것도 증명하지 못한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");
const { wbsFromDevSpec } = await import("../dist/routes/workspace-build-jobs.js");
const proof = await import("../../../tools/simsa-completion-loop-spike/lib/build-proof.mjs");

describe("build-proof 기획 — 서버 검증 통과", () => {
  it("정상 기획(B·C)은 유효하고 WBS가 있다", () => {
    const v = validateDevSpec(proof.goodSpec("(주)테스트 동네빵집 예약"));
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.ok(wbsFromDevSpec(v.spec).length >= 1);
  });

  it("깨진 기획(A)도 형식은 유효하다 — 빌드 단계에서 실패해야 한다(검증 단계 422가 아니라)", () => {
    const v = validateDevSpec(proof.brokenSpec("(주)테스트 깨진 기획"));
    assert.equal(v.ok, true, JSON.stringify(v));
    const wbs = wbsFromDevSpec(v.spec);
    assert.equal(wbs.length, 1);
    assert.equal(wbs[0].must, true, "must 작업이라 실패가 빌드를 멈춘다");
  });
});
