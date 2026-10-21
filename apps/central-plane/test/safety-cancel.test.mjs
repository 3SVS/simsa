// 2026-10-20 격차 §8 c-4: 영어 "Cancel"·"×"·"취소"·"지우기"가 안전 클릭으로 통과해
// 화면 점검(sweep)·핵심 흐름이 남의 예약 취소 버튼을 누를 수 있었다.
// 두 사본(inspector-container·spike)이 같은 판정을 내는지도 함께 잠근다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyActionSafety as container } from "../inspector-container/safety.mjs";
import { classifyActionSafety as spike } from "../../../tools/simsa-completion-loop-spike/lib/safety.mjs";

const UNSAFE = ["Cancel", "Cancel booking", "cancel reservation", "×", "✕", "✖", "❌", "취소", "예약 취소", "예약 지우기", "기록 제거", "삭제", "결제하기"];
const SAFE = ["예약하기", "Book now", "다음", "Cancellation policy", "관리", "10:00"];

for (const [name, fn] of [["container", container], ["spike", spike]]) {
  test(`${name}: 취소·지우기 계열은 안전 클릭이 아니다(delete 범주)`, () => {
    for (const t of UNSAFE) {
      const r = fn(t);
      assert.equal(r.safe, false, `${t} 는 막혀야 한다`);
    }
    for (const t of ["Cancel", "×", "취소", "예약 지우기", "기록 제거"]) {
      assert.equal(fn(t).category, "delete", `${t} 범주`);
    }
  });
  test(`${name}: 일반 진행 버튼은 그대로 안전`, () => {
    for (const t of SAFE) assert.equal(fn(t).safe, true, `${t} 는 눌러도 된다`);
  });
}

test("두 사본의 판정이 같다", () => {
  for (const t of [...UNSAFE, ...SAFE]) assert.deepEqual(container(t), spike(t), t);
});
