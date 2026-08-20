/**
 * verify-sweep-locale.test.mjs — 0065: 재검수 locale 영속.
 *
 * v1 정직 한계("재검수 locale은 ko 고정")의 해소를 고정한다:
 *   - 원 런 행에 locale=en → 자동 재검수 디스패치도 en, 새 런 행에도 en 저장
 *   - locale 미기록 레거시 행 → ko 폴백 (기존 동작 불변)
 * 이 테스트는 0065 이전 코드(무조건 ko 디스패치)로 되돌리면 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerifySweep, REPAIR_MERGED_EVENT } from "../dist/workspace/verify-sweep.js";

function makeDb(state) {
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

const NOW = Date.parse("2026-08-20T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function runRow(over = {}) {
  return {
    id: "wvc_orig", project_id: "p1", user_key: "u1",
    target_url: "https://app.example.com", intent: "checkout flow",
    decision: "Needs Fix", works: 0, status: "done",
    report_json: "{}", agent_prompt: null, executor: "container",
    evidence_keys_json: "[]", locale: null, error: null,
    created_at: iso(3600_000), updated_at: iso(3600_000),
    ...over,
  };
}

function eventRow(over = {}) {
  return {
    id: "evt1", user_key: "u1", project_id: "p1",
    event_type: REPAIR_MERGED_EVENT,
    metadata_json: JSON.stringify({ runId: "wvc_orig" }),
    created_at: iso(10 * 60_000),
    ...over,
  };
}

function makeEnv(state, calls) {
  return {
    DB: makeDb(state),
    INTERNAL_CALLBACK_TOKEN: "tok",
    PUBLIC_BASE_URL: "https://base",
    INSPECTOR: {
      idFromName: () => "id",
      get: () => ({
        fetch: async (_url, init) => {
          calls.push(JSON.parse(init.body));
          return { ok: true, text: async () => "" };
        },
      }),
    },
  };
}

test("원 런 locale=en → 재검수 디스패치 en + 새 런 행에 en 저장", async () => {
  const calls = [];
  const state = { events: [eventRow()], runs: [runRow({ locale: "en" })], writes: [] };
  const s = await runVerifySweep(makeEnv(state, calls), { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal(calls[0].locale, "en", "재검수는 원 런의 언어를 따라야 한다");
  const ins = state.writes.find((w) => /INSERT INTO workspace_visual_checks/.test(w.sql));
  assert.ok(ins, "재검수 런 행 삽입");
  assert.ok(ins.bound.includes("en"), "새 런 행에 locale=en 저장");
});

test("레거시 행(locale 미기록) → ko 폴백 (기존 동작 불변)", async () => {
  const calls = [];
  const state = { events: [eventRow()], runs: [runRow({ locale: null })], writes: [] };
  const s = await runVerifySweep(makeEnv(state, calls), { nowMs: NOW });
  assert.equal(s.dispatched, 1);
  assert.equal(calls[0].locale, "ko");
});
