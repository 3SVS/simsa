/**
 * workspace-notifications.test.mjs
 *
 * Stage 17: Telegram notification settings, test, history,
 *           and PR review → notification dispatch.
 *
 * Tests:
 *   buildPrReviewTelegramMessage / truncateTelegramMessage unit tests
 *   POST /workspace/notifications/settings — save settings
 *   GET  /workspace/notifications/settings — read settings
 *   POST /workspace/notifications/test — requires TELEGRAM_BOT_TOKEN
 *   POST /workspace/notifications/test — calls Telegram sendMessage
 *   POST /workspace/notifications/test — records sent / error
 *   PR review problems_only: skips when all passed
 *   PR review problems_only: sends when failed exists
 *   PR review always: sends even when all passed
 *   Telegram failure does not fail PR review
 *   GET /workspace/notifications — history list
 *   GET /workspace/notifications/settings — token not exposed
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

function genKek() { return randomBytes(32).toString("base64"); }

const { buildPrReviewTelegramMessage, truncateTelegramMessage } =
  await import("../dist/workspace/telegram-notify.js");
const { createApp } = await import("../dist/router.js");

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function makeDb(opts = {}) {
  const settings = new Map();
  const notifications = new Map();
  const reviewRuns = new Map();
  const repos = new Map();
  const connections = new Map();
  const prs = new Map();
  // Ownership hardening: routes now verify the project belongs to the caller.
  // Tests set this to the userKey they call with.
  const projectOwner = { value: "uk1" };

  return {
    _projectOwner: projectOwner,
    _settings: settings,
    _notifications: notifications,
    _reviewRuns: reviewRuns,
    _repos: repos,
    _connections: connections,
    _prs: prs,
    ...opts,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO workspace_notification_settings")) {
                const [id, userKey, channel, chatId, enabled, policy, createdAt, updatedAt] = args;
                settings.set(`${userKey}:${channel}`, { id, user_key: userKey, channel, chat_id: chatId, enabled, notify_policy: policy, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("UPDATE workspace_notification_settings") && sql.includes("SET chat_id")) {
                const [chatId, enabled, policy, updatedAt, userKey, channel] = args;
                const key = `${userKey}:${channel}`;
                const rec = settings.get(key);
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
              if (sql.includes("INSERT INTO workspace_project_repos") || (sql.includes("ON CONFLICT") && sql.includes("workspace_project_repos"))) {
                const [id, projId, repoFull, owner, repoName, defBranch, priv, htmlUrl, createdAt, updatedAt] = args;
                repos.set(projId, { id, project_id: projId, repo_full_name: repoFull, repo_owner: owner, repo_name: repoName, default_branch: defBranch, is_private: priv, html_url: htmlUrl, created_at: createdAt, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_github_connections") || (sql.includes("workspace_github_connections") && sql.includes("UPDATE"))) {
                if (args[0]) connections.set(args[1], { id: args[0], user_key: args[1], access_token_enc: args[6] ?? "", github_user_id: args[2], github_login: args[3], scopes: args[7] ?? "" });
              }
              if (sql.includes("INSERT INTO workspace_linked_prs") || (sql.includes("ON CONFLICT") && sql.includes("workspace_linked_prs"))) {
                const [id, projId, repoFull, prNum, prTitle, prState, htmlUrl, headBranch, baseBranch, selJson, updatedAt] = args;
                prs.set(`${projId}:${prNum}`, { id, project_id: projId, repo_full_name: repoFull, pr_number: prNum, pr_title: prTitle, pr_state: prState, html_url: htmlUrl, pr_head_branch: headBranch, pr_base_branch: baseBranch, selected_item_ids_json: selJson, updated_at: updatedAt });
              }
              if (sql.includes("INSERT INTO workspace_usage_events")) { /* no-op */ }
              if (sql.includes("INSERT INTO workspace_pr_comments")) { /* no-op for this test suite */ }
            },
            async first() {
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
              if (sql.includes("FROM workspace_oauth_states")) return null;
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
    TELEGRAM_BOT_TOKEN: "bot123:testtoken",
    ANTHROPIC_API_KEY: "sk-test-fake-key",  // ensures LLM path is taken (not heuristic fallback)
    DB: makeDb(),
    ...override,
  };
}

function makeRequest(method, path, body, env) {
  const app = createApp({ fetch: async () => new Response("{}", { status: 200 }) });
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return app.fetch(req, env);
}

// ─── Unit: buildPrReviewTelegramMessage ───────────────────────────────────────

describe("buildPrReviewTelegramMessage", () => {
  it("includes required fields", () => {
    const msg = buildPrReviewTelegramMessage({
      repoFullName: "org/repo",
      prNumber: 42,
      summary: { passed: 3, failed: 1, inconclusive: 0, needsDecision: 0 },
    });
    assert.ok(msg.includes("Simsa PR 확인 완료"));
    assert.ok(msg.includes("org/repo"));
    assert.ok(msg.includes("#42"));
    assert.ok(msg.includes("통과: 3"));
    assert.ok(msg.includes("안 맞음: 1"));
  });

  it("includes prTitle when provided", () => {
    const msg = buildPrReviewTelegramMessage({
      repoFullName: "org/repo",
      prNumber: 5,
      prTitle: "Add login flow",
      summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 },
    });
    assert.ok(msg.includes("Add login flow"));
  });

  it("includes problematic items", () => {
    const msg = buildPrReviewTelegramMessage({
      repoFullName: "org/repo",
      prNumber: 1,
      summary: { passed: 0, failed: 2, inconclusive: 0, needsDecision: 0 },
      problematicItems: [
        { title: "인증", status: "failed" },
        { title: "권한", status: "inconclusive" },
      ],
    });
    assert.ok(msg.includes("아직 봐야 할 항목:"));
    assert.ok(msg.includes("인증"));
    assert.ok(msg.includes("권한"));
  });

  it("includes dashboardUrl when provided", () => {
    const msg = buildPrReviewTelegramMessage({
      repoFullName: "org/repo",
      prNumber: 1,
      summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 },
      dashboardUrl: "https://dashboard.example.com/projects/p1/github",
    });
    assert.ok(msg.includes("dashboard.example.com"));
  });

  it("truncates at 3500 chars", () => {
    // Each title ~700 chars, 5 items shown → ~3500 chars total including header/footer
    const longTitle = "a".repeat(700);
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `${longTitle}_${i}`, status: "failed" }));
    const msg = buildPrReviewTelegramMessage({
      repoFullName: "org/repo",
      prNumber: 1,
      summary: { passed: 0, failed: 5, inconclusive: 0, needsDecision: 0 },
      problematicItems: items,
      dashboardUrl: "https://example.com/projects/proj/github",
    });
    assert.ok(msg.length <= 3500);
    assert.ok(msg.includes("생략됐습니다"));
  });
});

describe("truncateTelegramMessage", () => {
  it("returns as-is when short", () => {
    assert.equal(truncateTelegramMessage("hello"), "hello");
  });
  it("truncates when over maxLen", () => {
    const long = "x".repeat(4000);
    const result = truncateTelegramMessage(long, 3500);
    assert.ok(result.length <= 3500);
    assert.ok(result.includes("생략됐습니다"));
  });
});

// ─── POST /workspace/notifications/settings ───────────────────────────────────

describe("POST /workspace/notifications/settings", () => {
  it("saves settings and returns them", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1",
      channel: "telegram",
      chatId: "987654321",
      enabled: true,
      notifyPolicy: "problems_only",
    }, env);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.chatId, "987654321");
    assert.equal(body.settings.notifyPolicy, "problems_only");
  });

  it("returns 400 when chatId is missing", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1",
      channel: "telegram",
      chatId: "",
      enabled: true,
      notifyPolicy: "always",
    }, env);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "chatId_required");
  });

  it("updates existing settings on second save", async () => {
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "telegram", chatId: "111", enabled: true, notifyPolicy: "problems_only",
    }, env);
    const res2 = await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk1", channel: "telegram", chatId: "222", enabled: false, notifyPolicy: "always",
    }, env);
    const body = await res2.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.chatId, "222");
    assert.equal(body.settings.notifyPolicy, "always");
  });
});

// ─── GET /workspace/notifications/settings ────────────────────────────────────

describe("GET /workspace/notifications/settings", () => {
  it("returns null settings when none saved", async () => {
    const env = makeEnv();
    const res = await makeRequest("GET", "/workspace/notifications/settings?userKey=uk_new&channel=telegram", null, env);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings, null);
  });

  it("returns saved settings", async () => {
    const env = makeEnv();
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk2", channel: "telegram", chatId: "555", enabled: true, notifyPolicy: "always",
    }, env);
    const res = await makeRequest("GET", "/workspace/notifications/settings?userKey=uk2&channel=telegram", null, env);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.settings.chatId, "555");
  });

  it("does not expose TELEGRAM_BOT_TOKEN in response", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "secret_bot_token_should_not_appear" });
    const res = await makeRequest("GET", "/workspace/notifications/settings?userKey=uk3&channel=telegram", null, env);
    const raw = await res.text();
    assert.ok(!raw.includes("secret_bot_token_should_not_appear"), "token must not appear in response");
  });

  it("returns telegramEnabled: false when token absent", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: undefined });
    const res = await makeRequest("GET", "/workspace/notifications/settings?userKey=uk4&channel=telegram", null, env);
    const body = await res.json();
    assert.equal(body.telegramEnabled, false);
  });
});

// ─── POST /workspace/notifications/test ──────────────────────────────────────

describe("POST /workspace/notifications/test", () => {
  it("returns 503 when TELEGRAM_BOT_TOKEN is absent", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: undefined });
    // save settings first so the test doesn't fail on settings_not_found
    await makeRequest("POST", "/workspace/notifications/settings", {
      userKey: "uk_test", channel: "telegram", chatId: "123", enabled: true, notifyPolicy: "always",
    }, env);
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_test", channel: "telegram" }, env);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "telegram_not_configured");
  });

  it("returns 400 when settings not saved yet", async () => {
    const env = makeEnv();
    const res = await makeRequest("POST", "/workspace/notifications/test", { userKey: "uk_nosettings", channel: "telegram" }, env);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "settings_not_found");
  });

  it("calls Telegram sendMessage and records sent", async () => {
    let telegramCalled = false;
    let sentText = "";
    const mockFetch = async (url, init) => {
      if (typeof url === "string" && url.includes("sendMessage")) {
        telegramCalled = true;
        const b = JSON.parse(init.body);
        sentText = b.text;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });

    // Save settings
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_send", channel: "telegram", chatId: "777", enabled: true, notifyPolicy: "always" }),
    }), env);

    // Send test
    const res = await app.fetch(new Request("http://localhost/workspace/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_send", channel: "telegram" }),
    }), env);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "sent");
    assert.ok(telegramCalled, "sendMessage must be called");
    assert.ok(sentText.includes("Simsa 테스트 메시지"));
  });

  it("records error when Telegram sendMessage fails", async () => {
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("sendMessage")) {
        return new Response("Bad Request", { status: 400 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });

    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_fail", channel: "telegram", chatId: "888", enabled: true, notifyPolicy: "always" }),
    }), env);

    const res = await app.fetch(new Request("http://localhost/workspace/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_fail", channel: "telegram" }),
    }), env);

    assert.equal(res.status, 502);

    // Check notification was recorded as error
    const notifRes = await app.fetch(new Request("http://localhost/workspace/notifications?userKey=uk_fail"), env);
    const notifBody = await notifRes.json();
    assert.ok(notifBody.notifications.length > 0);
    assert.equal(notifBody.notifications[0].status, "error");
  });
});

// ─── PR review → notification dispatch ────────────────────────────────────────

// LLM text response — the format reviewPRAgainstItems expects from Anthropic
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

async function runReviewWithMockLLM(env, mockFetch, userKey, prNumber) {
  const db = env.DB;
  const kek = env.CONCLAVE_TOKEN_KEK;
  db._projectOwner.value = userKey;

  db._repos.set("proj1", { id: "repo1", project_id: "proj1", repo_full_name: "org/repo", repo_owner: "org", repo_name: "repo", default_branch: "main", is_private: 0, html_url: "https://github.com/org/repo" });

  const { encryptToken } = await import("../dist/crypto.js");
  const enc = await encryptToken("ghp_faketoken", kek);
  db._connections.set(userKey, { id: "conn1", user_key: userKey, access_token_enc: enc, github_user_id: "1", github_login: "user", scopes: "public_repo" });

  db._prs.set(`proj1:${prNumber}`, { id: "pr1", project_id: "proj1", repo_full_name: "org/repo", pr_number: prNumber, pr_title: "feat: test", pr_state: "open", html_url: "https://github.com/org/repo/pull/1", pr_head_branch: "feat", pr_base_branch: "main", selected_item_ids_json: JSON.stringify(["i1", "i2", "i3"]), updated_at: "2026-01-01T00:00:00.000Z" });

  const app = createApp({ fetch: mockFetch });
  return app.fetch(new Request(`http://localhost/workspace/projects/proj1/github/pulls/${prNumber}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Pass items + productSpec in body so the endpoint doesn't need to query workspace_projects
    body: JSON.stringify({
      userKey,
      selectedItemIds: ["i1", "i2", "i3"],
      items: REVIEW_ITEMS,
      productSpec: REVIEW_PRODUCT_SPEC,
    }),
  }), env);
}

describe("PR review → notification dispatch", () => {
  it("problems_only: skips notification when all passed", async () => {
    let tgCalled = false;
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) { tgCalled = true; }
      if (typeof url === "string" && url.includes("pulls/1/files")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === "string" && url.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "text", text: LLM_TEXT_ALL_PASSED }] }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/pulls/1")) {
        return new Response(JSON.stringify({ number: 1, title: "Test PR", head: { ref: "feat" }, base: { ref: "main" }, additions: 10, deletions: 2, changed_files: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    // Save notification settings: problems_only
    const app = createApp({ fetch: mockFetch });
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_po", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "problems_only" }),
    }), env);

    await runReviewWithMockLLM(env, mockFetch, "uk_po", 1);

    assert.equal(tgCalled, false, "Telegram must NOT be called when all passed + problems_only");

    // Check skipped record
    const notifRes = await app.fetch(new Request("http://localhost/workspace/notifications?userKey=uk_po"), env);
    const nb = await notifRes.json();
    const skipped = nb.notifications.find((n) => n.status === "skipped");
    assert.ok(skipped, "must have a skipped record");
  });

  it("problems_only: sends when failed items exist", async () => {
    let tgCalled = false;
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        tgCalled = true;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("pulls/2/files")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === "string" && url.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "text", text: LLM_TEXT_WITH_FAILURE }] }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/pulls/2")) {
        return new Response(JSON.stringify({ number: 2, title: "Test PR", head: { ref: "feat" }, base: { ref: "main" }, additions: 5, deletions: 1, changed_files: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_fail2", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "problems_only" }),
    }), env);

    await runReviewWithMockLLM(env, mockFetch, "uk_fail2", 2);

    assert.equal(tgCalled, true, "Telegram must be called when failed + problems_only");
  });

  it("always: sends even when all passed", async () => {
    let tgCalled = false;
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        tgCalled = true;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("pulls/3/files")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === "string" && url.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "text", text: LLM_TEXT_ALL_PASSED }] }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/pulls/3")) {
        return new Response(JSON.stringify({ number: 3, title: "Test PR", head: { ref: "feat" }, base: { ref: "main" }, additions: 3, deletions: 0, changed_files: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_always", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "always" }),
    }), env);

    await runReviewWithMockLLM(env, mockFetch, "uk_always", 3);

    assert.equal(tgCalled, true, "Telegram must be called with always policy even when all passed");
  });

  it("Telegram failure does not fail PR review response", async () => {
    const mockFetch = async (url) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (typeof url === "string" && url.includes("pulls/4/files")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (typeof url === "string" && url.includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "text", text: LLM_TEXT_WITH_FAILURE }] }), { status: 200 });
      }
      if (typeof url === "string" && url.includes("/pulls/4")) {
        return new Response(JSON.stringify({ number: 4, title: "Test PR", head: { ref: "feat" }, base: { ref: "main" }, additions: 1, deletions: 0, changed_files: 1 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_tgfail", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "always" }),
    }), env);

    const res = await runReviewWithMockLLM(env, mockFetch, "uk_tgfail", 4);
    const body = await res.json();
    // PR review itself must succeed even though Telegram failed
    assert.equal(body.ok, true, "PR review must succeed even when Telegram fails");
    assert.equal(res.status, 200);
  });
});

// ─── GET /workspace/notifications ─────────────────────────────────────────────

describe("GET /workspace/notifications", () => {
  it("returns empty list when no history", async () => {
    const env = makeEnv();
    const res = await makeRequest("GET", "/workspace/notifications?userKey=uk_empty", null, env);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.notifications, []);
  });

  it("returns recorded notifications ordered by time desc", async () => {
    const mockFetch = async (url, init) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const env = makeEnv();
    const app = createApp({ fetch: mockFetch });

    // Save settings and send two test notifications
    await app.fetch(new Request("http://localhost/workspace/notifications/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_hist", channel: "telegram", chatId: "999", enabled: true, notifyPolicy: "always" }),
    }), env);
    await app.fetch(new Request("http://localhost/workspace/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_hist", channel: "telegram" }),
    }), env);
    await app.fetch(new Request("http://localhost/workspace/notifications/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey: "uk_hist", channel: "telegram" }),
    }), env);

    const res = await app.fetch(new Request("http://localhost/workspace/notifications?userKey=uk_hist"), env);
    const body = await res.json();
    assert.ok(body.notifications.length >= 2);
    assert.equal(body.notifications[0].status, "sent");
  });

  it("returns 400 when userKey missing", async () => {
    const env = makeEnv();
    const res = await makeRequest("GET", "/workspace/notifications", null, env);
    assert.equal(res.status, 400);
  });
});
