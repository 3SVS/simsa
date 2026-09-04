/**
 * confirm-verdict.test.mjs — ★확언("작동해요")은 언제 나오는가 (2026-09-01).
 *
 * ## 왜 이 파일이 중요한가
 *
 * 이 제품은 **최초 버전부터 긍정 확언을 낼 수 없었다** — `"Ready"`를 반환하는 코드가
 * 아예 없었다. 8/26에 중간 단계("문제를 찾지 못했어요")를 만들었지만, 확언은 여전히
 * 불가능했다. 이 커밋이 그 마지막 칸을 채운다.
 *
 * 확언의 근거는 **재로그인 왕복**이다: 만들고 → 로그아웃하고 → 다시 로그인해서 →
 * 그게 아직 있으면, 그건 추측이 아니라 **증명**이다. 낙관적 UI만 있는 앱은 여기서
 * 반드시 걸린다(화면만 바뀌고 재로그인하면 사라진다).
 *
 * 그래서 이 테스트가 지키는 것은 **확언을 남발하지 않는 것**이다. 하나라도 빠지면
 * 확언하지 않는다 — 잘못된 안심은 잘못된 경고보다 오래 남는다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { decideFromEvidence, decisionToWorks, buildNonDevReport } = await import("../dist/nondev-report.js");

/** 확언이 나오는 유일한 조합. */
const CONFIRMED = {
  consoleErrors: [],
  networkFailures: [],
  primaryActionFound: true,
  interacted: true,
  visibleChangeAfterAction: true,
  loginDepth: "L3",
  persistedAfterReload: true,
};
const ALL_OK = [{ ok: true }];

describe("★확언이 나오는 자리", () => {
  it("로그인 뒤까지 들어갔고 재로그인 왕복이 확인되면 Ready", () => {
    assert.equal(decideFromEvidence(CONFIRMED, ALL_OK), "Ready");
    assert.equal(decisionToWorks("Ready"), true);
  });

  it("리포트가 '정상 작동해요'로 읽힌다", () => {
    const r = buildNonDevReport(
      { targetUrl: "https://x.dev", intentAnchor: "메모가 저장되어야 한다", decision: "Ready",
        consoleErrors: [], networkFailures: [], primaryActionFound: true, interacted: true },
      "ko",
    );
    assert.equal(r.works, true);
    assert.equal(r.verdict, "정상 작동해요");
  });
});

describe("★하나라도 빠지면 확언하지 않는다", () => {
  it("로그인 뒤를 못 봤으면(L1) 확언 없음 — 지금까지의 모든 검수가 여기다", () => {
    assert.equal(decideFromEvidence({ ...CONFIRMED, loginDepth: "L1" }, ALL_OK), "Conditionally Ready");
  });

  it("깊이를 모르면 확언 없음", () => {
    assert.equal(decideFromEvidence({ ...CONFIRMED, loginDepth: null }, ALL_OK), "Conditionally Ready");
    const { loginDepth, ...noDepth } = CONFIRMED;
    assert.equal(decideFromEvidence(noDepth, ALL_OK), "Conditionally Ready");
  });

  it("★왕복을 재지 못했으면(null) 확언 없음 — 측정 안 된 것은 증거가 아니다", () => {
    assert.equal(decideFromEvidence({ ...CONFIRMED, persistedAfterReload: null }, ALL_OK), "Conditionally Ready");
  });

  it("왕복에서 사라졌으면 고장이다 — 로그인 뒤에서도 Potemkin은 잡는다", () => {
    assert.equal(decideFromEvidence({ ...CONFIRMED, persistedAfterReload: false }, ALL_OK), "Needs Fix");
  });

  it("스텝을 완주 못 했으면 확언 없음", () => {
    assert.equal(decideFromEvidence(CONFIRMED, [{ ok: true }, { ok: false }]), "User Acceptance Required");
  });

  it("결함 신호가 하나라도 있으면 확언 없음", () => {
    assert.equal(decideFromEvidence({ ...CONFIRMED, networkFailures: ["HTTP 500"] }, ALL_OK), "Needs Fix");
    assert.equal(decideFromEvidence({ ...CONFIRMED, loadStatus: 500 }, ALL_OK), "Needs Fix");
  });
});

describe("확언해도 한계는 계속 말한다", () => {
  it("Ready여도 '로그인 뒤' 문구가 사라지지는 않는다 — 본 범위는 여전히 한 흐름", () => {
    const r = buildNonDevReport(
      { targetUrl: "https://x.dev", intentAnchor: "x", decision: "Ready",
        consoleErrors: [], networkFailures: [], primaryActionFound: true, interacted: true },
      "ko",
    );
    // 확언 문구는 "눈으로 확인한 범위에서"라고 스스로 한정한다.
    assert.match(r.oneLine, /확인한 범위/);
  });
});
