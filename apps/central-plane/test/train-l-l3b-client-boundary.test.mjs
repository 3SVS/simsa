/**
 * Train L — PR #562 검증 결함 3: infer-intent · document-intake 응답이 운영 관측 데이터(llmUsage)를 내보냈다.
 *
 * #311(2026-07-09)이 `toClientDraft`를 **유일한 경계**로 정했지만(idea-to-spec-draft만 그 경계를 탔다),
 * 같은 generateIdeaToSpecDraft 결과를 돌려주는 두 라우트는 날것을 그대로 직렬화했다. L-2가 LlmCallUsage에
 * vendor·modelRequested를 더하면서 누수가 **벤더 라우팅 사실**(요청 haiku → 실제 gpt-5.4)까지 넓어졌다.
 *
 * 고정하는 계약: 두 응답 본문 어디에도 llmUsage·토큰 수·벤더 라우팅이 없다(초안 본문은 그대로).
 * 리얼 데이터(Rule 6): 한글 프로젝트·README·문서.
 * 네트워크 0: fetch 교체·가짜 D1·가짜 R2.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");
const { __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");

const USER = "uk_빵집사장님";
const PROJECT = "wsp_빵집";
const DOC_KEY = `docs/${USER}/${PROJECT}/psrc_doc1/동네 빵집 기획서.md`;

const DRAFT_JSON = JSON.stringify({
  understood: { summary: "동네 빵집 픽업 예약", mainFlow: ["빵 고르기", "예약", "픽업"] },
  questions: [],
  productSpec: { productName: "동네 빵집 픽업 예약", oneLine: "빵을 미리 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
  items: [
    { id: "req_001", title: "빵 목록", description: "오늘 빵", criteria: ["목록이 보인다", "품절 표시"] },
    { id: "req_002", title: "예약", description: "예약하기", criteria: ["예약 확인", "취소"] },
    { id: "req_003", title: "알림", description: "픽업 알림", criteria: ["알림 수신", "시간 표시"] },
  ],
});

const isOpenAi = (url) => String(url).includes("/chat/completions");
const openAiReply = (content) =>
  new Response(
    JSON.stringify({ model: "gpt-5.4-2026-03-05", choices: [{ message: { content } }], usage: { prompt_tokens: 1_200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 0 } } }),
    { status: 200 },
  );

const LLM_ENV = {
  ENVIRONMENT: "test",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_ENABLED: "off",
  CF_AI_GATEWAY_ANTHROPIC_URL: "https://gw.example/anthropic",
  CF_AI_GATEWAY_OPENAI_URL: "https://gw.example/openai",
};

const projectRow = () => ({
  id: PROJECT, user_key: USER, title: "동네 빵집 픽업 예약", idea: "빵을 미리 예약하고 픽업", understood_json: "{}",
  product_spec_json: "{}", items_json: "[]", created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
});
const sourceRow = (o) => ({
  project_id: PROJECT, user_key: USER, label: null, content_type: null, size_bytes: null, created_at: "2026-09-28T00:00:00.000Z", ...o,
});

/** 관대한 가짜 D1 — 프로젝트·소스 조회, 레이트리밋 0, 나머지 쓰기는 성공. */
function makeDb(sources) {
  function handler(sql, args) {
    return {
      async run() { return { meta: { changes: 1 } }; },
      async first() {
        if (sql.includes("FROM workspace_projects WHERE id = ?")) return args[0] === PROJECT ? projectRow() : null;
        if (sql.includes("FROM project_sources") && sql.includes("WHERE id = ?")) return sources.find((s) => s.id === args[0]) ?? null;
        if (sql.includes("FROM workspace_rate_limit")) return { count: 0 };
        return null;
      },
      async all() {
        if (sql.includes("FROM project_sources") && sql.includes("WHERE project_id = ?")) return { results: sources.filter((s) => s.project_id === args[0]) };
        return { results: [] };
      },
    };
  }
  return { prepare(sql) { return { bind: (...a) => handler(sql, a), run: () => handler(sql, []).run(), first: () => handler(sql, []).first(), all: () => handler(sql, []).all() }; } };
}

function makeR2(entries) {
  const store = new Map(Object.entries(entries));
  return {
    async put(key, value) { store.set(key, value); },
    async get(key) {
      const hit = store.get(key);
      if (hit === undefined) return null;
      const bytes = new TextEncoder().encode(hit);
      return { body: bytes, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
    },
    async delete(key) { store.delete(key); },
  };
}

async function post(env, path, body) {
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {}, props: {} };
  const res = await createApp().fetch(
    new Request(`https://cp.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    env,
    ctx,
  );
  const text = await res.text();
  await Promise.all(pending);
  return { status: res.status, text, json: JSON.parse(text) };
}

async function quiet(fn) {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}
async function withFetch(f, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

/** 응답 본문에 운영 관측 데이터가 없다 — 키 이름·벤더 라우팅·토큰 수 어느 것도. */
function assertNoOperatorUsage(text) {
  assert.doesNotMatch(text, /"llmUsage"/, "llmUsage 키가 응답에 있다");
  assert.doesNotMatch(text, /modelRequested|inputTokens|cacheReadInputTokens|latencyMs/, "토큰·지연·요청 모델이 응답에 있다");
  assert.doesNotMatch(text, /gpt-5\.4|claude-haiku/, "벤더 라우팅(실제/요청 모델)이 응답에 있다");
}

describe("결함 3 — generate 결과를 돌려주는 두 라우트도 toClientDraft 경계를 탄다", () => {
  it("★infer-intent: inferred 초안은 그대로, llmUsage(벤더·요청 모델·토큰)는 없다", async () => {
    __resetAnthropicBreaker();
    const sources = [sourceRow({ id: "psrc_repo1", type: "github_repo", reference: "someone/동네-빵집" })];
    const env = { ...LLM_ENV, DB: makeDb(sources) };
    const README = "# 동네 빵집 픽업 예약\n\n오늘 구운 빵을 미리 예약하고, 퇴근길에 줄 서지 않고 픽업하는 서비스입니다.\n품절되면 바로 표시되고, 픽업 시간 알림을 보냅니다.";
    const stub = async (url) => {
      if (isOpenAi(url)) return openAiReply(DRAFT_JSON);
      if (String(url).includes("raw.githubusercontent.com") && String(url).endsWith("/README.md")) return new Response(README, { status: 200 });
      if (String(url).includes("anthropic")) return new Response("{}", { status: 403 });
      return new Response("", { status: 404 });
    };
    const r = await quiet(() => withFetch(stub, () => post(env, `/workspace/projects/${encodeURIComponent(PROJECT)}/infer-intent`, { userKey: USER, locale: "ko" })));
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.ok(r.json.inferred, `inferred가 있어야 한다: ${r.text.slice(0, 300)}`);
    assert.equal(r.json.inferred.productSpec.productName, "동네 빵집 픽업 예약", "초안 본문은 그대로");
    assert.equal(r.json.inferred.items.length, 3);
    assert.ok(!("llmUsage" in r.json.inferred), "inferred.llmUsage가 새면 안 된다");
    assertNoOperatorUsage(r.text);
  });

  it("★document-intake(spec-draft): draft 본문은 그대로, llmUsage는 없다", async () => {
    __resetAnthropicBreaker();
    const sources = [sourceRow({ id: "psrc_doc1", type: "document", reference: DOC_KEY, label: "동네 빵집 기획서", content_type: "text/markdown", size_bytes: 400 })];
    const DOC = [
      "# 동네 빵집 픽업 예약 기획서",
      "",
      "손님이 오늘 구운 빵을 미리 예약하고 정해진 시간에 픽업한다.",
      "품절 빵은 목록에서 바로 표시되고, 사장님은 예약 목록을 한눈에 본다.",
      "결제는 매장에서 한다(앱 결제는 이번 범위 밖).",
    ].join("\n");
    const env = { ...LLM_ENV, DB: makeDb(sources), EVIDENCE: makeR2({ [DOC_KEY]: DOC }) };
    const stub = async (url) => (isOpenAi(url) ? openAiReply(DRAFT_JSON) : new Response("{}", { status: 403 }));
    const r = await quiet(() => withFetch(stub, () => post(env, `/workspace/projects/${encodeURIComponent(PROJECT)}/sources/psrc_doc1/spec-draft`, { userKey: USER, locale: "ko" })));
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.json.ok, true);
    assert.equal(r.json.draft.source, "llm");
    assert.equal(r.json.draft.productSpec.productName, "동네 빵집 픽업 예약", "초안 본문은 그대로");
    assert.ok(!("llmUsage" in r.json.draft), "draft.llmUsage가 새면 안 된다");
    assertNoOperatorUsage(r.text);
  });
});
