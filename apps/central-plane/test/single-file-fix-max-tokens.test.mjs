import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openSqliteD1, SQLITE_SKIP } from "./_sqlite-d1.mjs";

// B5 단일파일 고침의 LLM 호출 상한(4000) > 검수 프록시 출력 상한(2048)이라 프로덕션에서는 고침이 **항상 400**으로 끝났다
// (로컬 하네스는 프록시를 거치지 않아 성공 — 로컬/프로덕션 결과가 갈린 이유 하나). 2026-10-18 문 (b) 격차 §2.
// 두 숫자를 한 테스트로 묶는다: 어느 쪽을 바꿔도 다시 어긋나면 여기서 잡힌다.

const { createApp } = await import("../dist/router.js");
const { INSPECT_LLM_MAX_OUTPUT_TOKENS } = await import("../dist/routes/inspect-llm-proxy.js");
const { runAgentInspection, SINGLE_FILE_FIX_MAX_TOKENS } = await import("../inspector-container/agent-run.mjs");
const { makeFakeDriver, makeScriptedLlm } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://one.netlify.app";
const SRC = `<!doctype html><html><body><input id="name"><button onclick="save()">저장</button><p id="out"></p>
<script>
function save() {
  var v = document.getElementById('name').value;
  document.getElementById('out').textContent = '';
}
// 넉넉한 인라인 스크립트(단일 파일 앱 판정용) ............................................................................
// ..........................................................................................................................
</script></body></html>`;

describe("B5 단일파일 고침 호출은 검수 프록시 출력 상한 안에 있다", () => {
  it("실행기의 고침 호출 maxTokens ≤ INSPECT_LLM_MAX_OUTPUT_TOKENS (옛 코드: 4000 > 2048)", async () => {
    assert.equal(typeof SINGLE_FILE_FIX_MAX_TOKENS, "number");
    assert.ok(
      SINGLE_FILE_FIX_MAX_TOKENS <= INSPECT_LLM_MAX_OUTPUT_TOKENS,
      `single-file-fix maxTokens ${SINGLE_FILE_FIX_MAX_TOKENS} > proxy cap ${INSPECT_LLM_MAX_OUTPUT_TOKENS}`,
    );
  });

  it("실제 고침 경로가 보내는 maxTokens를 잡아 프록시 상한과 대조한다", async () => {
    const site = {
      "/": (s) => ({ status: 200, text: s.override?.includes("'저장됨 ' + v") && s.saved ? `저장됨 ${s.saved}` : "이름 저장", links: ["/"], buttons: [] }),
    };
    const driver = makeFakeDriver(site, {
      origin: ORIGIN,
      onAct: (a, s) => {
        if (a.type === "fill") s.saved = a.value;
        return null;
      },
    });
    driver.fetchSource = async () => SRC;
    driver.serveOverride = async (_u, html) => {
      driver.state.override = html;
      driver.state.saved = undefined;
    };
    const ac = { id: "AC-1", title: "이름 저장", given: "g", when: "w", then: "저장하면 '저장됨 이름'이 보인다", priority: "must", confirmed: true };
    const { llm: base } = makeScriptedLlm(
      {
        "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "" }],
        "AC-1": [
          { type: "fill", target: { label: "이름" }, value: "$NAME" },
          { type: "click", target: { role: "button", name: "저장" } },
          { type: "judge", verdict: "fail", reason: "저장해도 아무것도 안 보여요", evidenceQuote: "이름 저장" },
          { type: "fill", target: { label: "이름" }, value: "$NAME" },
          { type: "click", target: { role: "button", name: "저장" } },
          { type: "judge", verdict: "pass", reason: "저장됨이 보여요", evidenceQuote: "저장됨 $NAME" },
        ],
      },
      { fix: { edits: [{ search: "textContent = ''", replace: "textContent = '저장됨 ' + v" }], cannotFix: [] } },
    );
    const fixCalls = [];
    const llm = async (req) => {
      if (/You fix a single-file web app/.test(req.user)) fixCalls.push(req.maxTokens);
      return base(req);
    };
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [ac], acSource: "interview", llm, driver });
    assert.equal(fixCalls.length, 1, "고침 호출이 한 번 있었다");
    assert.ok(fixCalls[0] <= INSPECT_LLM_MAX_OUTPUT_TOKENS, `고침 호출 maxTokens ${fixCalls[0]} > 프록시 상한 ${INSPECT_LLM_MAX_OUTPUT_TOKENS}`);
    assert.equal(fixCalls[0], SINGLE_FILE_FIX_MAX_TOKENS);
    assert.ok(out.report.agent.singleFileFix, "고침 결과가 리포트에 실린다");
  });
});

describe("검수 프록시는 고침 호출의 maxTokens를 받아 준다", { skip: SQLITE_SKIP }, () => {
  const ICT = "ict_sff";
  const KEK = Buffer.alloc(32, 9).toString("base64");
  const BASE = "https://central.test";
  const SITE = "https://shop.example";
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  it("maxTokens = 고침 상한 → 200, 벤더에 그 max_tokens 그대로 (옛 코드: 400 invalid_request)", async () => {
    const { db, d1 } = openSqliteD1();
    let tok = null;
    const vendorBodies = [];
    const vendorFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      vendorBodies.push(body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }], model: body.model, usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    };
    const env = {
      DB: d1,
      INSPECTOR: { idFromName: (n) => n, get: () => ({ fetch: async (_u, init) => { tok = JSON.parse(init.body).agent.llmToken; return new Response("{}", { status: 202 }); } }) },
      INTERNAL_CALLBACK_TOKEN: ICT, CONCLAVE_TOKEN_KEK: KEK, ANTHROPIC_API_KEY: "test-key", INSPECTION_ENABLED: "on", INSPECTION_AGENT_PUBLIC: "on", PUBLIC_BASE_URL: BASE,
    };
    const app = createApp({ fetch: vendorFetch });
    const post = (path, body, headers = {}) =>
      app.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO workspace_projects (id, user_key, title, idea, understood_json, product_spec_json, items_json, entry_path, dev_spec_json, created_at, updated_at) VALUES ('pf', 'uk_f', 't', '', '{}', '{}', '[]', 'idea', NULL, ?, ?)`).run(now, now);
    db.prepare(`INSERT INTO project_sources (id, project_id, user_key, type, reference, label, content_type, size_bytes, created_at) VALUES ('sf', 'pf', 'uk_f', 'website', ?, 'a', NULL, NULL, ?)`).run(SITE + "/", now);
    assert.equal((await post("/workspace/projects/pf/visual-checks/run", { userKey: "uk_f", writeConsent: true })).status, 202);
    assert.ok(tok, "런 토큰이 발급됐다");
    // 옛 코드는 상수를 내보내지 않는다 — 그때 실행기가 보내던 값(4000)으로 옛 코드의 400을 드러낸다.
    const fixMax = SINGLE_FILE_FIX_MAX_TOKENS ?? 4000;
    const r = await post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", tier: "strong", maxTokens: fixMax }, { authorization: `Bearer ${tok}` });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(vendorBodies.at(-1).max_tokens, fixMax);
    // 상한 자체는 여전히 지킨다 — 그 위는 400.
    const over = await post("/internal/inspect-llm/v1/messages", { system: "s", user: "u", maxTokens: INSPECT_LLM_MAX_OUTPUT_TOKENS + 1 }, { authorization: `Bearer ${tok}` });
    assert.equal(over.status, 400);
  });
});
