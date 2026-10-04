/**
 * Train K 후속 (2026-10-04, Bae "남은 결정 다 너의 제안대로") — 학습 동의 버전 올림.
 * 예전 압박성 팝업으로 받은 동의(2026-07-03 버전)는 더 이상 유효하지 않다: 저장 경로는
 * consent_version이 현재 값과 같을 때만 동의로 센다(training-consent-db.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { TRAINING_CONSENT_VERSION } = await import("../dist/workspace/training-consent-db.js");

describe("학습 동의 버전", () => {
  it("2026-10-04로 올렸다 — 2026-07-03 동의는 현재 버전이 아니다", () => {
    assert.equal(TRAINING_CONSENT_VERSION, "2026-10-04");
    assert.notEqual("2026-07-03", TRAINING_CONSENT_VERSION);
  });
});
