import { describe, it } from "node:test";
import assert from "node:assert/strict";

// PRD §2 / audit B6: the non-dev report must be EN/KO. English users previously
// had no explanation layer (html lang="ko" + hardcoded Korean). This pins that
// locale="en" produces an English report and locale="ko" stays Korean, with the
// html lang attribute following the locale — and that "ko" is the default
// (backward-compat for existing callers).

const { buildNonDevReport, buildAgentFixPrompt, renderNonDevReportHtml, decisionLabel, decisionToKorean } =
  await import("../dist/nondev-report.js");

const BROKEN_INPUT = {
  targetUrl: "https://example.test",
  intentAnchor: "check a course is playable now",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: "/search",
  routeChanged: true,
  consoleErrors: [],
  networkFailures: ["GET https://api.example/x ERR_NAME_NOT_RESOLVED"],
  decision: "Needs Fix",
  steps: [{ label: "search", ok: false, note: "no results" }],
};

describe("decisionLabel EN/KO", () => {
  it("localizes the verdict", () => {
    assert.equal(decisionLabel("Needs Fix", "ko"), "작동 안 해요 — 고쳐야 해요");
    assert.equal(decisionLabel("Needs Fix", "en"), "It doesn't work — needs a fix");
    assert.equal(decisionLabel("User Acceptance Required", "en"), "You need to confirm it with your own eyes");
  });
  it("defaults to ko and keeps the legacy helper", () => {
    assert.equal(decisionLabel("Ready"), "정상 작동해요");
    assert.equal(decisionToKorean("Ready"), "정상 작동해요");
  });
});

describe("buildNonDevReport EN/KO", () => {
  it("en report has English verdict/oneLine/notes and no Korean", () => {
    const en = buildNonDevReport(BROKEN_INPUT, "en");
    assert.equal(en.verdict, "It doesn't work — needs a fix");
    assert.ok(/doesn't work/.test(en.oneLine));
    const blob = JSON.stringify(en);
    assert.ok(!/[가-힣]/.test(blob), "en report must contain no Korean characters");
  });
  it("ko report stays Korean; ko is the default", () => {
    const ko = buildNonDevReport(BROKEN_INPUT, "ko");
    const def = buildNonDevReport(BROKEN_INPUT);
    assert.deepEqual(def, ko, "default locale is ko");
    assert.ok(/[가-힣]/.test(ko.verdict), "ko report is Korean");
  });
  it("findings localize (DNS finding)", () => {
    const en = buildNonDevReport(BROKEN_INPUT, "en");
    assert.ok(en.findings.length >= 1);
    assert.ok(/server address/i.test(en.findings[0].what), "DNS finding in English");
    // raw technical string stays in evidence, both locales
    assert.ok(/ERR_NAME_NOT_RESOLVED/.test(en.findings[0].evidence ?? ""));
  });
});

describe("renderNonDevReportHtml EN/KO", () => {
  it("en html sets lang=en and English chrome; ko sets lang=ko", () => {
    const en = renderNonDevReportHtml(buildNonDevReport(BROKEN_INPUT, "en"), [], null, null, "en");
    assert.ok(en.startsWith("<!doctype html>"));
    assert.ok(/<html lang="en">/.test(en), "lang=en");
    assert.ok(/What we found/.test(en), "English section header");
    assert.ok(!/무엇을 발견/.test(en), "no Korean chrome in en");

    const ko = renderNonDevReportHtml(buildNonDevReport(BROKEN_INPUT, "ko"), [], null, null, "ko");
    assert.ok(/<html lang="ko">/.test(ko), "lang=ko");
    assert.ok(/무엇을 발견했나요/.test(ko));
  });
  it("agent fix prompt localizes but keeps raw evidence", () => {
    const en = buildAgentFixPrompt(BROKEN_INPUT, "en");
    assert.ok(/development agent/i.test(en));
    assert.ok(/ERR_NAME_NOT_RESOLVED/.test(en), "raw evidence preserved for the dev agent");
    assert.ok(!/[가-힣]/.test(en.replace(/https?:\/\/\S+/g, "")), "no Korean in en agent prompt (ignoring urls)");
  });
});
