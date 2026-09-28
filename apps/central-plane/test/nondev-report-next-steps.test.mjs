/**
 * 리포트 "다음 할 일" — 고칠 것이 없을 때 고치라고 하지 않는다 (2026-09-28 실측).
 *
 * Bae의 실제 앱(3svs-internship.vercel.app) 검수 결과가 "문제를 찾지 못했어요"인데 다음 할 일이
 *   "가장 급한 것부터: 특별히 고칠 필요는 없어요…" / "고친 뒤 이 검수를 한 번 더 돌려서…"
 * 였다. 외부 스크립트 잡음(info, noise_third_party)이 '가장 급한 것'으로 올라갔고, 재검수 안내는
 * 고칠 것이 없어도 항상 붙었다. 판정과 다음 할 일이 서로 반대말을 했다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNonDevReport } from "../dist/nondev-report.js";

const base = {
  targetUrl: "https://3svs-internship.vercel.app/",
  intentAnchor: "대학 학생이 현장실습을 신청하고 배치·평가·기록을 확인할 수 있어야 한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: null,
  routeChanged: false,
  consoleErrors: [],
  networkFailures: [],
  steps: [],
};
const NOISE = ["GET https://www.googletagmanager.com/gtag/js?id=G-XXXX net::ERR_BLOCKED_BY_CLIENT"];

for (const locale of ["ko", "en"]) {
  const L = locale;
  test(`[${L}] 문제 못 찾음 + 외부 잡음만 → 잡음이 '가장 급한 것'이 아니고, '고친 뒤 다시'도 없다`, () => {
    const r = buildNonDevReport({ ...base, decision: "Conditionally Ready", noiseFailures: NOISE }, L);
    assert.ok(r.findings.some((f) => f.code === "noise_third_party"), "잡음 항목 자체는 리포트에 남는다(정보)");
    const joined = r.nextSteps.join("\n");
    assert.doesNotMatch(joined, L === "ko" ? /가장 급한 것부터/ : /Most urgent first/, joined);
    assert.doesNotMatch(joined, L === "ko" ? /고친 뒤/ : /After fixing/, joined);
    assert.ok(r.nextSteps.length >= 1, "다음 할 일이 비지 않는다");
  });

  test(`[${L}] 정상 작동(Ready) → '고친 뒤 다시' 없음`, () => {
    const r = buildNonDevReport({ ...base, decision: "Ready" }, L);
    assert.doesNotMatch(r.nextSteps.join("\n"), L === "ko" ? /고친 뒤/ : /After fixing/);
    assert.ok(r.nextSteps.length >= 1);
  });

  test(`[${L}] 행동 보존 가드: 진짜 문제가 있으면 '가장 급한 것부터'와 '고친 뒤 다시'가 그대로 있다`, () => {
    const r = buildNonDevReport(
      { ...base, decision: "Needs Fix", loadStatus: 500, consoleErrors: ["TypeError: Cannot read properties of undefined"] },
      L,
    );
    const joined = r.nextSteps.join("\n");
    assert.match(joined, L === "ko" ? /가장 급한 것부터/ : /Most urgent first/);
    assert.match(joined, L === "ko" ? /고친 뒤/ : /After fixing/);
  });

  test(`[${L}] 진짜 문제 + 잡음이 함께 있으면 '가장 급한 것'은 잡음이 아니라 진짜 문제`, () => {
    const r = buildNonDevReport(
      { ...base, decision: "Needs Fix", loadStatus: 500, consoleErrors: ["TypeError: x is undefined"], noiseFailures: NOISE },
      L,
    );
    const top = r.nextSteps[0] ?? "";
    const noise = r.findings.find((f) => f.code === "noise_third_party");
    assert.ok(noise, "잡음 항목 존재");
    assert.ok(!top.includes(noise.how), `top="${top}"`);
  });
}
