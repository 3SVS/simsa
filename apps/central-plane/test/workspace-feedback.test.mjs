/**
 * workspace-feedback route — in-app feedback intake.
 * Covers validation, D1 insert with auto-context, and no-admin-config path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

function makeMockDb() {
  const state = { feedback: [] };
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async run() {
          if (/INSERT INTO workspace_feedback/.test(sql)) {
            const [id, user_key, kind, message, route, project_id, user_agent, created_at] = bound;
            state.feedback.push({ id, user_key, kind, message, route, project_id, user_agent, created_at });
          }
          return { success: true };
        },
        async first() { return null; },
        async all() { return { results: [] }; },
      };
    },
  };
}

function makeEnv(over = {}) {
  return { DB: makeMockDb(), ENVIRONMENT: "test", ...over };
}

function req(body, headers = {}) {
  return new Request("http://localhost/workspace/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /workspace/feedback", () => {
  it("stores feedback with auto-attached context", async () => {
    const env = makeEnv();
    const app = createApp();
    const res = await app.fetch(
      req(
        { userKey: "uk_1", kind: "bug", message: "확인 실행이 안 돼요", route: "/projects/p1/github", projectId: "p1" },
        { "user-agent": "Mozilla/5.0 QA" },
      ),
      env,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const row = env.DB.state.feedback[0];
    assert.equal(row.kind, "bug");
    assert.equal(row.message, "확인 실행이 안 돼요");
    assert.equal(row.route, "/projects/p1/github");
    assert.equal(row.project_id, "p1");
    assert.equal(row.user_agent, "Mozilla/5.0 QA");
    assert.ok(row.id.startsWith("fb_"));
  });

  it("rejects missing userKey / bad kind / empty message", async () => {
    const app = createApp();
    const env = makeEnv();
    assert.equal((await app.fetch(req({ kind: "bug", message: "x" }), env)).status, 400);
    assert.equal((await app.fetch(req({ userKey: "u", kind: "spam", message: "x" }), env)).status, 400);
    assert.equal((await app.fetch(req({ userKey: "u", kind: "bug", message: "   " }), env)).status, 400);
  });

  it("works with no admin notify config (D1-only)", async () => {
    const env = makeEnv(); // no TELEGRAM/RESEND/admin targets
    const app = createApp();
    const res = await app.fetch(req({ userKey: "u", kind: "suggestion", message: "다크모드 주세요" }), env);
    assert.equal(res.status, 200);
    assert.equal(env.DB.state.feedback.length, 1);
  });
});
