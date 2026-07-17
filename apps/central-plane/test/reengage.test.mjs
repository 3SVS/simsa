import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G1 복귀 이메일 (docs/simsa-gap-backlog-2026-07-18.md):
// 대상 = 3~14일 전 export && 이후 활동 없음 && email opt-in && 미넛지.
// 하드 규칙 = (user, project)당 평생 1통. 실패는 sent로 세지 않는다.

const { runReengageNudges } = await import("../dist/workspace/reengage.js");

const NOW = Date.parse("2026-07-18T00:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

/**
 * Fake D1 routing by SQL marker:
 *  - usage_events GROUP BY  → state.candidates
 *  - usage_events activity  → state.activity[user:project] (row or null)
 *  - reengage_nudges SELECT → state.nudged[user:project]
 *  - notification_settings  → state.settings[user]
 *  - INSERT reengage_nudges → recorded into state.inserted
 */
function fakeEnv(state) {
  return {
    RESEND_API_KEY: "rk",
    DASHBOARD_BASE_URL: "https://app.trysimsa.com",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            const key = () => `${args[0]}:${args[1]}`;
            return {
              all: async () => {
                if (sql.includes("GROUP BY")) return { results: state.candidates ?? [] };
                return { results: [] };
              },
              first: async () => {
                if (sql.includes("event_type !=")) return state.activity?.[key()] ?? null;
                if (sql.includes("FROM reengage_nudges")) return state.nudged?.[key()] ?? null;
                if (sql.includes("workspace_notification_settings")) {
                  return state.settings?.[args[0]] ?? null;
                }
                return null;
              },
              run: async () => {
                if (sql.includes("INSERT INTO reengage_nudges")) {
                  (state.inserted ??= []).push(key());
                }
                return {};
              },
            };
          },
        };
      },
    },
  };
}

const settingsRow = (email) => ({
  user_key: "u1", channel: "email", chat_id: email, enabled: 1,
  notify_policy: "problems_only", created_at: "x", updated_at: "x",
});

/** Resend stub: records payloads; fails when shouldFail. */
function resendStub(sentLog, shouldFail = false) {
  return async (url, init) => {
    sentLog.push(JSON.parse(init.body));
    return new Response(shouldFail ? "err" : "{}", { status: shouldFail ? 500 : 200 });
  };
}

describe("runReengageNudges — G1", () => {
  const cand = { user_key: "u1", project_id: "p1", last_export_at: daysAgo(5) };

  it("eligible + opted-in email → exactly one nudge, recorded", async () => {
    const sent = [];
    const state = { candidates: [cand], settings: { u1: settingsRow("a@b.co") } };
    const s = await runReengageNudges(fakeEnv(state), { fetchImpl: resendStub(sent), nowMs: NOW });
    assert.deepEqual(
      { scanned: s.scanned, eligible: s.eligible, sent: s.sent },
      { scanned: 1, eligible: 1, sent: 1 },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to[0], "a@b.co");
    assert.match(sent[0].text, /projects\/p1/);
    assert.deepEqual(state.inserted, ["u1:p1"]);
  });

  it("activity after export → not eligible (returned users are never nudged)", async () => {
    const sent = [];
    const state = {
      candidates: [cand],
      activity: { "u1:p1": { id: "evt" } },
      settings: { u1: settingsRow("a@b.co") },
    };
    const s = await runReengageNudges(fakeEnv(state), { fetchImpl: resendStub(sent), nowMs: NOW });
    assert.equal(s.eligible, 0);
    assert.equal(sent.length, 0);
  });

  it("already nudged → lifetime skip", async () => {
    const sent = [];
    const state = {
      candidates: [cand],
      nudged: { "u1:p1": { sent_at: daysAgo(1) } },
      settings: { u1: settingsRow("a@b.co") },
    };
    const s = await runReengageNudges(fakeEnv(state), { fetchImpl: resendStub(sent), nowMs: NOW });
    assert.equal(s.sent, 0);
    assert.equal(sent.length, 0);
  });

  it("no email settings → counted skipped_no_email, nothing sent, NOT marked nudged", async () => {
    const state = { candidates: [cand] };
    const s = await runReengageNudges(fakeEnv(state), { fetchImpl: resendStub([]), nowMs: NOW });
    assert.equal(s.eligible, 1);
    assert.equal(s.skipped_no_email, 1);
    assert.equal(s.sent, 0);
    assert.equal(state.inserted, undefined);
  });

  it("send failure → send_failures (not sent), NOT marked — natural retry next cron", async () => {
    const sent = [];
    const state = { candidates: [cand], settings: { u1: settingsRow("a@b.co") } };
    const s = await runReengageNudges(fakeEnv(state), { fetchImpl: resendStub(sent, true), nowMs: NOW });
    assert.equal(s.send_failures, 1);
    assert.equal(s.sent, 0);
    assert.equal(state.inserted, undefined);
  });
});
