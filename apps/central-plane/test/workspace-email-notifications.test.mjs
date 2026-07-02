/**
 * workspace-email-notifications.test.mjs
 *
 * Email notifications (Resend) as the simple default alternative to Telegram.
 *
 * Tests:
 *   sendWorkspaceEmail unit — ok / API error / not_configured / never throws
 *   maskEmailAddress / isValidEmailAddress / buildPrReviewEmailContent units
 *   masked logging — full address never appears in console output
 *   POST /workspace/notifications/settings (channel email) — save / validation
 *   GET  /workspace/notifications/settings — emailConfigured flag + no key leak
 *   POST /workspace/notifications/test (channel email) — 503 / send / rate limit
 *   PR review completion → email dispatch when enabled (mock fetch)
 *   Email failure does not fail the PR review response
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

function genKek() { return randomBytes(32).toString("base64"); }

const {
  sendWorkspaceEmail,
  isValidEmailAddress,
  maskEmailAddress,
  buildPrReviewEmailContent,
} = await import("../dist/workspace/email-notify.js");
const { createApp } = await import("../dist/router.js");

// ─── Mock DB (mirrors workspace-notifications.test.mjs + rate-limit table) ────

function makeDb(opts = {}) {
  const settings = new Map();
  const notifications = new Map();
  const reviewRuns = new Map();
  const repos = new Map();
  const connections = new Map();
  const prs = new Map();
  const rateLimits = new Map();
  const projectOwner = { value: "uk1" };

  return {
    _projectOwner: projectOwner,
    _settings: settings,
    _notifications: notifications,
    _reviewRuns: reviewRuns,
    _repos: repos,
    _connections: connections,
    _prs: prs,
    _rateLimits: rateLimits,
    ...opts,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO workspace_rate_limit")) {
                const key = `${args[0]}:${args[1]}`;
                const rec = rateLimits.get(key);
                if (rec) rec.count += 1;
                else rateLimits.set(key, { count: 1 });
              }
              if (sql.includes("INSERT INTO workspace_notification_settings")) {
                const [id, userKey, channel, chatId, enabled, policy, createdAt, updatedAt] = args;
                settings.set(`${userKey}:${channel}`, { id, user_key: userKey, channel, chat_id: chatId, enabled, notify_policy: policy, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("UPDATE workspace_notification_settings") && sql.includes("SET chat_id")) {
                const [chatId, enabled, policy, updatedAt, userKey, channel] = args;
                const rec = settings.get(`${userKey}:${channel}`);
                if (rec) { rec.chat_id = chatId; rec.enabled = enabled; rec.notify_policy = policy; rec.updated_at = updatedAt; }
              }
              if (sql.includes("INSERT INTO workspace_notifications")) {
                const [id, userKey, projectId, channel, eventType, status, destPrev, msgPrev, errMsg, createdAt] = args;
                notifications.set(id, { id, user_key: userKey, project_id: projectId, channel, event_type: eventType, status, destination_preview: destPrev, message_preview: msgPrev, error_message: errMsg, created_at: createdAt });
              }
              if (sql.includes("INSERT INTO workspace_pr_review_runs")) {
                const [id, projId, userKey, repoFull, prNum, linkedPrId, selJson, status, createdAt, updatedAt] = args;
                reviewRuns.set(id, { id, project_id: projId, user_key: userKey, repo_full_name: repoFull, pr_number: prNum, linked_pr_id: linkedPrId, selected_item_ids_json: selJson, status, created_at: createdAt, updated_at: updatedAt, result_json: null, error_message: null });
              }
              if (sql.includes("UPDATE workspace_pr_review_runs")) {
                const [status, resultJson, errMsg, updatedAt, id] = args;
                const rec = reviewRuns.get(id);
                if (rec) { rec.status = status; rec.result_json = resultJson; rec.error_message = errMsg; rec.updated_at = updatedAt; }
              }
              if (sql.includes("INSERT INTO workspace_usage_events")) { /* no-op */ }
            },
            async first() {
              if (sql.includes("FROM workspace_rate_limit")) {
                const rec = rateLimits.get(`${args[0]}:${args[1]}`);
                return rec ? { count: rec.count } : null;
              }
              if (sql.includes("FROM workspace_notification_settings")) {
                return settings.get(`${args[0]}:${args[1]}`) ?? null;
              }
              if (sql.includes("FROM workspace_pr_review_runs") && !sql.includes("LIMIT 2")) {
                for (const run of reviewRuns.values()) {
                  if (run.project_id === args[0] && run.repo_full_name === args[1] && run.pr_number === args[2]) return run;
                }
                return null;
              }
              if (sql.includes("FROM workspace_project_repos")) return repos.get(args[0]) ?? null;
              if (sql.includes("FROM workspace_github_connections")) return connections.get(args[0]) ?? null;
              if (sql.includes("FROM workspace_workspace_projects") || sql.includes("FROM workspace_projects")) {
                return { id: args[0], user_key: projectOwner.value, title: "T", idea: "",
                  understood_json: null, product_spec_json: "{}", items_json: "[]",
                  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM workspace_notifications")) {
                const results = [];
                for (const n of notifications.values()) {
                  if (n.user_key === args[0]) results.push(n);
                }
                return { results: results.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, args[1] ?? 20) };
              }
              if (sql.includes("FROM workspace_linked_prs")) {
                const results = [];
                for (const p of prs.values()) {
                  if (p.project_id === args[0]) results.push(p);
                }
                return { results };
              }
              if (sql.includes("FROM workspace_pr_review_runs") && sql.includes("LIMIT 2")) {
                return { results: [] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function makeEnv(override = {}) {
  return {
    ENVIRONMENT: "test",
    CONCLAVE_TOKEN_KEK: genKek(),
    RESEND_API_KEY: "re_test_fake_key",
    ANTHROPIC_API_KEY: "sk-test-fake-key",
    DB: makeDb(),
    ...override,
  };
}

function makeRequest(method, path, body, env, fetchImpl) {
  const app = createApp({ fetch: fetchImpl ?? (async () => new Response("{}", { status: 200 })) });
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return app.fetch(req, env);
}

// ─── Unit: helpers ─────────────────────────────────────────────────────────────

describe("maskEmailAddress", () => {
  it("masks the local part, keeps the domain", () => {
    assert.equal(maskEmailAddress("alice@example.com"), "a***@example.com");
    assert.equal(maskEmailAddress("b@x.io"), "b***@x.io");
  });
  it("never returns the full input for weird strings", () => {
    assert.equal(maskEmailAddress("no-at-sign"), "***");
    assert.equal(maskEmailAddress("@leading.at"), "***");
  });
});

describe("isValidEmailAddress", () => {
  it("accepts x@y.z shapes", () => {
    assert.ok(isValidEmailAddress("a@b.co"));
    assert.ok(isValidEmailAddress("user.name+tag@sub.domain.org"));
  });
  it("rejects obviously invalid input", () => {
    assert.ok(!isValidEmailAddress(""));
    assert.ok(!isValidEmailAddress("no-at"));
    assert.ok(!isValidEmailAddress("a@b"));
    assert.ok(!isValidEmailAddress("a b@c.d"));
    assert.ok(!isValidEmailAddress("a@b c.d"));
  });
});

describe("buildPrReviewEmailContent", () => {
  it("builds a subject with repo + PR number and a body with results", () => {
    const { subject, text } = buildPrReviewEmailContent({
      repoFullName: "org/repo",
      prNumber: 42,
      summary: { passed: 3, failed: 1, inconclusive: 0, needsDecision: 0 },
    });
    assert.ok(subject.includes("org/repo"));
    assert.ok(subject.includes("#42"));
    assert.ok(text.includes("통과: 3"));
    assert.ok(text.includes("안 맞음: 1"));
  });
});

// ─── Unit: sendWorkspaceEmail ─────────────────────────────────────────────────

describe("sendWorkspaceEmail", () => {
  it("returns not_configured when RESEND_API_KEY is missing (no fetch call)", async () => {
    let called = false;
    const res = await sendWorkspaceEmail(
      { RESEND_API_KEY: undefined },
      { to: "a@b.co", subject: "s", text: "t" },
      async () => { called = true; return new Response("{}", { status: 200 }); },
    );
    assert.deepEqual(res, { ok: false, error: "not_configured" });
    assert.equal(called, false, "fetch must not be called without a key");
  });

  it("POSTs to the Resend API with Bearer auth and the default from", async () => {
    let captured = null;
    const res = await sendWorkspaceEmail(
      { RESEND_API_KEY: "re_key_123" },
      { to: "alice@example.com", subject: "Hello", text: "Body" },
      async (url, init) => {
        captured = { url, init };
        return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
      },
    );
    assert.equal(res.ok, true);
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.equal(captured.init.method, "POST");
    assert.equal(captured.init.headers["Authorization"], "Bearer re_key_123");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.from, "Simsa <notify@trysimsa.com>");
    assert.deepEqual(body.to, ["alice@example.com"]);
    assert.equal(body.subject, "Hello");
    assert.equal(body.text, "Body");
  });

  it("honors NOTIFY_EMAIL_FROM override", async () => {
    let from = "";
    await sendWorkspaceEmail(
      { RESEND_API_KEY: "re_key", NOTIFY_EMAIL_FROM: "Other <o@x.dev>" },
      { to: "a@b.co", subject: "s", text: "t" },
      async (_url, init) => { from = JSON.parse(init.body).from; return new Response("{}", { status: 200 }); },
    );
    assert.equal(from, "Other <o@x.dev>");
  });

  it("returns resend_<status> on API error (no throw)", async () => {
    const res = await sendWorkspaceEmail(
      { RESEND_API_KEY: "re_key" },
      { to: "a@b.co", subject: "s", text: "t" },
      async () => new Response("Unauthorized", { status: 401 }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, "resend_401");
  });

  it("never throws when fetch rejects", async () => {
    const res = await sendWorkspaceEmail(
      { RESEND_API_KEY: "re_key" },
      { to: "a@b.co", subject: "s", text: "t" },
      async () => { throw new Error("network down"); },
    );
    assert.equal(res.ok, false);
    assert.equal(res.error, "network down");
  });

  it("masks the address in warn logs on failure (full address never logged)", async () => {
    const warned = [];
    const origWarn = console.warn;
    console.warn = (...a) => { warned.push(a.map(String).join(" ")); };
    try {
      await sendWorkspaceEmail(
        { RESEND_API_KEY: "re_key" },
        { to: "secretuser@example.com", subject: "s", text: "t" },
        async () => new Response("err", { status: 500 }),
      );
      await sendWorkspaceEmail(
        { RESEND_API_KEY: "re_key" },
        { to: "secretuser@example.com", subject: "s", text: "t" },
        async () => { throw new Error("boom"); },
      );
    } finally {
      console.warn = origWarn;
    }
    const all = warned.join("\n");
    assert.ok(!all.includes("secretuser@example.com"), "full address must not be logged");
    assert.ok(all.includes("s***@example.com"), "masked address expected in logs");
  });
});

// ─── Settings endpoints (channel: email) ──────────────────────────────────────

describe("POST /workspace/notifications/settings (email)", () => {
  it("saves email settings and returns emailAddress alias", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "email", emailAddress: "alice@example.com",
      enabled: true, notifyPolicy: "problems_only",
    }, env);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.channel, "email");
    assert.equal(body.settings.emailAddress, "alice@example.com");
    assert.equal(body.settings.notifyPolicy, "problems_only");
  });

  it("returns 400 emailAddress_required when address missing", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "email", emailAddress: "", enabled: true, notifyPolicy: "always",
    }, env);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "emailAddress_required");
  });

  it("returns 400 invalid_email on bad format", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "email", emailAddress: "not-an-email", enabled: true, notifyPolicy: "always",
    }, env);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_email");
  });

  it("updates existing email settings on second save", async () => {
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "email", emailAddress: "a@b.co", enabled: true, notifyPolicy: "problems_only",
    }, env);
    const res2 = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "email", emailAddress: "c@d.org", enabled: false, notifyPolicy: "always",
    }, env);
    const body = await res2.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.emailAddress, "c@d.org");
    assert.equal(body.settings.enabled, false);
  });

  it("keeps telegram and email settings independent (same userKey)", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "bot:tok" });
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_both", channel: "telegram", chatId: "123", enabled: true, notifyPolicy: "always",
    }, env);
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_both", channel: "email", emailAddress: "b@e.co", enabled: true, notifyPolicy: "always",
    }, env);
    const tg = await (await makeRequest("GET", "/workspace/notifications/settings?userKey=uk_both&channel=telegram", null, env)).json();
    const em = await (await makeRequest("GET", "/workspace/notifications/settings?userKey=uk_both&channel=email", null, env)).json();
    assert.equal(tg.settings.chatId, "123");
    assert.equal(em.settings.emailAddress, "b@e.co");
  });
});

describe("GET /workspace/notifications/settings (email)", () => {
  it("returns emailConfigured true/false from RESEND_API_KEY presence", async () => {
    const on = await (await makeRequest("GET", "/workspace/notifications/settings?userKey=u&channel=email", null, makeEnv())).json();
    assert.equal(on.emailConfigured, true);
    const off = await (await makeRequest("GET", "/workspace/notifications/settings?userKey=u&channel=email", null, makeEnv({ RESEND_API_KEY: undefined }))).json();
    assert.equal(off.emailConfigured, false);
  });

  it("does not expose RESEND_API_KEY in the response", async () => {
    const env = makeEnv({ RESEND_API_KEY: "re_secret_key_should_not_appear" });
    const res = await makeRequest("GET", "/workspace/notifications/settings?userKey=u&channel=email", null, env);
    const raw = await res.text();
    assert.ok(!raw.includes("re_secret_key_should_not_appear"));
  });
});

// ─── POST /workspace/notifications/test (email) ───────────────────────────────

describe("POST /workspace/notifications/test (email)", () => {
  it("returns 503 email_not_configured when RESEND_API_KEY absent", async () => {
    const env = makeEnv({ RESEND_API_KEY: undefined });
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_t", channel: "email", emailAddress: "a@b.co", enabled: true, notifyPolicy: "always",
    }, env);
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_t", channel: "email" }, env);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "email_not_configured");
  });

  it("returns 400 settings_not_found before any settings saved", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_none", channel: "email" }, env);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "settings_not_found");
  });

  it("sends via Resend and records history with a MASKED destination", async () => {
    let resendCalled = false;
    const mockFetch = async (url, init) => {
      if (typeof url === "string" && url.includes("api.resend.com")) {
        resendCalled = true;
        const b = JSON.parse(init.body);
        assert.deepEqual(b.to, ["alice@example.com"]);
        return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_send", channel: "email", emailAddress: "alice@example.com", enabled: true, notifyPolicy: "always",
    }, env, mockFetch);
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_send", channel: "email" }, env, mockFetch);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "sent");
    assert.ok(resendCalled);

    const hist = await (await makeRequest("GET", "/workspace/notifications?userKey=uk_send", null, env)).json();
    assert.ok(hist.notifications.length > 0);
    assert.equal(hist.notifications[0].channel, "email");
    assert.equal(hist.notifications[0].status, "sent");
    assert.equal(hist.notifications[0].destinationPreview, "email:a***@example.com");
    const raw = JSON.stringify(hist);
    assert.ok(!raw.includes("alice@example.com"), "history must never contain the full address");
  });

  it("records error status when Resend fails (502)", async () => {
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.resend.com")) {
        return new Response("Bad Request", { status: 422 });
      }
      return new Response("{}", { status: 200 });
    };
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_err", channel: "email", emailAddress: "e@f.io", enabled: true, notifyPolicy: "always",
    }, env, mockFetch);
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_err", channel: "email" }, env, mockFetch);
    assert.equal(res.status, 502);
    const hist = await (await makeRequest("GET", "/workspace/notifications?userKey=uk_err", null, env)).json();
    assert.equal(hist.notifications[0].status, "error");
    assert.equal(hist.notifications[0].errorMessage, "resend_422");
  });

  it("rate limits test sends at 5/hour per userKey (429 on the 6th)", async () => {
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.resend.com")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_rl", channel: "email", emailAddress: "r@l.io", enabled: true, notifyPolicy: "always",
    }, env, mockFetch);
    for (let i = 0; i < 5; i++) {
      const r = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_rl", channel: "email" }, env, mockFetch);
      assert.equal(r.status, 200, `send ${i + 1} should pass`);
    }
    const sixth = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_rl", channel: "email" }, env, mockFetch);
    assert.equal(sixth.status, 429);
    const body = await sixth.json();
    assert.equal(body.error, "rate_limited");
    assert.ok(body.retryAfterSeconds >= 60);
  });

  it("rate limit is per userKey (other users unaffected)", async () => {
    const mockFetch = async () => new Response("{}", { status: 200 });
    const env = makeEnv();
    for (const uk of ["uk_a", "uk_b"]) {
      await makeRequest("POST", "/workspace/notifications/settings", {
        userKey: uk, channel: "email", emailAddress: "x@y.zz", enabled: true, notifyPolicy: "always",
      }, env, mockFetch);
    }
    for (let i = 0; i < 5; i++) {
      await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_a", channel: "email" }, env, mockFetch);
    }
    const blocked = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_a", channel: "email" }, env, mockFetch);
    assert.equal(blocked.status, 429);
    const other = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_b", channel: "email" }, env, mockFetch);
    assert.equal(other.status, 200);
  });
});

// ─── PR review completion → email dispatch ────────────────────────────────────

const LLM_TEXT_ALL_PASSED = JSON.stringify({
  results: [
    { itemId: "i1", status: "passed", userLabel: "통과", reason: "ok", evidence: [], nextAction: "" },
    { itemId: "i2", status: "passed", userLabel: "통과", reason: "ok", evidence: [], nextAction: "" },
    { itemId: "i3", status: "passed", userLabel: "통과", reason: "ok", evidence: [], nextAction: "" },
  ],
});

const LLM_TEXT_WITH_FAILURE = JSON.stringify({
  results: [
    { itemId: "i1", status: "failed", userLabel: "안 맞음", reason: "JWT 없음", evidence: [], nextAction: "" },
    { itemId: "i2", status: "failed", userLabel: "안 맞음", reason: "구현 안 됨", evidence: [], nextAction: "" },
    { itemId: "i3", status: "passed", userLabel: "통과", reason: "ok", evidence: [], nextAction: "" },
  ],
});

const REVIEW_ITEMS = [
  { id: "i1", title: "로그인", criteria: ["JWT 인증"] },
  { id: "i2", title: "알림", criteria: ["알림 전송"] },
  { id: "i3", title: "권한", criteria: ["권한 검사"] },
];
const REVIEW_PRODUCT_SPEC = {
  name: "테스트 앱", overview: "테스트", features: [], excluded: [], openQuestions: [],
};

function makeReviewFetch(prNumber, llmText, onResend) {
  return async (url, init) => {
    if (typeof url === "string" && url.includes("api.resend.com")) {
      return onResend(url, init);
    }
    if (typeof url === "string" && url.includes(`pulls/${prNumber}/files`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (typeof url === "string" && url.includes("api.anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ type: "text", text: llmText }] }), { status: 200 });
    }
    if (typeof url === "string" && url.includes(`/pulls/${prNumber}`)) {
      return new Response(JSON.stringify({ number: prNumber, title: "Test PR", head: { ref: "feat" }, base: { ref: "main" }, additions: 5, deletions: 1, changed_files: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

async function runReviewWithMockLLM(env, mockFetch, userKey, prNumber) {
  const db = env.DB;
  db._projectOwner.value = userKey;

  db._repos.set("proj1", { id: "repo1", project_id: "proj1", repo_full_name: "org/repo", repo_owner: "org", repo_name: "repo", default_branch: "main", is_private: 0, html_url: "https://github.com/org/repo" });

  const { encryptToken } = await import("../dist/crypto.js");
  const enc = await encryptToken("ghp_faketoken", env.CONCLAVE_TOKEN_KEK);
  db._connections.set(userKey, { id: "conn1", user_key: userKey, access_token_enc: enc, github_user_id: "1", github_login: "user", scopes: "public_repo" });

  db._prs.set(`proj1:${prNumber}`, { id: "pr1", project_id: "proj1", repo_full_name: "org/repo", pr_number: prNumber, pr_title: "feat: test", pr_state: "open", html_url: "https://github.com/org/repo/pull/1", pr_head_branch: "feat", pr_base_branch: "main", selected_item_ids_json: JSON.stringify(["i1", "i2", "i3"]), updated_at: "2026-01-01T00:00:00.000Z" });

  const app = createApp({ fetch: mockFetch });
  return app.fetch(new Request(`http://localhost/workspace/projects/proj1/github/pulls/${prNumber}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userKey,
      selectedItemIds: ["i1", "i2", "i3"],
      items: REVIEW_ITEMS,
      productSpec: REVIEW_PRODUCT_SPEC,
    }),
  }), env);
}

async function saveEmailSettings(env, mockFetch, userKey, notifyPolicy) {
  const app = createApp({ fetch: mockFetch });
  await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userKey, channel: "email", emailAddress: "alice@example.com", enabled: true, notifyPolicy }),
  }), env);
}

describe("PR review → email dispatch", () => {
  it("sends email when enabled with failed items (problems_only)", async () => {
    let emailCalled = false;
    let sentBody = null;
    const mockFetch = makeReviewFetch(11, LLM_TEXT_WITH_FAILURE, (_url, init) => {
      emailCalled = true;
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    });

    const env = makeEnv();
    await saveEmailSettings(env, mockFetch, "uk_em1", "problems_only");
    const res = await runReviewWithMockLLM(env, mockFetch, "uk_em1", 11);
    assert.equal(res.status, 200);
    assert.equal(emailCalled, true, "Resend must be called when problems exist");
    assert.deepEqual(sentBody.to, ["alice@example.com"]);
    assert.ok(sentBody.subject.includes("org/repo"));
    assert.ok(sentBody.text.includes("안 맞음"));
  });

  it("problems_only: skips email (with skipped record) when all passed", async () => {
    let emailCalled = false;
    const mockFetch = makeReviewFetch(12, LLM_TEXT_ALL_PASSED, () => {
      emailCalled = true;
      return new Response("{}", { status: 200 });
    });

    const env = makeEnv();
    await saveEmailSettings(env, mockFetch, "uk_em2", "problems_only");
    await runReviewWithMockLLM(env, mockFetch, "uk_em2", 12);
    assert.equal(emailCalled, false, "no email when all passed + problems_only");

    const app = createApp({ fetch: mockFetch });
    const hist = await (await app.fetch(new Request("http://localhost/workspace/notifications?userKey=uk_em2"), env)).json();
    const skipped = hist.notifications.find((n) => n.channel === "email" && n.status === "skipped");
    assert.ok(skipped, "must record an email skipped entry");
    assert.equal(skipped.destinationPreview, "email:a***@example.com");
  });

  it("does not send when RESEND_API_KEY is unset (dormant), review still succeeds", async () => {
    let emailCalled = false;
    const mockFetch = makeReviewFetch(13, LLM_TEXT_WITH_FAILURE, () => {
      emailCalled = true;
      return new Response("{}", { status: 200 });
    });

    const env = makeEnv({ RESEND_API_KEY: undefined });
    await saveEmailSettings(env, mockFetch, "uk_em3", "always");
    const res = await runReviewWithMockLLM(env, mockFetch, "uk_em3", 13);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(emailCalled, false);
  });

  it("Resend failure does not fail the PR review response", async () => {
    const mockFetch = makeReviewFetch(14, LLM_TEXT_WITH_FAILURE, () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const env = makeEnv();
    await saveEmailSettings(env, mockFetch, "uk_em4", "always");
    const res = await runReviewWithMockLLM(env, mockFetch, "uk_em4", 14);
    const body = await res.json();
    assert.equal(body.ok, true, "PR review must succeed even when email fails");
    assert.equal(res.status, 200);

    const app = createApp({ fetch: mockFetch });
    const hist = await (await app.fetch(new Request("http://localhost/workspace/notifications?userKey=uk_em4"), env)).json();
    const errRec = hist.notifications.find((n) => n.channel === "email" && n.status === "error");
    assert.ok(errRec, "email error must be recorded in history");
  });

  it("sends BOTH telegram and email when both channels enabled", async () => {
    let emailCalled = false;
    let tgCalled = false;
    const base = makeReviewFetch(15, LLM_TEXT_WITH_FAILURE, () => {
      emailCalled = true;
      return new Response("{}", { status: 200 });
    });
    const mockFetch = async (url, init) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        tgCalled = true;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      return base(url, init);
    };

    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "bot123:tok" });
    const app = createApp({ fetch: mockFetch });
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_em5", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "always" }),
    }), env);
    await saveEmailSettings(env, mockFetch, "uk_em5", "always");

    await runReviewWithMockLLM(env, mockFetch, "uk_em5", 15);
    assert.equal(tgCalled, true, "telegram must fire");
    assert.equal(emailCalled, true, "email must fire alongside telegram");
  });
});
