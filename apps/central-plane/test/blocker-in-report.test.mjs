/**
 * blocker-in-report.test.mjs — 막힘이 "고칠 것"으로 리포트에 오르는가 (2026-09-01).
 *
 * 순환 구조의 마지막 칸: 검수가 막히면 그 이유가 **사용자의 고칠 것**이 되고,
 * 고치면 다음 검수에서 더 깊이 본다.
 *
 * ★그런데 **정당한 선택은 절대 올라가면 안 된다.** 캡차가 있는 앱에 "캡차가 문제입니다"
 * 라고 하면 우리가 틀린 쪽이 되고, 그건 오탐보다 오래 남는 손상이다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildNonDevReport } = await import("../dist/nondev-report.js");
const { blockerToFinding } = await import("../dist/signup-plan.js");

const base = {
  targetUrl: "https://x.dev",
  intentAnchor: "로그인하면 목록이 보여야 한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: null,
  routeChanged: false,
  consoleErrors: [],
  networkFailures: [],
  decision: "Conditionally Ready",
};

describe("앱의 누락은 고칠 것으로 오른다", () => {
  it("★가입 화면이 없으면 리포트에 결함으로 뜨고 '다음에 무엇까지'를 말한다", () => {
    const r = buildNonDevReport({ ...base, blockerFindings: [blockerToFinding("no_signup_form", "ko")] }, "ko");
    const f = r.findings.find((x) => /회원가입 화면/.test(x.what));
    assert.ok(f, "고칠 것으로 올라와야 한다");
    assert.ok(f.why.length > 0 && f.how.length > 0);
    assert.ok(f.unlocks && /확인|판정/.test(f.unlocks), "순환의 고리가 붙는다");
  });

  it("확인 메일 미도착도 고칠 것이다", () => {
    const r = buildNonDevReport({ ...base, blockerFindings: [blockerToFinding("verification_timeout", "ko")] }, "ko");
    assert.ok(r.findings.some((x) => /확인 메일/.test(x.what)));
  });
});

describe("★정당한 선택과 우리 사정은 올라가지 않는다", () => {
  for (const b of ["captcha", "payment_required", "unsafe_action", "no_mail_domain"]) {
    it(`${b}는 결함 목록에 없다`, () => {
      const before = buildNonDevReport(base, "ko").findings.length;
      const after = buildNonDevReport({ ...base, blockerFindings: [blockerToFinding(b, "ko")] }, "ko").findings.length;
      assert.equal(after, before, `${b}를 결함으로 올리면 남의 앱을 잘못 비난하는 것`);
    });
  }
});

describe("무해함", () => {
  it("막힘이 없으면 리포트가 달라지지 않는다", () => {
    const a = buildNonDevReport(base, "ko");
    const b = buildNonDevReport({ ...base, blockerFindings: [] }, "ko");
    assert.equal(b.findings.length, a.findings.length);
  });

  it("EN에서도 같은 구분", () => {
    const gap = buildNonDevReport({ ...base, blockerFindings: [blockerToFinding("no_signup_form", "en")] }, "en");
    assert.ok(gap.findings.some((x) => /sign-up screen/i.test(x.what)));
    const choice = buildNonDevReport({ ...base, blockerFindings: [blockerToFinding("captcha", "en")] }, "en");
    assert.ok(!choice.findings.some((x) => /captcha/i.test(x.what ?? "")));
  });
});
