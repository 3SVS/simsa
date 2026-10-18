/**
 * "맞나요?" 카드의 "빠졌는데 꼭 되어야 하는 것" (2026-10-05) — 앱에서 못 읽은 원래 의도를 사용자가 적으면
 * 그대로 확인된 항목(user_N)이 된다. 벤치마크 #1 로컬 실측: 추론 항목이 화면 표시뿐이라 고장 난 앱이 "정상"이었다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { missingItemsFromText, MAX_MISSING_ITEMS } from "../src/lib/intent-missing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("missingItemsFromText", () => {
  it("한 줄에 하나, 글머리표 정리, 빈 줄·중복 제거", () => {
    const items = missingItemsFromText("- 이미 예약된 시간은 다른 손님이 못 골라야 해요\n\n• 사장님이 오늘 예약을 봐야 해요\n- 이미 예약된 시간은 다른 손님이 못 골라야 해요\n1) 새로고침해도 예약이 남아야 해요");
    assert.deepEqual(items.map((i) => [i.id, i.title]), [
      ["user_1", "이미 예약된 시간은 다른 손님이 못 골라야 해요"],
      ["user_2", "사장님이 오늘 예약을 봐야 해요"],
      ["user_3", "새로고침해도 예약이 남아야 해요"],
    ]);
  });
  it("기존 항목 id와 겹치지 않고, 상한을 지킨다", () => {
    assert.equal(missingItemsFromText("가나다", ["user_1"])[0].id, "user_2");
    const many = Array.from({ length: 20 }, (_, i) => `요구 ${i}`).join("\n");
    assert.equal(missingItemsFromText(many).length, MAX_MISSING_ITEMS);
  });
  it("카드가 적은 항목을 확인 목록(kept)에 넣는다", () => {
    const src = readFileSync(path.join(here, "..", "src", "components", "IntentConfirmCard.tsx"), "utf8");
    assert.match(src, /missingItemsFromText\(missing, items\.map/);
    assert.match(src, /\.\.\.added\]/);
  });
});
