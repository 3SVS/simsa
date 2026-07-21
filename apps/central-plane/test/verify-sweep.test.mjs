/**
 * verify-sweep.test.mjs — 기준평가 §3-1: find→fix→verify 원 닫기 (v1).
 *
 * Pins:
 *   - 웹훅: 머지된 fix/simsa-* PR → repair_merged 이벤트 기록 + 자체 ack
 *     (킬스위치 on이어도 — 기록은 협의체 스폰이 아니다) · 비수리 PR은 여전히
 *     킬스위치로 스킵 · 미머지 closed는 신호 아님
 *   - 스윕: 5분 그레이스 · 런-행 장부 dedupe(이벤트 이후 런 존재→스킵) ·
 *     활성 런 존중 · happy path에서 재검수 큐 삽입+디스패치 1회
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { runVerifySweep, REPAIR_MERGED_EVENT } from "../dist/workspace/verify-sweep.js";
const { createApp } = await import("../dist/router.js");

const SECRET = "whsec_test_1234";

function makeDb(state) {
  // state: { events: [...], runs: [...], writes: [] }
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) {
          bound = args;
          return {
            first: async () => {
              if (sql.includes("workspace_visual_checks") && sql.includes("WHERE id = ?")) {
                return state.runs.find((r) => r.id === bound[0]) ?? null;
              }
              if (sql.includes("status IN ('queued', 'running')")) {
                return state.runs.find((r) => r.project_id === bound[0] && (r.status === "queued" || r.status === "running")) ?? null;
              }
              return null;
            },
            all: async () => {
              if (sql.includes("workspace_usage_events")) {
                return { results: state.events.filter((e) => e.event_type === bound[0] && e.created_at > bound[1]) };
              }
              if (sql.includes("workspace_visual_checks") && sql.includes("project_id = ?")) {
                return { results: state.runs.filter((r) => r.project_id === bound[0]) };
              }
              return { results: [] };
            },
            run: async () => {
              state.writes.push({ sql, bound });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

const NOW = Date.parse("2026-07-22T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function runRow(over = {}) {
  return {
    id: "wvc_orig", project_id: "p1", user_key: "u1",
    target_url: "https://app.example.com", intent: "예약 완주",
    decision: "Needs Fix", works: 0, status: "done",
    report_json: "{}", agent_prompt: null, executor: "container",
    evidence_keys_json: "[]", error: null,
    created_at: iso(3600_000), updated_at: iso(3600_000),
    ...over,
  };
}

function eventRow(over = {}) {
  return {
    id: "evt1", user_key: "u1", project_id: "p1",
    event_type: REPAIR_MERGED_EVENT,
    metadata_json: JSON.stringify({ runId: "wvc_orig" }),
    created_at: iso(10 * 60_000), // 10분 전 — 그레이스 통과
    ...over,
  };
}

function makeEnv(state, inspector) {
  return {
    DB: makeDb(state),
    INTERNAL_CALLBACK_TOKEN: "tok",
    PUBLIC_BASE_URL: "https://base",
    ...(inspector ? { INSPECTOR: inspector } : {}),
  };
}

function acceptingInspector(calls) {
  return {
    idFromName: () => "id",
    get: () => ({
      fetch: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return { ok: true, text: async () => "" };
      },
    }),
  };
}

test("스윕 happy path: 그레이스 지난 신호 → 재검수 큐 삽입 + 디스패치 1회", async () => {
  const calls = [];
  const state = { events: [eventRow()], runs: [runRow()], writes: [] };
  const env = makeEnv(state, acceptingInspector(calls));
  const s = await runVerifySweep(env, { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetUrl, "https://app.example.com");
  assert.equal(calls[0].intent, "예약 완주");
  assert.ok(state.writes.some((w) => /INSERT INTO workspace_visual_checks/.test(w.sql)), "재검수 런 행 삽입");
});

test("그레이스: 머지 5분 이내 신호는 이번 스윕에서 건너뛴다", async () => {
  const state = { events: [eventRow({ created_at: iso(2 * 60_000) })], runs: [runRow()], writes: [] };
  const s = await runVerifySweep(makeEnv(state, acceptingInspector([])), { nowMs: NOW });
  assert.equal(s.skipped_grace, 1);
  assert.equal(s.dispatched, 0);
});

test("장부 dedupe: 이벤트 이후 생성된 런이 있으면 소비 완료로 스킵", async () => {
  const state = {
    events: [eventRow()],
    runs: [runRow(), runRow({ id: "wvc_verify", status: "done", created_at: iso(60_000) })],
    writes: [],
  };
  const s = await runVerifySweep(makeEnv(state, acceptingInspector([])), { nowMs: NOW });
  assert.equal(s.skipped_already_verified, 1);
  assert.equal(s.dispatched, 0);
});

test("활성 런 존중: queued/running 존재 시 이번 스윕은 대기", async () => {
  const state = {
    events: [eventRow()],
    runs: [runRow(), runRow({ id: "wvc_act", status: "running", created_at: iso(30 * 60_000) })],
    writes: [],
  };
  const s = await runVerifySweep(makeEnv(state, acceptingInspector([])), { nowMs: NOW });
  assert.equal(s.skipped_active_run, 1);
  assert.equal(s.dispatched, 0);
});

// ── 웹훅 신호 ───────────────────────────────────────────────────────────────

async function postWebhook(app, env, payload) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return app.request("/webhook/github", {
    method: "POST",
    headers: { "x-hub-signature-256": sig, "x-github-event": "pull_request", "x-github-delivery": "d", "content-type": "application/json" },
    body: raw,
  }, env);
}

test("웹훅: 머지된 fix/simsa-* PR → 이벤트 기록 + noted ack (킬스위치 on이어도)", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], writes: [] };
  const env = { ...makeEnv(state), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };
  const res = await postWebhook(app, env, {
    action: "closed",
    pull_request: { number: 9, merged: true, head: { ref: "fix/simsa-wvc_orig" }, title: "", body: "" },
    repository: { full_name: "acme/site" },
    installation: { id: 1 },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.noted, "repair_merged");
  const w = state.writes.find((x) => /workspace_usage_events/.test(x.sql));
  assert.ok(w && JSON.stringify(w.bound).includes(REPAIR_MERGED_EVENT));
  assert.ok(JSON.stringify(w.bound).includes("wvc_orig"));
});

test("웹훅: 비수리 PR closed는 여전히 킬스위치 스킵 · 미머지 close는 신호 아님", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], writes: [] };
  const env = { ...makeEnv(state), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };

  const r1 = await postWebhook(app, env, {
    action: "closed",
    pull_request: { number: 3, merged: true, head: { ref: "feature/x" }, title: "", body: "" },
    repository: { full_name: "acme/site" }, installation: { id: 1 },
  });
  assert.equal((await r1.json()).skipped, "legacy_auto_review_disabled");

  const r2 = await postWebhook(app, env, {
    action: "closed",
    pull_request: { number: 4, merged: false, head: { ref: "fix/simsa-wvc_orig" }, title: "", body: "" },
    repository: { full_name: "acme/site" }, installation: { id: 1 },
  });
  assert.equal((await r2.json()).skipped, "legacy_auto_review_disabled");
  assert.equal(state.writes.filter((x) => /usage_events/.test(x.sql)).length, 0);
});
