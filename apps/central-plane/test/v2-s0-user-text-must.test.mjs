// v2 S0 (2026-10-21) — 설계 §5 S0 "직접 적은 항목 버그 확인". 사용자가 "빠진 것"에 직접 적은 항목(id user_…)이
// 확인 계획 → 기능 must 승격 → 확인 AC id → 직접 적은 AC id까지 끊기지 않고 이어지는지 잠근다.
// 마지막 고리(지시서 → 검사 AC must·user_text)는 agent-inspection.test.mjs "G2"가 잠근다.
import { test } from "node:test";
import assert from "node:assert/strict";

const { planInferredConfirmation, userTextAcIdsOf } = await import("../dist/workspace/generate-dev-spec.js");
const { applyInferredConfirmation } = await import("../dist/workspace/dev-spec.js");

test("직접 적은 항목은 체크한 항목과 함께 must가 되고, 그 AC는 확인 목록과 직접 적은 목록 둘 다에 든다", () => {
  const items = [
    { id: "item_1", title: "날짜·시간 고르기" },
    { id: "user_1", title: "같은 시간 두 번 예약 막기" },
    { id: "item_2", title: "후기 남기기" },
  ];
  // 카드는 직접 적은 항목을 확인 목록에 넣는다(IntentConfirmCard.confirm · withUserAuthoredItems).
  const plan = planInferredConfirmation(items, ["item_1", "user_1"]);
  assert.deepEqual(plan.confirmed.map((c) => [c.featureId, c.item.id]), [["FR-001", "item_1"], ["FR-002", "user_1"]]);
  assert.deepEqual(plan.unconfirmed.map((i) => i.id), ["item_2"]);

  const features = [
    { id: "FR-001", title: "날짜·시간", priority: "must" },
    { id: "FR-002", title: "중복 예약 막기", priority: "should" }, // 생성기가 should로 냈어도
    { id: "FR-101", title: "후기", priority: "must" },
  ];
  const acceptance = [
    { id: "AC-001", featureId: "FR-001" },
    { id: "AC-002", featureId: "FR-002" },
    { id: "AC-101", featureId: "FR-101" },
  ];
  const applied = applyInferredConfirmation({ features, acceptance }, new Set(plan.confirmed.map((c) => c.featureId)));
  assert.deepEqual(applied.features.map((f) => [f.id, f.priority]), [["FR-001", "must"], ["FR-002", "must"], ["FR-101", "should"]]);
  assert.deepEqual(applied.userConfirmedAcIds, ["AC-001", "AC-002"]);
  assert.deepEqual(userTextAcIdsOf(acceptance, plan), ["AC-002"]);
});

test("확인 목록에 없는 직접 적은 항목은 must가 되지 않는다 — 그래서 카드·항목 화면이 직접 적은 것을 확인 목록에 반드시 넣는다", () => {
  const plan = planInferredConfirmation([{ id: "item_1", title: "a" }, { id: "user_1", title: "b" }], ["item_1"]);
  assert.deepEqual(plan.confirmed.map((c) => c.item.id), ["item_1"]);
  assert.deepEqual(userTextAcIdsOf([{ id: "AC-001", featureId: "FR-001" }, { id: "AC-101", featureId: "FR-101" }], plan), []);
});
