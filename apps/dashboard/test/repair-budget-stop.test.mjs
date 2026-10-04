/**
 * 비용 권고 ② (2026-09-30, D-7 amend [PILOT]) — 수리 잡당 달러 상한의 대시보드 한 줄.
 *
 * 서버 계약(central-plane repair 잡 뷰): 컨테이너가 잡 예산에 닿아 AI 호출을 멈추고 기존 정직
 * 폴백(고침 지시서 초안 PR)으로 마감하면 `stoppedByBudget: true`. done + brief_only에서만 참이고,
 * 옛 서버는 필드가 없다(→ 아무 줄도 안 보인다).
 *
 * 카드: 기존 brief_only 완료 문구("코드가 자동으로 수정된 건 아직 아니에요 — 이 PR을 …넘겨")는 그대로 두고
 * **왜** 멈췄는지 한 줄만 더한다. 금액은 말하지 않는다(사용자 과금이 아니다). 초보자 금칙어 0.
 *
 * 각 검사는 고치기 전 코드·사전에서 실패한다(마지막 행동 보존 가드 제외).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const repairState = await import("../src/lib/repair-state.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

test("repairStoppedByBudget: done + brief_only + stoppedByBudget === true 일 때만", () => {
  const fn = repairState.repairStoppedByBudget;
  assert.equal(typeof fn, "function", "repair-state.mjs must export repairStoppedByBudget()");
  assert.equal(fn({ status: "done", mode: "brief_only", stoppedByBudget: true }), true);
  assert.equal(fn({ status: "done", mode: null, stoppedByBudget: true }), true, "legacy/unknown mode is the brief card");
  assert.equal(fn({ status: "done", mode: "auto_fix", stoppedByBudget: true }), false, "never on a card that says code changed");
  assert.equal(fn({ status: "failed", mode: "brief_only", stoppedByBudget: true }), false);
  assert.equal(fn({ status: "running", stoppedByBudget: true }), false);
  assert.equal(fn({ status: "done", mode: "brief_only" }), false, "old server: no field → no line");
  assert.equal(fn({ status: "done", mode: "brief_only", stoppedByBudget: "true" }), false, "wire value must be a real boolean");
  assert.equal(fn(null), false);
});

test("사전: visualChecks.repair.budgetStopped — KO/EN 모두, 금액 없음, 초보자 금칙어 0", () => {
  for (const loc of ["ko", "en"]) {
    const s = DICTIONARIES[loc].visualChecks.repair.budgetStopped;
    assert.equal(typeof s, "string", `${loc} budgetStopped`);
    assert.ok(s.length > 0);
    assert.ok(!s.includes("$"), "no cost number on the user's screen");
    assert.deepEqual(devTermHits(s), [], `${loc}: ${s}`);
  }
  assert.ok(!/[가-힣]/.test(DICTIONARIES.en.visualChecks.repair.budgetStopped), "EN has no Hangul");
  assert.match(DICTIONARIES.ko.visualChecks.repair.budgetStopped, /한도/);
});

test("[소스 불변식·약함] 수리 카드: brief 완료 카드에 budgetStopped 한 줄을 repairStoppedByBudget으로만 띄운다", () => {
  const page = readFileSync(path.join(HERE, "../src/app/projects/[id]/visual-checks/[runId]/page.tsx"), "utf8");
  assert.match(page, /repairStoppedByBudget\(repair\)\s*&&[\s\S]{0,300}s\.budgetStopped/);
  const api = readFileSync(path.join(HERE, "../src/lib/workspace-visual-checks-api.ts"), "utf8");
  assert.match(api, /stoppedByBudget\?: boolean/);
});

// [정정 2026-10-04] 여정 감사 P2: 완료 문구를 비개발자 말로 바꿨다(PR·초안 PR·코딩 에이전트 제거). 예산 정지 문구는
// 여전히 이 문장에 한 줄을 더할 뿐이라는 계약은 그대로다 — 고정값만 새 문장으로.
test("행동 보존: brief_only 완료 문구는 그대로 (한 줄을 더할 뿐)", () => {
  assert.equal(
    DICTIONARIES.ko.visualChecks.repair.doneBody,
    "무엇을 어떻게 고칠지 적은 고침 지시서(SIMSA-FIX-BRIEF.md)를 연결된 저장소에 올려 두었어요. 코드가 자동으로 고쳐진 건 아니에요 — [고친 내용 보기]에서 열어, 앱을 만들 때 쓴 AI 도구나 개발자에게 넘겨 이어서 진행하세요.",
  );
});
