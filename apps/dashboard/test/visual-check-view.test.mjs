import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verdictLabel,
  severityLabel,
  severityTone,
  splitEvidenceKeys,
  buildEvidenceUrl,
} from "../src/lib/visual-check-view.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const en = getDictionary("en");
const ko = getDictionary("ko");

describe("visual-check-view: verdictLabel", () => {
  it("works=true maps to the passed tone in both locales", () => {
    assert.deepEqual(verdictLabel(true, "release_ok", en), {
      label: en.visualChecks.worksYes,
      tone: "passed",
    });
    assert.equal(verdictLabel(true, "", ko).label, "작동해요");
    assert.equal(verdictLabel(true, "", ko).tone, "passed");
  });

  it("works=false maps to the failed tone", () => {
    assert.deepEqual(verdictLabel(false, "fix_first", en), {
      label: en.visualChecks.worksNo,
      tone: "failed",
    });
    assert.equal(verdictLabel(false, "", ko).label, "작동 안 해요");
  });

  it("works=null / undefined maps to the inconclusive tone regardless of decision", () => {
    assert.deepEqual(verdictLabel(null, "whatever", en), {
      label: en.visualChecks.worksUnknown,
      tone: "inconclusive",
    });
    assert.equal(verdictLabel(undefined, null, en).tone, "inconclusive");
    assert.equal(verdictLabel(null, "", ko).label, "확인 필요");
  });
});

describe("visual-check-view: severity helpers", () => {
  it("severityLabel maps all known severities and falls through raw", () => {
    assert.equal(severityLabel("high", en), en.visualChecks.severityHigh);
    assert.equal(severityLabel("medium", en), en.visualChecks.severityMedium);
    assert.equal(severityLabel("low", en), en.visualChecks.severityLow);
    assert.equal(severityLabel("info", en), en.visualChecks.severityInfo);
    assert.equal(severityLabel("weird", en), "weird");
    assert.equal(severityLabel("high", ko), "심각");
  });

  it("severityTone maps high→failed, medium→inconclusive, rest→decision", () => {
    assert.equal(severityTone("high"), "failed");
    assert.equal(severityTone("medium"), "inconclusive");
    assert.equal(severityTone("low"), "decision");
    assert.equal(severityTone("info"), "decision");
    assert.equal(severityTone("unknown"), "decision");
  });
});

describe("visual-check-view: splitEvidenceKeys", () => {
  it("splits screenshots (sorted) from the flow video", () => {
    const { screenshots, video } = splitEvidenceKeys([
      "video/flow.webm",
      "screenshots/step-01-search.png",
      "screenshots/step-00-initial.png",
    ]);
    assert.deepEqual(screenshots, [
      "screenshots/step-00-initial.png",
      "screenshots/step-01-search.png",
    ]);
    assert.equal(video, "video/flow.webm");
  });

  it("is defensive: non-arrays, non-strings and unknown prefixes are dropped", () => {
    assert.deepEqual(splitEvidenceKeys(null), { screenshots: [], video: null });
    assert.deepEqual(splitEvidenceKeys("nope"), { screenshots: [], video: null });
    const { screenshots, video } = splitEvidenceKeys([
      42,
      null,
      "logs/console.txt",
      "screenshots/a.png",
    ]);
    assert.deepEqual(screenshots, ["screenshots/a.png"]);
    assert.equal(video, null);
  });
});

describe("visual-check-view: buildEvidenceUrl", () => {
  it("builds the central-plane evidence URL with the userKey in the query", () => {
    const url = buildEvidenceUrl(
      "https://api.example.com",
      "proj_1",
      "run_2",
      "screenshots/step-00-initial.png",
      "uk_abc123",
    );
    assert.equal(
      url,
      "https://api.example.com/workspace/projects/proj_1/visual-checks/run_2/evidence/screenshots/step-00-initial.png?userKey=uk_abc123",
    );
  });

  it("URI-encodes the userKey and path segments (slash in evidence name survives)", () => {
    const url = buildEvidenceUrl(
      "https://api.example.com/",
      "proj/one",
      "run 2",
      "video/flow.webm",
      "uk a+b&c",
    );
    assert.ok(url.includes("/workspace/projects/proj%2Fone/"));
    assert.ok(url.includes("/visual-checks/run%202/"));
    assert.ok(url.includes("/evidence/video/flow.webm?"));
    assert.ok(url.endsWith("userKey=uk%20a%2Bb%26c"));
    assert.ok(!url.includes("uk a+b&c"));
  });

  it("trims trailing slashes on the base so the path never doubles up", () => {
    const url = buildEvidenceUrl("https://api.example.com///", "p", "r", "screenshots/a.png", "u");
    assert.ok(url.startsWith("https://api.example.com/workspace/projects/p/"));
    assert.ok(!url.includes("com//workspace"));
  });
});
