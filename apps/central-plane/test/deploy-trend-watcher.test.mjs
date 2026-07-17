import { describe, it } from "node:test";
import assert from "node:assert/strict";

// D14 (2026-07-17): deploy/service trend watcher — weekly release scan filtered
// to "does this change how a NON-DEVELOPER deploys/onboards", landing in a
// human review queue (never auto-applied). Design:
// docs/simsa-builder-pack-portability-2026-07-17.md §D14.

const { parseSuggestions, DEPLOY_TREND_SOURCES, runDeployTrendWatcher } = await import(
  "../dist/deploy-trend-watcher.js"
);

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

// ─── run loop: an LLM failure must not silently consume releases ─────────────
// (2026-07-17 live-run finding: "suggestions_saved: 0" was indistinguishable
// from a total LLM outage, and the high-water mark advanced either way — a
// failed release would never be re-evaluated.)

function fakeDb(log) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => null,
            run: async () => {
              log.push({ sql, args });
              return {};
            },
          };
        },
      };
    },
  };
}

const RELEASE = {
  tag_name: "v1.0.0",
  html_url: "https://github.com/vercel/vercel/releases/v1.0.0",
  body: "New one-click deploy from the dashboard.",
  published_at: "2026-07-16T00:00:00Z",
  draft: false,
  prerelease: false,
};

function mockFetch({ anthropicStatus, anthropicText }) {
  return async (url) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/repos/vercel/vercel/")) {
      return new Response(JSON.stringify([RELEASE]), { status: 200 });
    }
    if (u.startsWith("https://api.github.com/")) {
      return new Response("[]", { status: 200 });
    }
    if (u.startsWith("https://api.anthropic.com/")) {
      if (anthropicStatus !== 200) return new Response("err", { status: anthropicStatus });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: anthropicText }] }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

describe("runDeployTrendWatcher — LLM failure honesty", () => {
  it("counts llm_failures and does NOT advance the high-water mark on API failure", async (t) => {
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; });
    globalThis.fetch = mockFetch({ anthropicStatus: 500 });

    const log = [];
    const summary = await runDeployTrendWatcher({ ANTHROPIC_API_KEY: "k", DB: fakeDb(log) });

    assert.equal(summary.llm_failures, 1, "failure must be visible in the summary");
    assert.equal(summary.releases_processed, 0, "an unevaluated release is not 'processed'");
    const markWrites = log.filter((e) => e.sql.includes("spec_monitor_state"));
    assert.equal(markWrites.length, 0, "mark must not advance — release retries next cycle");
  });

  it("on success: saves parsed suggestions and advances the mark", async (t) => {
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; });
    globalThis.fetch = mockFetch({
      anthropicStatus: 200,
      anthropicText: `{"relevance":"high","title":"One-click deploy","summary_ko":"대시보드에서 한 번에 배포됩니다","guidance_key":"deploy"}`,
    });

    const log = [];
    const summary = await runDeployTrendWatcher({ ANTHROPIC_API_KEY: "k", DB: fakeDb(log) });

    assert.equal(summary.llm_failures, 0);
    assert.equal(summary.releases_processed, 1);
    assert.equal(summary.suggestions_saved, 1);
    assert.ok(log.some((e) => e.sql.includes("deploy_trend_suggestions")));
    assert.ok(log.some((e) => e.sql.includes("spec_monitor_state")));
  });

  it("an empty LLM answer means 'irrelevant', not failure — mark still advances", async (t) => {
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; });
    globalThis.fetch = mockFetch({ anthropicStatus: 200, anthropicText: "" });

    const log = [];
    const summary = await runDeployTrendWatcher({ ANTHROPIC_API_KEY: "k", DB: fakeDb(log) });

    assert.equal(summary.llm_failures, 0);
    assert.equal(summary.releases_processed, 1);
    assert.equal(summary.suggestions_saved, 0);
    assert.ok(log.some((e) => e.sql.includes("spec_monitor_state")));
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
