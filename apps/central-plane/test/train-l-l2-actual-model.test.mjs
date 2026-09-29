/**
 * Train L — L-2 실응답 모델 (central-plane Worker 쪽).
 *
 * BM §1 결함 ③ [확정]: generate.ts·generate-dev-spec.ts의 usage.model이 **요청 모델**이었고, 폴백 합성 응답에는
 * model 필드조차 없었다. 프로덕션은 ANTHROPIC_ENABLED=off라 실제 응답은 전부 gpt-5.4인데 Langfuse·로그 라벨은
 * claude-haiku/claude-opus였다 → 원가표가 틀린 모델로 집계됐다.
 *
 * 고정하는 계약:
 *   ① anthropicMessages 반환에 vendor·modelActual(폴백이면 OpenAI 응답의 model)
 *   ② 폴백 usage: prompt_tokens_details.cached_tokens → cache_read_input_tokens, input = prompt − cached
 *   ③ onUsage 싱크가 성공한 호출마다 한 번(벤더·요청/실제 모델·토큰·지연) — 던져도 호출은 산다
 *   ④ generate·dev-spec 호출자의 usage.model = 실응답 모델, modelRequested·vendor 동행
 *   ⑤ verify-panel·council의 2차 호출도 onUsage로 실응답 모델을 흘린다
 * 네트워크 0: fetch 주입/교체.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { anthropicMessages, __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");
const { generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");
const { makeDevSpecLlmCaller } = await import("../dist/workspace/generate-dev-spec.js");
const { generateCheckDraft } = await import("../dist/workspace/check.js");
const { applyVerifyPanel } = await import("../dist/workspace/verify-panel.js");
const { runCouncilCheck } = await import("../dist/workspace/council-review.js");

beforeEach(() => __resetAnthropicBreaker());

const BODY = { model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: "안녕" }] };
const FB_OFF = { openaiApiKey: "test-openai-key", openaiBaseUrl: "https://gw.example/openai", preferFallback: true };
const isOpenAi = (url) => String(url).includes("/chat/completions");

const openAiOk = (content = "from-openai", extra = {}) =>
  new Response(
    JSON.stringify({
      model: "gpt-5.4-2026-03-05",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1_000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } },
      ...extra,
    }),
    { status: 200 },
  );
const anthropicOk = (model = "claude-haiku-4-5-20251001") =>
  new Response(JSON.stringify({ model, content: [{ type: "text", text: "from-anthropic" }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 } }), { status: 200 });

async function quiet(fn) {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
}
async function withFetch(f, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

describe("① ② ③ anthropicMessages — 실응답 모델·벤더·캐시 토큰·onUsage", () => {
  it("★폴백(킬스위치 off): vendor=openai, modelActual=응답 model, cached → cache_read, input=prompt−cached", async () => {
    const seen = [];
    const data = await quiet(() =>
      anthropicMessages("k", BODY, 1000, async (url) => (isOpenAi(url) ? openAiOk() : anthropicOk()), "https://gw.example/anthropic/v1/messages", "generate", {
        fallback: FB_OFF,
        onUsage: (u) => seen.push(u),
      }),
    );
    assert.equal(data.vendor, "openai");
    assert.equal(data.modelActual, "gpt-5.4-2026-03-05");
    assert.equal(data.usage.input_tokens, 200);
    assert.equal(data.usage.cache_read_input_tokens, 800);
    assert.equal(data.usage.output_tokens, 50);
    assert.equal(seen.length, 1);
    assert.deepEqual(
      { ...seen[0], latencyMs: typeof seen[0].latencyMs },
      {
        vendor: "openai",
        modelRequested: "claude-haiku-4-5-20251001",
        modelActual: "gpt-5.4-2026-03-05",
        inputTokens: 200,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
        outputTokens: 50,
        latencyMs: "number",
        callSite: "generate",
      },
    );
  });

  it("Anthropic 성공: vendor=anthropic, modelActual=응답 model(없으면 요청 model), onUsage 1회", async () => {
    const seen = [];
    const data = await quiet(() =>
      anthropicMessages("k", BODY, 1000, async () => anthropicOk("claude-haiku-4-5-20251001"), "https://api.anthropic.com/v1/messages", "check", { onUsage: (u) => seen.push(u) }),
    );
    assert.equal(data.vendor, "anthropic");
    assert.equal(data.modelActual, "claude-haiku-4-5-20251001");
    assert.equal(seen[0].vendor, "anthropic");
    assert.equal(seen[0].cacheReadTokens, 5);
    const noModel = await quiet(() =>
      anthropicMessages("k", BODY, 1000, async () => new Response(JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }), "https://api.anthropic.com/v1/messages", "check"),
    );
    assert.equal(noModel.modelActual, BODY.model);
  });

  it("폴백 로그 anthropic_usage: model=실응답, model_requested=요청 모델", async () => {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => lines.push(String(a[0]));
    try {
      await anthropicMessages("k", BODY, 1000, async (url) => (isOpenAi(url) ? openAiOk() : anthropicOk()), "https://gw.example/anthropic/v1/messages", "generate", { fallback: FB_OFF });
    } finally {
      console.log = orig;
    }
    const usage = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j?.event === "anthropic_usage");
    assert.equal(usage.model, "gpt-5.4-2026-03-05");
    assert.equal(usage.model_requested, "claude-haiku-4-5-20251001");
    assert.equal(usage.cache_read_input_tokens, 800);
  });

  it("onUsage가 던져도 호출은 성공한다(계측이 사용자 요청을 깨지 않는다)", async () => {
    const data = await quiet(() =>
      anthropicMessages("k", BODY, 1000, async (url) => (isOpenAi(url) ? openAiOk() : anthropicOk()), "https://gw.example/anthropic/v1/messages", "generate", {
        fallback: FB_OFF,
        onUsage: () => { throw new Error("sink down"); },
      }),
    );
    assert.equal(data.content[0].text, "from-openai");
  });
});

const DRAFT_JSON = JSON.stringify({
  understood: { summary: "빵집 예약", mainFlow: ["빵 고르기", "예약"] },
  questions: [],
  productSpec: { productName: "동네 빵집 예약", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
  items: [
    { id: "req_001", title: "빵 목록", description: "오늘 빵", criteria: ["목록이 보인다", "품절 표시"] },
    { id: "req_002", title: "예약", description: "예약하기", criteria: ["예약 확인", "취소"] },
    { id: "req_003", title: "알림", description: "픽업 알림", criteria: ["알림 수신", "시간 표시"] },
  ],
});

describe("④ generate·dev-spec 호출자: usage.model = 실응답 모델", () => {
  it("★generateIdeaToSpecDraft(킬스위치 off): llmUsage.model = gpt-5.4…, modelRequested = haiku, vendor = openai + onUsage", async () => {
    const seen = [];
    const result = await quiet(() =>
      withFetch(async (url) => (isOpenAi(url) ? openAiOk(DRAFT_JSON) : anthropicOk()), () =>
        generateIdeaToSpecDraft({ idea: "동네 빵집 픽업 예약 앱", locale: "ko" }, "k", "https://gw.example/anthropic", FB_OFF, (u) => seen.push(u)),
      ),
    );
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
    assert.equal(result.llmUsage.model, "gpt-5.4-2026-03-05");
    assert.equal(result.llmUsage.modelRequested, "claude-haiku-4-5-20251001");
    assert.equal(result.llmUsage.vendor, "openai");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].callSite, "generate");
  });

  it("generate 응답이 파싱 불가여도 onUsage는 이미 불렸다(비용은 났다)", async () => {
    const seen = [];
    const result = await quiet(() =>
      withFetch(async (url) => (isOpenAi(url) ? openAiOk("JSON 아님") : anthropicOk()), () =>
        generateIdeaToSpecDraft({ idea: "동네 빵집", locale: "ko" }, "k", undefined, FB_OFF, (u) => seen.push(u)),
      ),
    );
    assert.equal(result.ok, false);
    assert.equal(seen.length, 1);
  });

  it("★makeDevSpecLlmCaller: usage.model = 실응답, modelRequested = claude-opus-5, onUsage에 dev-spec", async () => {
    const seen = [];
    const call = makeDevSpecLlmCaller("k", "https://gw.example/anthropic", FB_OFF, undefined, (u) => seen.push(u));
    const r = await quiet(() => withFetch(async (url) => (isOpenAi(url) ? openAiOk('{"a":1}') : anthropicOk()), () => call("프롬프트", 1000)));
    assert.equal(r.usage.model, "gpt-5.4-2026-03-05");
    assert.equal(r.usage.modelRequested, "claude-opus-5");
    assert.equal(r.usage.vendor, "openai");
    assert.equal(r.usage.cacheReadInputTokens, 800);
    assert.equal(seen[0].callSite, "dev-spec");
  });

  it("★회귀 전수 검색: pr-review의 cost_meta.model_used도 요청 모델이 아니라 실응답 모델", async () => {
    const { reviewPRAgainstItems } = await import("../dist/workspace/pr-review.js");
    const reviewJson = JSON.stringify({ results: [{ itemId: "req_001", status: "passed", userLabel: "통과", reason: "구현됨", evidence: ["src/a.ts"], nextAction: "다음" }] });
    const res = await quiet(() =>
      reviewPRAgainstItems(
        {
          productSpec: { productName: "동네 빵집", oneLine: "빵 예약", targetUsers: ["손님"], problem: "헛걸음", included: ["예약"], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
          items: [{ id: "req_001", title: "빵 목록", criteria: ["목록이 보인다", "품절 표시"] }],
          prMeta: { number: 7, title: "feat: 빵 목록", body: "", state: "open", headBranch: "feat/bread", baseBranch: "main", headSha: "abc123", additions: 10, deletions: 0, changedFiles: 1 },
          prFiles: [{ filename: "src/빵목록.ts", status: "added", additions: 10, deletions: 0, changes: 10, patch: "+export const 빵 = [];" }],
          locale: "ko",
        },
        "k",
        async (url) => (isOpenAi(url) ? openAiOk(reviewJson) : anthropicOk()),
        "https://gw.example/anthropic",
        FB_OFF,
      ),
    );
    assert.equal(res.ok, true);
    assert.equal(res.usage.model_used, "gpt-5.4-2026-03-05");
  });

  it("generateCheckDraft도 onUsage로 실응답 모델을 흘린다", async () => {
    const seen = [];
    const checkJson = JSON.stringify({ results: [{ itemId: "req_001", status: "passed", userLabel: "통과", reason: "충분", evidence: [], nextAction: "다음" }] });
    const r = await quiet(() =>
      withFetch(async (url) => (isOpenAi(url) ? openAiOk(checkJson) : anthropicOk()), () =>
        generateCheckDraft({ productSpec: { productName: "빵집" }, items: [{ id: "req_001", title: "빵 목록", criteria: ["a", "b"] }], locale: "ko" }, "k", undefined, FB_OFF, (u) => seen.push(u)),
      ),
    );
    assert.equal(r.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].modelActual, "gpt-5.4-2026-03-05");
    assert.equal(seen[0].callSite, "check");
  });
});

describe("⑤ verify-panel·council 2차 호출도 실응답 모델로 계측", () => {
  const SPEC = { productName: "빵집", oneLine: "", targetUsers: [], problem: "", included: [], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] };
  const failed = { itemId: "req_001", status: "failed", title: "결제", userLabel: "안 맞음", reason: "제외 범위", evidence: ["결제"], nextAction: "확인" };
  const response = { ok: true, source: "llm", summary: { passed: 0, failed: 1, inconclusive: 0, needsDecision: 0 }, results: [failed] };

  it("★verify-panel: OpenAI 응답 model이 modelActual, callSite=verify-panel", async () => {
    const seen = [];
    await quiet(() =>
      applyVerifyPanel(response, SPEC, { OPENAI_API_KEY: "test-openai-key" }, {
        fetchImpl: async () => openAiOk(JSON.stringify({ supported: true, note_ko: "동의" })),
        onUsage: (u) => seen.push(u),
      }),
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].vendor, "openai");
    assert.equal(seen[0].modelRequested, "gpt-5.4");
    assert.equal(seen[0].modelActual, "gpt-5.4-2026-03-05");
    assert.equal(seen[0].inputTokens, 200);
    assert.equal(seen[0].cacheReadTokens, 800);
    assert.equal(seen[0].callSite, "verify-panel");
  });

  it("council: 참여 벤더 호출마다 onUsage(council-round1)", async () => {
    const seen = [];
    const verdicts = JSON.stringify({ results: [{ itemId: "req_001", status: "passed", reason: "ok", evidence: [], nextAction: "" }] });
    const fetchImpl = async (url) =>
      isOpenAi(url)
        ? openAiOk(verdicts)
        : new Response(JSON.stringify({ model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: verdicts }], usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200 });
    const r = await quiet(() =>
      runCouncilCheck(
        { productSpec: SPEC, items: [{ id: "req_001", title: "빵 목록", criteria: ["a", "b"] }], locale: "ko" },
        { ANTHROPIC_API_KEY: "test-anthropic-key", OPENAI_API_KEY: "test-openai-key" },
        { fetchImpl, onUsage: (u) => seen.push(u) },
      ),
    );
    assert.equal(r.ok, true);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen.map((u) => u.vendor).sort(), ["anthropic", "openai"]);
    assert.ok(seen.every((u) => u.callSite === "council-round1"));
    assert.equal(seen.find((u) => u.vendor === "openai").modelActual, "gpt-5.4-2026-03-05");
  });
});
