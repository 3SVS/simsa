/**
 * 2026-10-06 Bae 결정 "기본 체크 해제" — "맞나요?" 카드의 추론 항목은 체크 해제로 시작한다. 사용자가 직접 체크한 것과
 * "빠진 것"에 적은 것만 확인 목록(→ 지시서 must)이 된다. 카피는 체크한 것만 '안 되면 고쳐야 해요'로 판단한다고 말한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(here, "..", ...p), "utf8");

describe("맞나요? 카드 — 기본 체크 해제", () => {
  it("불러온 추론 항목 전부를 체크 해제(dropped)로 시작한다", () => {
    const card = read("src", "components", "IntentConfirmCard.tsx");
    assert.ok(card.includes("setDropped(new Set(loaded.map((i) => i.id)));"));
    // 확인 목록 = 체크 유지(= dropped 아님) + 직접 적은 것
    assert.ok(card.includes("const kept = [...items.filter((i) => !dropped.has(i.id)), ...added];"));
  });
  it("카피: 꼭 되어야 하는 것에 체크 — 체크한 것만 '안 되면 고쳐야 해요'로 판단(KO/EN)", () => {
    const dict = read("src", "i18n", "dictionary.mjs");
    assert.ok(dict.includes("꼭 되어야 하는 것에 체크해 주세요 — 체크한 것만 '안 되면 고쳐야 해요'로 판단해요."));
    assert.ok(dict.includes("Check the things that must work — only checked items are judged as 'needs a fix if it doesn't work'."));
    assert.ok(!dict.includes("이 앱과 상관없는 항목은 체크를 풀어 주세요."), "옛 '체크를 풀어 주세요' 안내는 없다");
  });
});
