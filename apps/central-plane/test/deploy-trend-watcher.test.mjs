import { describe, it } from "node:test";
import assert from "node:assert/strict";

// D14 (2026-07-17): deploy/service trend watcher — weekly release scan filtered
// to "does this change how a NON-DEVELOPER deploys/onboards", landing in a
// human review queue (never auto-applied). Design:
// docs/simsa-builder-pack-portability-2026-07-17.md §D14.

const { parseSuggestions, DEPLOY_TREND_SOURCES } = await import("../dist/deploy-trend-watcher.js");

describe("parseSuggestions — strict JSONL, relevance-gated, capped", () => {
  it("keeps well-formed high/medium lines, drops the rest", () => {
    const out = parseSuggestions(
      [
        `{"relevance":"high","title":"Netlify Drop folder deploy","summary_ko":"폴더를 끌어다 놓으면 배포됩니다","guidance_key":"deploy"}`,
        `{"relevance":"low","title":"nope","summary_ko":"x","guidance_key":"other"}`,
        `not json`,
        `{"relevance":"medium","title":"CF Pages direct upload","summary_ko":"대시보드에서 직접 업로드","guidance_key":"deploy"}`,
      ].join("\n"),
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].relevance, "high");
    assert.equal(out[1].guidance_key, "deploy");
  });

  it("caps at 3 and requires title + summary_ko", () => {
    const line = `{"relevance":"high","title":"t","summary_ko":"s","guidance_key":"deploy"}`;
    assert.equal(parseSuggestions([line, line, line, line, line].join("\n")).length, 3);
    assert.equal(parseSuggestions(`{"relevance":"high","title":"t"}`).length, 0);
  });
});

describe("watched sources", () => {
  it("covers the platforms Bae named (cloudflare/netlify) plus the pack's defaults", () => {
    const ids = DEPLOY_TREND_SOURCES.map((s) => s.id);
    for (const want of ["cloudflare", "netlify", "vercel", "supabase"]) {
      assert.ok(ids.includes(want), `missing source: ${want}`);
    }
  });
});
