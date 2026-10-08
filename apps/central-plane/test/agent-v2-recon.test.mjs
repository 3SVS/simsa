/**
 * 검사 엔진 v2 · S2 — 정찰: 열리지 않음·404·index 없음은 LLM 없이 곧바로 "고장(원인)" · 소스·번들 정적 사실.
 * 파일럿 v0(Vercel DEPLOYMENT_NOT_FOUND 404)·Gemini 1차(Netlify 404)는 v1 하네스에서 infer_intent:no_evidence로 검사 전에 멈췄다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const v2 = await import("../dist/agent-v2.js");
const { runAgentV2 } = await import("../inspector-container/agent-v2-run.mjs");

export function fakeV2Driver(pages, { sources = {} } = {}) {
  let url = "";
  return {
    calls: [],
    async start() {},
    async goto(u) {
      url = u;
      const p = pages[u] ?? { status: null, body: "" };
      return { status: p.status, url: u };
    },
    async bodyText() {
      return pages[url]?.body ?? "";
    },
    async html() {
      return pages[url]?.html ?? `<html><body>${pages[url]?.body ?? ""}</body></html>`;
    },
    async screenshot(name) {
      return { name: `screenshots/${name}`, path: `/tmp/${name}` };
    },
    async listSources() {
      return [url, ...Object.keys(sources)];
    },
    async readSourceText(u) {
      if (u === url) return { ok: true, status: 200, url: u, text: pages[url]?.html ?? "" };
      return sources[u] ? { ok: true, status: 200, url: u, text: sources[u] } : { ok: false };
    },
    async close() {},
  };
}

const noLlm = async () => {
  throw new Error("LLM must not be called for a broken landing");
};

describe("S2 접속 불가 즉시 판정(LLM 0회)", () => {
  it("v2LandingBroken — 404·없음 화면·index 없음·무응답은 고장, 로그인 벽은 아님", () => {
    assert.deepEqual(v2.v2LandingBroken({ status: 404, bodyText: "x", hostNotFound: false, missingIndexFile: false }), { broken: true, cause: "http_error" });
    assert.deepEqual(v2.v2LandingBroken({ status: 200, bodyText: "Site not found", hostNotFound: true, missingIndexFile: false }), { broken: true, cause: "host_not_found" });
    assert.deepEqual(v2.v2LandingBroken({ status: 404, bodyText: "", hostNotFound: false, missingIndexFile: true }), { broken: true, cause: "missing_index" });
    assert.deepEqual(v2.v2LandingBroken({ status: null, bodyText: "", hostNotFound: false, missingIndexFile: false }), { broken: true, cause: "unreachable" });
    assert.deepEqual(v2.v2LandingBroken({ status: 401, bodyText: "로그인", hostNotFound: false, missingIndexFile: false }), { broken: false });
    assert.deepEqual(v2.v2LandingBroken({ status: 200, bodyText: "예약하기", hostNotFound: false, missingIndexFile: false }), { broken: false });
  });

  for (const [name, url, status, body] of [
    ["파일럿 v0형(Vercel)", "https://verifiy-sigma.example.app/", 404, "The deployment could not be found on Vercel.\n\nDEPLOYMENT_NOT_FOUND"],
    ["파일럿 Gemini 1차형(Netlify)", "https://stellar.example.app/", 404, "Page not found\nLooks like you've followed a broken link or entered a URL that doesn't exist on this site."],
  ]) {
    it(`${name} → 고장(원인 · 고치는 법 · 증거물), LLM 호출 없음`, async () => {
      const r = await runAgentV2({ targetUrl: url, intent: "AI가 만든 앱 점검", locale: "ko", acs: [], driver: fakeV2Driver({ [url]: { status, body } }), llm: noLlm });
      assert.equal(r.decision, "Needs Fix");
      assert.equal(r.works, false);
      assert.match(r.report.oneLine, /앱이 열리지 않아요/);
      const f = r.report.findings[0];
      assert.equal(f.severity, "high");
      assert.ok(f.how.length > 10, "고치는 법이 반드시 있다(X-3)");
      assert.match(f.evidence, /HTTP 404/);
      assert.equal(r.report.engineVersion, "v2");
      assert.equal(r.report.agent.v2.landing.broken, true);
      assert.ok(!/HTTP|DNS|deploy(ment)?_|stack|console/i.test(`${r.report.oneLine} ${f.what} ${f.why}`), "비개발자 문장에 개발 용어 없음(X-2)");
    });
  }

  it("영어 리포트도 쉬운 말", async () => {
    const url = "https://gone.example.app/";
    const r = await runAgentV2({ targetUrl: url, intent: "x", locale: "en", acs: [], driver: fakeV2Driver({ [url]: { status: 404, body: "Not Found" } }), llm: noLlm });
    assert.match(r.report.oneLine, /doesn't open/);
  });
});

describe("S2 소스·번들 정적 사실(가설 재료)", () => {
  const bundle = [
    'const sb = createClient("https://YOUR_PROJECT.supabase.co", "YOUR_SUPABASE_ANON_KEY");',
    'function save(b){ localStorage.setItem("salon-bookings", JSON.stringify(b)) }',
    "const today = new Date().toISOString().slice(0, 10);",
    'fetch("/api/bookings", { method: "POST" })',
    'const score = Math.random() * 100;',
    'const routes = [{ path: "/admin", element: Admin }, { path: "/book" }];',
  ].join("\n");
  it("백엔드·저장 키·자리표시자·UTC 날짜·난수·라우트를 원문 조각과 함께 뽑는다", () => {
    const facts = v2.extractStaticFacts([{ url: "https://a.app/assets/index.js", text: bundle }]);
    const kinds = (k) => facts.filter((f) => f.kind === k).map((f) => f.value);
    assert.ok(kinds("local_storage_key").includes("salon-bookings"));
    assert.ok(kinds("placeholder_config").some((v) => /YOUR_/.test(v)));
    assert.equal(kinds("utc_date").length, 1);
    assert.ok(kinds("external_endpoint").includes("/api/bookings"));
    assert.equal(kinds("random_result").length, 1);
    assert.deepEqual(kinds("route").sort(), ["/admin", "/book"]);
    for (const f of facts) assert.ok(bundle.includes(f.snippet), "조각은 원문 그대로(원인 인용 근거)");
  });
  it("정찰이 소스를 읽어 source 증거물과 알려진 주소(라우트)를 남긴다", async () => {
    const url = "https://salon.example.app/";
    const js = "https://salon.example.app/assets/index.js";
    let seen = null;
    await runAgentV2({
      targetUrl: url,
      intent: "미용실 예약",
      acs: [],
      driver: fakeV2Driver({ [url]: { status: 200, body: "예약하기", html: `<script src="/assets/index.js"></script>` } }, { sources: { [js]: bundle } }),
      llm: noLlm,
      afterRecon: async (ctx) => {
        seen = ctx;
      },
    });
    assert.ok(seen.state.readSources.has(js));
    assert.ok(seen.state.knownUrls.has("https://salon.example.app/admin"));
    const src = seen.store.all().find((a) => a.kind === "source");
    assert.match(src.raw, /salon-bookings/);
  });
});
