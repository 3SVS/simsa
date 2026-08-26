import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ★2026-08-26 판정 ② (Bae 결정): 깨끗하게 완주한 검수의 판정이
// "User Acceptance Required"(직접 눈으로 확인이 필요해요) → **"Conditionally Ready"
// (문제를 찾지 못했어요)** 로 바뀌었다.
//
// 왜: 종전엔 `decideFromEvidence`의 **어떤 분기도 긍정 판정을 내지 못했다**
// (`"Ready"` 반환이 최초 버전부터 코드에 없었고 works=true의 유일한 조건이 그것).
// 근거를 다 모아놓고 아무 말도 안 하는 것은 정직이 아니라 회피에 가깝다.
// `works`는 여전히 null이다 — 확인한 범위를 넘어서는 주장은 하지 않는다.
// UAR은 **부분 완주**(스텝 일부 실패 + 상호작용함) 자리로 남는다.

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

  it("treats a failed Next.js RSC prefetch as noise (real-app eval R3: a working landing was called broken on a cross-origin _rsc CORS failure)", () => {
    assert.equal(isNoiseResource("https://trysimsa.com/demo?_rsc=1p-R_iEY6bj0jY31"), true);
    assert.equal(isNoiseResource("https://simsa.dev/demo?_rsc=abc&x=1"), true);
    // …but the same path WITHOUT the prefetch marker is a real request
    assert.equal(isNoiseResource("https://trysimsa.com/demo"), false);
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

  it("★깨끗한 완주는 문제를 찾지 못했어요 판정이다 (2026-08-26 ②)", () => {
    assert.equal(decideFromEvidence({ ...base, interacted: true }, [{ ok: true }]), "Conditionally Ready");
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
  it("console error alone (screen DID change) stays a clean pass", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: true, consoleErrorCount: 3 },
      [{ ok: true }],
    );
    assert.equal(d, "Conditionally Ready");
  });
  it("no visible change alone (no console error) is 'couldn't confirm', not broken", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: false, consoleErrorCount: 0 },
      [{ ok: true }, { ok: false }],
    );
    assert.notEqual(d, "Needs Fix");
  });
  it("older callers without the D9 fields keep their existing verdicts (fields optional)", () => {
    assert.equal(decideFromEvidence({ ...base, interacted: true }, [{ ok: true }]), "Conditionally Ready");
  });
});

describe("decideFromEvidence — G4-①: persistence is the FINAL Potemkin test", () => {
  // 낙관적 유령(F6): 화면엔 추가된 것처럼 보이는데(visible change) 새로고침하면
  // 사라진다 — 네트워크 실패도 콘솔 에러도 없어 기존 신호가 전부 침묵하는 변종.
  it("visible change + NOT persisted after reload → Needs Fix", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: true, persistedAfterReload: false },
      [{ ok: true }, { ok: true }, { ok: false }],
    );
    assert.equal(d, "Needs Fix");
  });
  it("persisted (localStorage app survives reload) → clean pass", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: true, persistedAfterReload: true },
      [{ ok: true }],
    );
    assert.equal(d, "Conditionally Ready");
  });
  it("not measured (null — search flow / route change / no marker) never drives the verdict", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: true, persistedAfterReload: null },
      [{ ok: true }],
    );
    assert.equal(d, "Conditionally Ready");
  });
  it("persisted=false WITHOUT a visible change is not this rung (nothing was 'added')", () => {
    const d = decideFromEvidence(
      { ...base, interacted: true, visibleChangeAfterAction: false, consoleErrorCount: 0, persistedAfterReload: false },
      [{ ok: true }],
    );
    assert.notEqual(d, "Needs Fix");
  });
});

describe("classifyFindings — noise is info, real failures are high, console is low", () => {
  const input = (over) => ({
    targetUrl: "https://myapp.vercel.app/", intentAnchor: "x", loadStatus: 200,
    primaryActionFound: true, interacted: true, routeAfterClick: null, routeChanged: false,
    consoleErrors: [], networkFailures: [], noiseFailures: [], decision: "Conditionally Ready", steps: [],
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

describe("★긍정 판정이 실제로 존재한다 (2026-08-26 ②)", () => {
  it("깨끗한 완주는 '문제를 찾지 못했어요'로 읽힌다 — 실패처럼 읽히면 안 된다", async () => {
    const { buildNonDevReport } = await import("../dist/nondev-report.js");
    const r = buildNonDevReport(
      {
        targetUrl: "https://x.dev",
        intentAnchor: "버튼을 누르면 목록에 나타난다",
        decision: "Conditionally Ready",
        consoleErrors: [],
        networkFailures: [],
        primaryActionFound: true,
        interacted: true,
      },
      "ko",
    );
    assert.equal(r.verdict, "문제를 찾지 못했어요");
    assert.match(r.oneLine, /문제를 찾지 못했어요/);
    assert.doesNotMatch(r.oneLine, /확정하기엔 확인이 더 필요/, "성공 경로가 실패 문구를 쓰면 안 된다");
  });

  it("★그래도 works는 null이다 — 확인한 범위를 넘어서는 주장을 하지 않는다", async () => {
    const { decisionToWorks } = await import("../dist/nondev-report.js");
    assert.equal(decisionToWorks("Conditionally Ready"), null);
  });

  it("로그인 뒤를 못 봤다는 한계를 문구가 계속 말한다", async () => {
    const { buildNonDevReport } = await import("../dist/nondev-report.js");
    for (const [locale, re] of [["ko", /로그인 뒤/], ["en", /behind a login/i]]) {
      const r = buildNonDevReport(
        { targetUrl: "https://x.dev", intentAnchor: "x", decision: "Conditionally Ready",
          consoleErrors: [], networkFailures: [], primaryActionFound: true, interacted: true },
        locale,
      );
      assert.match(r.oneLine, re, locale);
    }
  });

  it("부분 완주는 여전히 '직접 확인'이다 — 두 자리를 뭉뜽그리지 않는다", async () => {
    const { decideFromEvidence } = await import("../dist/nondev-report.js");
    assert.equal(
      decideFromEvidence(
        { consoleErrors: [], networkFailures: [], primaryActionFound: true, interacted: true },
        [{ ok: true }, { ok: false }],
      ),
      "User Acceptance Required",
    );
  });
});
