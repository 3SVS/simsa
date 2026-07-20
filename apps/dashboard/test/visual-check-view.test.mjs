import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  verdictLabel,
  severityLabel,
  severityTone,
  splitEvidenceKeys,
  buildEvidenceUrl,
  overviewNextAction,
  inspectionEmptyStateDoor,
  relativeTimeLabel,
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

// Stage 272 — project-overview next action.
function check(id, { status = "done", works = null, createdAt = "2026-07-01T00:00:00Z" } = {}) {
  return { id, targetUrl: "https://app.example.com", decision: "", works, status, executor: "container", evidenceCount: 0, createdAt };
}

describe("visual-check-view: overviewNextAction", () => {
  it("empty or non-array input → runFirst", () => {
    assert.deepEqual(overviewNextAction([]), { kind: "runFirst" });
    assert.deepEqual(overviewNextAction(null), { kind: "runFirst" });
    assert.deepEqual(overviewNextAction("nope"), { kind: "runFirst" });
    // Rows without a string id are dropped defensively.
    assert.deepEqual(overviewNextAction([{ status: "done" }]), { kind: "runFirst" });
  });

  it("an active (queued/running) run wins → inProgress with that run's id", () => {
    const action = overviewNextAction([
      check("done_new", { works: true, createdAt: "2026-07-02T10:00:00Z" }),
      check("run_active", { status: "running", createdAt: "2026-07-02T09:00:00Z" }),
    ]);
    assert.deepEqual(action, { kind: "inProgress", runId: "run_active" });
    const queued = overviewNextAction([check("q1", { status: "queued" })]);
    assert.deepEqual(queued, { kind: "inProgress", runId: "q1" });
  });

  it("latest done run that works → viewLatest", () => {
    const action = overviewNextAction([
      check("older_broken", { works: false, createdAt: "2026-07-01T00:00:00Z" }),
      check("latest_ok", { works: true, createdAt: "2026-07-02T00:00:00Z" }),
    ]);
    assert.deepEqual(action, { kind: "viewLatest", runId: "latest_ok" });
  });

  it("latest done run that does not work (works=false) → viewReport", () => {
    const action = overviewNextAction([
      check("older_ok", { works: true, createdAt: "2026-07-01T00:00:00Z" }),
      check("latest_broken", { works: false, createdAt: "2026-07-02T00:00:00Z" }),
    ]);
    assert.deepEqual(action, { kind: "viewReport", runId: "latest_broken" });
  });

  it("latest done run that could not verify (works=null) → viewReport", () => {
    const action = overviewNextAction([check("unclear", { works: null })]);
    assert.deepEqual(action, { kind: "viewReport", runId: "unclear" });
  });

  it("latest failed run → viewReport, ordered by createdAt regardless of list order", () => {
    // The failed run is newest but listed first/last in different orders —
    // sorting by createdAt must pick it either way.
    const rows = [
      check("failed_new", { status: "failed", createdAt: "2026-07-03T00:00:00Z" }),
      check("ok_old", { works: true, createdAt: "2026-07-01T00:00:00Z" }),
    ];
    assert.deepEqual(overviewNextAction(rows), { kind: "viewReport", runId: "failed_new" });
    assert.deepEqual(overviewNextAction([...rows].reverse()), {
      kind: "viewReport",
      runId: "failed_new",
    });
  });

  it("ordering by createdAt also drives the working case (unsorted input)", () => {
    const action = overviewNextAction([
      check("broken_old", { works: false, createdAt: "2026-06-30T00:00:00Z" }),
      check("ok_new", { works: true, createdAt: "2026-07-02T00:00:00Z" }),
      check("broken_older", { works: false, createdAt: "2026-06-29T00:00:00Z" }),
    ]);
    assert.deepEqual(action, { kind: "viewLatest", runId: "ok_new" });
  });
});

describe("visual-check-view: relativeTimeLabel", () => {
  const now = Date.parse("2026-07-02T12:00:00Z");

  it("formats minutes/hours/days in the requested locale", () => {
    assert.equal(relativeTimeLabel("2026-07-02T11:57:00Z", "en", now), "3 minutes ago");
    assert.equal(relativeTimeLabel("2026-07-02T09:00:00Z", "ko", now), "3시간 전");
    assert.equal(relativeTimeLabel("2026-06-30T12:00:00Z", "ko", now), "그저께");
  });

  it("returns an empty string for unparseable dates", () => {
    assert.equal(relativeTimeLabel("not-a-date", "en", now), "");
    assert.equal(relativeTimeLabel(null, "ko", now), "");
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

// Journey-audit P2 (2026-07-20): the overview inspection card's empty state
// must fit the branch — a code-entry project with nothing connected gets the
// "connect" door, everything else (and every unknown) keeps the default.
describe("inspectionEmptyStateDoor", () => {
  it("code branch + repo confirmed absent + no deploy URL → connect", () => {
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "code", hasRepo: false, hasDeployUrl: false }),
      "connect",
    );
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "code", hasRepo: false, hasDeployUrl: null }),
      "connect",
    );
  });

  it("repo connected or deploy URL present → run (never a wrong connect nudge)", () => {
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "code", hasRepo: true, hasDeployUrl: false }),
      "run",
    );
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "code", hasRepo: false, hasDeployUrl: true }),
      "run",
    );
  });

  it("unknown repo fact (null) stays fail-open → run", () => {
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "code", hasRepo: null, hasDeployUrl: null }),
      "run",
    );
  });

  it("non-code branches always keep the default door", () => {
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "idea", hasRepo: false, hasDeployUrl: false }),
      "run",
    );
    assert.equal(
      inspectionEmptyStateDoor({ entryPath: "spec", hasRepo: false, hasDeployUrl: false }),
      "run",
    );
    assert.equal(inspectionEmptyStateDoor({}), "run");
    assert.equal(inspectionEmptyStateDoor(null), "run");
  });
});
