/**
 * 고칠 것이 없는 결과에 '고치기'를 내밀지 않는다 (2026-09-29 라이브 실측).
 *
 * Bae의 실제 앱(3svs-internship.vercel.app) 첫 확인 결과: 판정 "문제를 찾지 못했어요", 발견은 외부 스크립트
 * 잡음(severity "info") 1건뿐, 다음 할 일은 (#560 뒤) "지금 고칠 것은 없어요". 그런데 같은 화면 위쪽에
 * "고치기 시작 — Simsa가 … 이 문제를 직접 고쳐 보고 … SIMSA-FIX-BRIEF.md" + [고치기] 버튼, 그리고
 * "바로 고치게 하기 — 코딩 에이전트(Claude Code, Cursor 등)에 붙여넣으세요" + [고침 지시 복사]가 떴다.
 * 판정·다음 할 일·행동 버튼이 서로 반대말을 했다.
 *
 * 규칙은 서버(nondev-report.ts의 somethingToFix)와 같다: 정보가 아닌 발견이 있거나, 작동 안 함이거나,
 * 판정이 "문제 못 찾음"(Conditionally Ready)이 아닌 미확정이면 고칠 것이 있다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as repair from "../src/lib/repair-state.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const noise = { severity: "info", code: "noise_third_party", what: "외부 스크립트 일부가 불러와지지 않았어요" };
const realIssue = { severity: "medium", code: "step_failed", what: "예약 버튼을 눌러도 아무 일도 없어요" };

/** Bae 실측 모양: 끝남 · Conditionally Ready · works null · 잡음 1건. */
const NOTHING_TO_FIX = { status: "done", decision: "Conditionally Ready", works: null, report: { findings: [noise] } };

describe("hasSomethingToFix — 서버 somethingToFix와 같은 규칙", () => {
  it("문제 못 찾음 + 정보 항목만 → 고칠 것 없음 (옛 코드엔 이 함수가 없다)", () => {
    assert.equal(typeof repair.hasSomethingToFix, "function");
    assert.equal(repair.hasSomethingToFix(NOTHING_TO_FIX), false);
    assert.equal(repair.hasSomethingToFix({ ...NOTHING_TO_FIX, report: { findings: [] } }), false);
  });
  it("정보가 아닌 발견이 하나라도 있으면 고칠 것 있음", () => {
    assert.equal(repair.hasSomethingToFix({ ...NOTHING_TO_FIX, report: { findings: [noise, realIssue] } }), true);
  });
  it("작동 안 함(works false)이면 발견 목록과 무관하게 고칠 것 있음", () => {
    assert.equal(repair.hasSomethingToFix({ status: "done", decision: "Needs Fix", works: false, report: { findings: [] } }), true);
  });
  it("미확정 판정(문제 못 찾음이 아님)은 고칠 것 있음으로 본다 — 서버와 같음", () => {
    assert.equal(repair.hasSomethingToFix({ status: "done", decision: "User Acceptance Required", works: null, report: { findings: [] } }), true);
    assert.equal(repair.hasSomethingToFix({ status: "done", decision: "Needs Clarification", works: null }), true);
  });
  it("정상 작동(works true)은 고칠 것 없음", () => {
    assert.equal(repair.hasSomethingToFix({ status: "done", decision: "Ready", works: true, report: { findings: [noise] } }), false);
  });
  it("레거시 행(판정·리포트 없음, works null)은 종전처럼 고칠 수 있다 [행동 보존]", () => {
    assert.equal(repair.hasSomethingToFix({ status: "done", works: null }), true);
  });
  it("값이 이상하면 false (빈 값·문자열)", () => {
    assert.equal(repair.hasSomethingToFix(null), false);
    assert.equal(repair.hasSomethingToFix("done"), false);
  });
});

describe("canRepair · repairEntryMode — 고칠 것이 없으면 입구도 없다", () => {
  it("Bae 실측 모양: canRepair false (옛 코드: true)", () => {
    assert.equal(repair.canRepair(NOTHING_TO_FIX), false);
  });
  it("Bae 실측 모양 + 저장소 연결됨: repairEntryMode 'none' (옛 코드: 'repair')", () => {
    assert.equal(repair.repairEntryMode(NOTHING_TO_FIX, true), "none");
    assert.equal(repair.repairEntryMode(NOTHING_TO_FIX, false), "none");
  });
  it("[행동 보존] 진짜 문제가 있으면 종전 그대로 repair / builder_paste", () => {
    const broken = { status: "done", decision: "Needs Fix", works: false, report: { findings: [realIssue] } };
    assert.equal(repair.repairEntryMode(broken, true), "repair");
    assert.equal(repair.repairEntryMode(broken, false), "builder_paste");
  });
});

describe("결과 화면 배선 — 고칠 것이 없으면 '고침 지시' 카드도 없다", () => {
  const page = readFileSync(path.resolve(HERE, "../src/app/projects/[id]/visual-checks/[runId]/page.tsx"), "utf8");
  it("fixTitle 카드가 hasSomethingToFix로 감싸져 있다", () => {
    const i = page.indexOf("t.visualChecks.fixTitle");
    assert.ok(i > 0, "fixTitle 카드가 있다");
    const before = page.slice(Math.max(0, i - 1200), i);
    assert.match(before, /hasSomethingToFix\(check\)/, "카드 앞 조건에 hasSomethingToFix(check)가 있어야 한다");
  });
});
