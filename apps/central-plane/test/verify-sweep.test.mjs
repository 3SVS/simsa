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
  // state: { events: [...], runs: [...], writes: [], jobs?: [...] }
  state.jobs = state.jobs ?? [];
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
              if (sql.includes("FROM workspace_repair_jobs") && sql.includes("WHERE visual_check_id = ?")) {
                return [...state.jobs]
                  .filter((j) => j.visual_check_id === bound[0])
                  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
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
              // Round trip: a recorded signal becomes a row the sweep can read.
              if (sql.includes("INSERT INTO workspace_usage_events")) {
                const [id, user_key, project_id, event_type, metadata_json, created_at] = bound;
                state.events.push({ id, user_key, project_id, event_type, metadata_json, created_at });
              }
              if (sql.includes("workspace_repair_jobs") && sql.includes("SET verify_check_id")) {
                const [verifyId, id] = bound;
                const job = state.jobs.find((j) => j.id === id);
                if (job) job.verify_check_id = verifyId;
              }
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

/** The repair job Simsa created for a run — the only thing that makes a fix/simsa-* merge OURS. */
function jobRow(over = {}) {
  return {
    id: "wrj_orig", project_id: "p1", user_key: "u1", visual_check_id: "wvc_orig",
    repo_full_name: "acme/site", status: "done", branch_name: "fix/simsa-wvc_orig",
    pr_url: "https://github.com/acme/site/pull/9", pr_number: 9, env_cause: 0,
    mode: "auto_fix", changed_files: 1, error: null, region: null,
    verify_check_id: null, resolved: null,
    created_at: iso(2 * 3600_000), updated_at: iso(2 * 3600_000),
    ...over,
  };
}

/** A merged-PR webhook as GitHub sends it for a same-repo branch. */
function mergedPr({ number = 9, ref = "fix/simsa-wvc_orig", repo = "acme/site", headRepo = repo } = {}) {
  return {
    action: "closed",
    pull_request: {
      number, merged: true, title: "", body: "",
      head: { ref, repo: headRepo === null ? null : { full_name: headRepo } },
    },
    repository: { full_name: repo },
    installation: { id: 1 },
  };
}

test("웹훅: 머지된 fix/simsa-* PR → 이벤트 기록 + noted ack (킬스위치 on이어도)", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], jobs: [jobRow()], writes: [] };
  const env = { ...makeEnv(state), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };
  const res = await postWebhook(app, env, mergedPr());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.noted, "repair_merged");
  const w = state.writes.find((x) => /workspace_usage_events/.test(x.sql));
  assert.ok(w && JSON.stringify(w.bound).includes(REPAIR_MERGED_EVENT));
  assert.ok(JSON.stringify(w.bound).includes("wvc_orig"));
});

// ── PR #561 검증 P1: 신호는 "이 런의 수리"여야 한다 (교차 테넌트) ─────────────────
//
// run id는 공개 저장소 수리 PR의 브랜치 이름(fix/simsa-<runId>)으로 이미 보인다. 전에는 웹훅이
// headRef 접두사와 런 존재만 봤기 때문에, 누구든 자기 App 설치 저장소에서 그 이름의 브랜치를
// 머지하면 남의 런에 재검수 신호가 기록됐다 → 스윕이 피해자 프로젝트에 런을 만들고 컨테이너를
// 띄우고, 피해자 수리 잡의 verify_check_id(= S2 $29 청구 조건인 resolved의 근거)를 덮었다.

test("웹훅 [P1 교차 테넌트]: 다른 저장소에서 머지된 fix/simsa-<남의 runId> → 신호 0 · 스윕 런 0 · 컨테이너 0 · verify_check_id 불변", async () => {
  const app = createApp();
  const victimRun = runRow({ id: "wvc_victim01", project_id: "p_victim", user_key: "uk_victim", target_url: "https://victim.example.app/" });
  const victimJob = jobRow({
    id: "wrj_victim", project_id: "p_victim", user_key: "uk_victim", visual_check_id: "wvc_victim01",
    repo_full_name: "victim-org/victim-app", branch_name: "fix/simsa-wvc_victim01", verify_check_id: null,
  });
  const state = { events: [], runs: [victimRun], jobs: [victimJob], writes: [] };
  const calls = [];
  const env = { ...makeEnv(state, acceptingInspector(calls)), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };

  const res = await postWebhook(app, env, mergedPr({ ref: "fix/simsa-wvc_victim01", repo: "attacker/unrelated-repo" }));
  assert.equal(res.status, 200, "still acknowledged (GitHub must not retry)");
  const body = await res.json();
  // Then the cron that consumes signals runs (past the 5-minute grace).
  const s = await runVerifySweep(env, { nowMs: Date.now() + 10 * 60_000 });

  // One outcome object, so a failure shows the whole chain at once.
  const outcome = {
    noted: body.noted ?? null,
    signalRows: state.writes.filter((x) => /workspace_usage_events/.test(x.sql)).length,
    sweepDispatched: s.dispatched,
    containerCalls: calls.length,
    runsCreatedInVictimProject: state.writes.filter((x) => /INSERT INTO workspace_visual_checks/.test(x.sql)).length,
    victimJobVerifyCheckId: state.jobs[0].verify_check_id,
  };
  assert.deepEqual(outcome, {
    noted: null,
    signalRows: 0,
    sweepDispatched: 0,
    containerCalls: 0,
    runsCreatedInVictimProject: 0,
    victimJobVerifyCheckId: null,
  });
});

test("웹훅 [P1]: 같은 base 저장소라도 포크 브랜치(head.repo ≠ base)면 신호가 아니다 — 컨테이너는 같은 저장소에만 민다", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], jobs: [jobRow()], writes: [] };
  const env = { ...makeEnv(state), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };
  const res = await postWebhook(app, env, mergedPr({ repo: "acme/site", headRepo: "someone/site-fork" }));
  assert.notEqual((await res.json()).noted, "repair_merged");
  assert.equal(state.writes.filter((x) => /workspace_usage_events/.test(x.sql)).length, 0);
});

test("웹훅 [P1]: 런은 있는데 Simsa 수리 잡이 없으면(= 우리가 만든 브랜치가 아님) 신호가 아니다", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], jobs: [], writes: [] };
  const env = { ...makeEnv(state), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };
  const res = await postWebhook(app, env, mergedPr());
  assert.notEqual((await res.json()).noted, "repair_merged");
  assert.equal(state.writes.filter((x) => /workspace_usage_events/.test(x.sql)).length, 0);
});

test("웹훅: 이 런의 수리 저장소·브랜치와 맞으면(대소문자 무시) 기록 + metadata.repo · 스윕이 재검수하고 verify_check_id를 잇는다", async () => {
  const app = createApp();
  const state = { events: [], runs: [runRow()], jobs: [jobRow({ repo_full_name: "acme/site" })], writes: [] };
  const calls = [];
  const env = { ...makeEnv(state, acceptingInspector(calls)), GH_APP_WEBHOOK_SECRET: SECRET, LEGACY_AUTO_REVIEW: "off" };
  const res = await postWebhook(app, env, mergedPr({ repo: "Acme/Site" }));
  assert.equal((await res.json()).noted, "repair_merged");
  assert.equal(state.events.length, 1);
  const meta = JSON.parse(state.events[0].metadata_json);
  assert.deepEqual(meta, { runId: "wvc_orig", prNumber: 9, repo: "acme/site" }, "the signal records which repair it matched");

  const s = await runVerifySweep(env, { nowMs: Date.now() + 10 * 60_000 });
  assert.equal(s.dispatched, 1);
  assert.equal(calls.length, 1);
  assert.ok(state.jobs[0].verify_check_id, "the repair job is linked to the re-inspection");
});

test("repairMergeSignalMatches(순수): 저장소·브랜치·head 저장소·런 소유가 모두 맞을 때만 true", async () => {
  const { repairMergeSignalMatches } = await import("../dist/workspace/verify-sweep.js");
  assert.equal(typeof repairMergeSignalMatches, "function");
  const run = { id: "wvc_1", projectId: "p1", userKey: "u1" };
  const job = { visualCheckId: "wvc_1", projectId: "p1", userKey: "u1", repoFullName: "acme/site", branchName: "fix/simsa-wvc_1" };
  const ok = { runId: "wvc_1", run, job, headRef: "fix/simsa-wvc_1", baseRepoFullName: "ACME/site", headRepoFullName: "acme/SITE" };
  assert.equal(repairMergeSignalMatches(ok), true);
  assert.equal(repairMergeSignalMatches({ ...ok, baseRepoFullName: "attacker/unrelated-repo", headRepoFullName: "attacker/unrelated-repo" }), false, "other repo");
  assert.equal(repairMergeSignalMatches({ ...ok, headRepoFullName: "someone/fork" }), false, "fork head");
  assert.equal(repairMergeSignalMatches({ ...ok, headRepoFullName: "" }), false, "head repo unknown (deleted fork) → not ours");
  assert.equal(repairMergeSignalMatches({ ...ok, baseRepoFullName: "" }), false);
  assert.equal(repairMergeSignalMatches({ ...ok, headRef: "fix/simsa-wvc_1-evil" }), false, "branch must be exactly the job's");
  assert.equal(repairMergeSignalMatches({ ...ok, job: { ...job, visualCheckId: "wvc_2" } }), false, "job of another run");
  assert.equal(repairMergeSignalMatches({ ...ok, job: { ...job, userKey: "u2" } }), false, "job of another user");
  assert.equal(repairMergeSignalMatches({ ...ok, job: { ...job, projectId: "p2" } }), false, "job of another project");
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
