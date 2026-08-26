/**
 * persistence-gate.test.mjs — 지속성 검사의 **관문** (2026-08-26).
 *
 * ## 왜 바뀌었나
 *
 * 종전 관문은 `본문에 입력값이 들어 있는가`였다. 너무 약하다 — 단위 변환기에 `5`를
 * 넣으면 결과가 "5 km = 3.11 miles"라 관문을 통과하고, 새로고침하면 당연히 사라지므로
 * **작동하는 앱이 "낙관적 유령"으로 오판**됐다(F2 라이브 실측, FALSE-NEGATIVE).
 *
 * 멀쩡한 앱을 고장이라 하는 것은 이 제품에서 **가장 비싼 오답**이다. 사용자가 자기
 * 앱이 되는 걸 아는 상태에서 그 말을 들으면 그때부터 우리 판정을 믿지 않는다.
 *
 * ## 진짜 구분점
 *
 * **모음이 자랐는가.** 기록장은 목록에 항목이 **추가**되고, 변환기는 결과 한 칸이
 * **교체**된다. 저장할 것이 없는 앱에 저장을 요구하지 않는다.
 *
 * 아래는 라이브 픽스처에서 실측한 값을 계약으로 고정한 것이다:
 *   F2 변환기(정상)     항목 0→0  관문 미통과 → 지속성 null (판정 무영향)
 *   F6 기록장(진짜 결함) 항목 1→2  관문 통과   → 지속성 false → Needs Fix
 *   F1 할일앱(정상)     항목 0→1  관문 통과   → 지속성 true
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { decideFromEvidence } = await import("../dist/nondev-report.js");

/** 컨테이너의 관문 로직과 같은 형태(inspector-run.mjs). */
const gatePasses = (itemsBefore, itemsAfter) => itemsAfter > itemsBefore;

describe("관문 — 모음이 자란 흐름에서만 지속성을 묻는다", () => {
  it("★변환기: 항목이 늘지 않으면 관문을 통과하지 않는다 (F2 오답의 원인)", () => {
    assert.equal(gatePasses(0, 0), false);
  });

  it("기록장·할일앱: 항목이 늘면 관문을 통과한다", () => {
    assert.equal(gatePasses(1, 2), true, "F6");
    assert.equal(gatePasses(0, 1), true, "F1");
  });
});

describe("판정 — 관문을 통과하지 않으면 지속성이 판정에 영향을 주지 않는다", () => {
  const base = {
    consoleErrors: [],
    networkFailures: [],
    primaryActionFound: true,
    interacted: true,
    visibleChangeAfterAction: true,
  };

  it("★F2 재현: 화면은 바뀌었고 저장은 안 했지만 **측정하지 않았으므로** 고장이 아니다", () => {
    const d = decideFromEvidence({ ...base, persistedAfterReload: null }, [{ ok: true }]);
    assert.equal(d, "Conditionally Ready", "작동하는 변환기를 고장이라 하면 안 된다");
  });

  it("★F6 재현: 측정했고 저장이 안 됐으면 고장이다 — 진짜 결함은 계속 잡는다", () => {
    const d = decideFromEvidence({ ...base, persistedAfterReload: false }, [{ ok: true }]);
    assert.equal(d, "Needs Fix");
  });

  it("F1 재현: 측정했고 저장됐으면 문제를 찾지 못한 것", () => {
    const d = decideFromEvidence({ ...base, persistedAfterReload: true }, [{ ok: true }]);
    assert.equal(d, "Conditionally Ready");
  });

  it("측정 안 됨(null)과 저장 안 됨(false)은 절대 같지 않다", () => {
    const unmeasured = decideFromEvidence({ ...base, persistedAfterReload: null }, [{ ok: true }]);
    const measured = decideFromEvidence({ ...base, persistedAfterReload: false }, [{ ok: true }]);
    assert.notEqual(unmeasured, measured, "뭉뜽그리면 멀쩡한 앱이 고장이 된다");
  });
});
