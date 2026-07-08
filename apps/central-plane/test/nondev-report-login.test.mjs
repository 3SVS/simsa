import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P0 honesty: a login/signup wall must be reported as "확인 못 함 (로그인 필요)",
// never as a failure. Most real apps put login at the front (Bae's report: entering
// such a URL "바로 실패라고 나오더라").

const { buildNonDevReport, classifyFindings, isLoginBlocked } = await import("../dist/nondev-report.js");

function base(overrides = {}) {
  return {
    targetUrl: "https://myapp.example.com",
    intentAnchor: "사용자가 목록을 본다",
    loadStatus: 200,
    primaryActionFound: false,
    interacted: false,
    routeAfterClick: null,
    routeChanged: false,
    consoleErrors: [],
    networkFailures: [],
    decision: "Needs Fix",
    ...overrides,
  };
}

describe("login wall is 확인 못 함, not failure", () => {
  it("explicit loginWall flag → works=null, honest verdict, no false defect", () => {
    const rep = buildNonDevReport(base({ loginWall: true }));
    assert.equal(rep.works, null);
    assert.ok(/로그인/.test(rep.verdict), `verdict should mention login, got: ${rep.verdict}`);
    assert.equal(rep.findings[0].severity, "info"); // not high/medium defect
    assert.ok(rep.nextSteps.some((s) => /테스트.*계정|계정/.test(s)), "should ask for a test account");
    assert.ok(!rep.findings.some((f) => /무엇을 눌러|단계가 끝까지/.test(f.what)), "no false primary/step defects");
  });

  it("URL landing on /login is detected even without the flag", () => {
    assert.equal(isLoginBlocked(base({ routeAfterClick: "https://myapp.example.com/login" })), true);
    assert.equal(isLoginBlocked(base({ targetUrl: "https://myapp.example.com/users/sign_in" })), true);
    const rep = buildNonDevReport(base({ routeAfterClick: "https://myapp.example.com/login?next=/app" }));
    assert.equal(rep.works, null);
  });

  it("a real server error at the login screen still surfaces (below the wall)", () => {
    const findings = classifyFindings(base({ loginWall: true, networkFailures: ["HTTP 502 Bad Gateway"] }));
    assert.equal(findings[0].severity, "info"); // login note first
    assert.ok(findings.some((f) => f.severity === "high"), "the 5xx is still reported");
  });

  it("a non-login page is unaffected (normal classification)", () => {
    assert.equal(isLoginBlocked(base({ targetUrl: "https://myapp.example.com/dashboard" })), false);
    const rep = buildNonDevReport(base({ decision: "Ready", primaryActionFound: true }));
    assert.notEqual(rep.works, null);
  });
});
