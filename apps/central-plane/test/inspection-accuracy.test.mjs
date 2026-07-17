import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P0-B inspection accuracy (2026-07-16). Live: vercel.com (a working site) was
// called "작동 안 해요 — 고쳐야 해요" because a third-party analytics 403 + console
// noise + a CTA click timeout were all counted as defects. The fix: the verdict
// keys off REAL failures only (app domain + backend), never analytics noise or
// console errors; a click the inspector couldn't complete asks a human instead
// of false-failing. Potemkin (a real backend failing) must STILL fail.
// Design: docs/simsa-accuracy-p0-2026-07-17.md.

const { isNoiseResource, extractUrl, decideFromEvidence, classifyFindings } =
  await import("../dist/nondev-report.js");

describe("isNoiseResource — allowlist the noise, count everything else", () => {
  it("treats analytics/ads/fonts/telemetry as noise", () => {
    for (const u of [
      "https://va.vercel-scripts.com/v1/script.js",
      "https://www.google-analytics.com/g/collect",
      "https://www.googletagmanager.com/gtm.js",
      "https://fonts.googleapis.com/css2",
      "https://browser.sentry-cdn.com/x.js",
      "https://static.hotjar.com/c/hotjar.js",
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://cloudflareinsights.com/cdn-cgi/rum",
    ]) {
      assert.equal(isNoiseResource(u), true, `should be noise: ${u}`);
    }
  });

  it("does NOT treat the app's own domain or a real backend as noise", () => {
    for (const u of [
      "https://myapp.vercel.app/api/todos",       // app's own API
      "https://xyzcompany.supabase.co/rest/v1/x", // Supabase backend — the Potemkin case
      "https://myproject.firebaseio.com/data.json",
      "https://api.myapp.com/users",
      "https://myapp.com/",
      "https://some-unknown-backend.railway.app/q",
    ]) {
      assert.equal(isNoiseResource(u), false, `should NOT be noise (real backend): ${u}`);
    }
  });

  it("extractUrl pulls the url from a failure log line", () => {
    assert.equal(extractUrl("GET https://x.supabase.co/rest/v1/y (net::ERR_FAILED)"), "https://x.supabase.co/rest/v1/y");
    assert.equal(extractUrl("no url here"), null);
  });
});

const base = { loadStatus: 200, networkFailures: [], interacted: false, routeAfterClick: null, primaryActionFound: true };

describe("decideFromEvidence — the vercel.com false-negative is fixed", () => {
  it("a working site with only a CTA timeout (no backend failure) is NOT 'Needs Fix'", () => {
    // vercel.com shape: loaded fine, noise already filtered out of networkFailures,
    // one step failed because the inspector couldn't click a fancy CTA.
    const d = decideFromEvidence(
      { ...base, interacted: false, networkFailures: [] },
      [{ ok: false }],
    );
    assert.notEqual(d, "Needs Fix", "a click the inspector couldn't complete must not read as broken");
    assert.equal(d, "Needs Clarification"); // couldn't drive it → ask, don't fail
  });

  it("a clean interactive journey is User Acceptance Required, not a fail", () => {
    assert.equal(decideFromEvidence({ ...base, interacted: true }, [{ ok: true }]), "User Acceptance Required");
  });
});

describe("decideFromEvidence — Potemkin is STILL caught (no over-softening)", () => {
  it("a real backend request failing → Needs Fix", () => {
    const d = decideFromEvidence(
      { ...base, networkFailures: ["GET https://xyz.supabase.co/rest/v1/todos (net::ERR_FAILED)"] },
      [{ ok: true }],
    );
    assert.equal(d, "Needs Fix");
  });
  it("a 5xx on load → Needs Fix", () => {
    assert.equal(decideFromEvidence({ ...base, loadStatus: 500 }, []), "Needs Fix");
  });
  it("a broken route after clicking (/undefined) → Needs Fix", () => {
    assert.equal(decideFromEvidence({ ...base, interacted: true, routeAfterClick: "https://x/undefined" }, [{ ok: true }]), "Needs Fix");
  });
  it("4xx on load is ambiguous (auth/not-found) → Not Verified, not a hard fail", () => {
    assert.equal(decideFromEvidence({ ...base, loadStatus: 403 }, []), "Not Verified");
  });
});

describe("decideFromEvidence — D9: dead-button crash is the CONJUNCTION, never either signal alone", () => {
  // 2026-07-17 accuracy eval F4: a load-time JS crash leaves the button dead —
  // clickable, zero network failures, but nothing ever changes. Console error
  // ALONE stays non-fatal (vercel lesson); no-change ALONE stays non-fatal
  // (subtle UIs); together they are a crashed app.
  it("action + NO visible change + console error → Needs Fix", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: false, consoleErrorCount: 1 },
      [{ ok: true }, { ok: false }],
    );
    assert.equal(d, "Needs Fix");
  });
  it("console error alone (screen DID change) stays a clean acceptance ask", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: true, consoleErrorCount: 3 },
      [{ ok: true }],
    );
    assert.equal(d, "User Acceptance Required");
  });
  it("no visible change alone (no console error) is 'couldn't confirm', not broken", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: false, consoleErrorCount: 0 },
      [{ ok: true }, { ok: false }],
    );
    assert.notEqual(d, "Needs Fix");
  });
  it("older callers without the D9 fields keep their existing verdicts (fields optional)", () => {
    assert.equal(decideFromEvidence({ ...base, interacted: true }, [{ ok: true }]), "User Acceptance Required");
  });
});

describe("classifyFindings — noise is info, real failures are high, console is low", () => {
  const input = (over) => ({
    targetUrl: "https://myapp.vercel.app/", intentAnchor: "x", loadStatus: 200,
    primaryActionFound: true, interacted: true, routeAfterClick: null, routeChanged: false,
    consoleErrors: [], networkFailures: [], noiseFailures: [], decision: "User Acceptance Required", steps: [],
    ...over,
  });

  it("a noise failure produces an INFO finding, not high", () => {
    const f = classifyFindings(input({ noiseFailures: ["GET https://va.vercel-scripts.com/x 403"] }), "ko");
    const noise = f.find((x) => x.severity === "info");
    assert.ok(noise, "should surface an info note for blocked noise");
    assert.ok(/외부 스크립트/.test(noise.what));
    assert.ok(!f.some((x) => x.severity === "high"), "noise must not create a high finding");
  });

  it("a real backend failure produces a HIGH finding", () => {
    const f = classifyFindings(input({ networkFailures: ["GET https://xyz.supabase.co/rest/v1/y (ERR_FAILED)"] }), "ko");
    assert.ok(f.some((x) => x.severity === "high"), "a real data failure is high");
  });

  it("console errors are downgraded to LOW (no longer alarming medium)", () => {
    const f = classifyFindings(input({ consoleErrors: ["TypeError: x is undefined"] }), "ko");
    const con = f.find((x) => /코드 오류/.test(x.what));
    assert.ok(con, "console finding still listed");
    assert.equal(con.severity, "low", "console errors must be low, not medium");
  });
});
