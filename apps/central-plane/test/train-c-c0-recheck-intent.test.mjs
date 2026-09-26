/**
 * train-c-c0-recheck-intent.test.mjs — Train C · C0 재검수 intent 유지 (재정렬 §1 끊김: "다시 확인"이
 * 원 런의 의도를 버리고 기본 문장으로 돌아갔다 → D-1 amend "확인된 문제 + 수정 후 재확인 결과").
 *
 * 고정하는 계약(계약 1):
 *   ① sourceCheckId → 원 런의 intent·targetUrl 상속(body에 없을 때) · 남의 런/다른 프로젝트 런 → 400 invalid_source_check
 *      새 런 행에 source_check_id 저장 + 응답 check.sourceCheckId
 *   ② intent 없음 + sourceCheckId 없음 → 프로젝트의 확정 의도(productSpec.oneLine)가 기본 intent, 그것도 없으면 종전 기본 문장
 *   ③ body.intent가 있으면 상속보다 우선(사용자가 고쳐 쓴 의도가 이긴다)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeD1, projectRow, websiteSource, checkRow, makeDoStub, send } from "./_train-c-fake-d1.mjs";

const { createApp } = await import("../dist/router.js");
const { DEFAULT_INSPECTION_INTENT } = await import("../dist/routes/workspace-visual-check-runs.js");

const USER = "uk_owner";
const OTHER = "uk_intruder";
const PROJECT = "proj_c0";
const OTHER_PROJECT = "proj_c0_other";
const RUN_PATH = `/workspace/projects/${PROJECT}/visual-checks/run`;

function makeEnv({ checks = [], productSpec = {}, inspector } = {}) {
  const projects = new Map([
    [PROJECT, projectRow(PROJECT, USER, { product_spec_json: JSON.stringify(productSpec) })],
    [OTHER_PROJECT, projectRow(OTHER_PROJECT, OTHER)],
  ]);
  const env = {
    ENVIRONMENT: "test",
    INTERNAL_CALLBACK_TOKEN: "tok",
    DB: makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER)], checks }),
  };
  if (inspector) env.INSPECTOR = inspector;
  return env;
}

test("① sourceCheckId: inherits the origin run's intent AND targetUrl; stores source_check_id; echoes check.sourceCheckId", async () => {
  const origin = checkRow({ id: "wvc_orig", project_id: PROJECT, user_key: USER, intent: "골퍼가 코스 상태를 확인할 수 있어야 한다", target_url: "https://golf-now.example.app/courses" });
  const recorder = { names: [], calls: [] };
  const env = makeEnv({ checks: [origin], inspector: makeDoStub(recorder) });
  const r = await send(createApp(), env, RUN_PATH, { body: { userKey: USER, locale: "ko", sourceCheckId: "wvc_orig" } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.check.intent, "골퍼가 코스 상태를 확인할 수 있어야 한다");
  assert.equal(r.json.check.targetUrl, "https://golf-now.example.app/courses");
  assert.equal(r.json.check.sourceCheckId, "wvc_orig");
  const row = env.DB._checks.find((c) => c.id === r.json.check.id);
  assert.equal(row.source_check_id, "wvc_orig");
  assert.equal(recorder.calls[0].body.intent, "골퍼가 코스 상태를 확인할 수 있어야 한다");
  assert.equal(recorder.calls[0].body.targetUrl, "https://golf-now.example.app/courses");
});

test("① sourceCheckId of another user's run / another project's run / unknown → 400 invalid_source_check", async () => {
  const foreign = checkRow({ id: "wvc_foreign", project_id: OTHER_PROJECT, user_key: OTHER });
  const sameProjectOtherUser = checkRow({ id: "wvc_stolen", project_id: PROJECT, user_key: OTHER });
  const env = makeEnv({ checks: [foreign, sameProjectOtherUser] });
  const app = createApp();
  for (const sourceCheckId of ["wvc_foreign", "wvc_stolen", "wvc_nope", "", 42]) {
    const r = await send(app, env, RUN_PATH, { body: { userKey: USER, sourceCheckId } });
    assert.equal(r.status, 400, `sourceCheckId=${JSON.stringify(sourceCheckId)}`);
    assert.equal(r.json.error, "invalid_source_check");
  }
  assert.equal(env.DB._checks.length, 2, "no run row may be created for a rejected source");
});

test("② no intent + no sourceCheckId → the project's confirmed intent (productSpec.oneLine) is the default", async () => {
  const env = makeEnv({ productSpec: { productName: "댕댕 산책", oneLine: "  산책을 기록하면 주간 통계가 보이는 웹앱  " } });
  const r = await send(createApp(), env, RUN_PATH, { body: { userKey: USER } });
  assert.equal(r.status, 202);
  assert.equal(r.json.check.intent, "산책을 기록하면 주간 통계가 보이는 웹앱");
  assert.equal(env.DB._checks[0].source_check_id, null);
});

test("② confirmed intent absent/blank → the pre-existing generic default is kept", async () => {
  for (const productSpec of [{}, { oneLine: "" }, { oneLine: "   " }, { oneLine: 7 }]) {
    const env = makeEnv({ productSpec });
    const r = await send(createApp(), env, RUN_PATH, { body: { userKey: USER } });
    assert.equal(r.status, 202);
    assert.equal(r.json.check.intent, DEFAULT_INSPECTION_INTENT);
  }
});

test("③ explicit body.intent wins over the inherited one; explicit targetUrl still must be a registered origin", async () => {
  const origin = checkRow({ id: "wvc_orig", project_id: PROJECT, user_key: USER });
  const env = makeEnv({ checks: [origin] });
  const app = createApp();
  const r = await send(app, env, RUN_PATH, { body: { userKey: USER, sourceCheckId: "wvc_orig", intent: "고친 뒤: 코스 목록이 실제로 뜬다" } });
  assert.equal(r.status, 202);
  assert.equal(r.json.check.intent, "고친 뒤: 코스 목록이 실제로 뜬다");
  assert.equal(r.json.check.sourceCheckId, "wvc_orig");

  env.DB._checks.at(-1).status = "done"; // release the one-active-run guard
  const bad = await send(app, env, RUN_PATH, { body: { userKey: USER, sourceCheckId: "wvc_orig", targetUrl: "https://evil.example.com/" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "target_url_not_registered");
});
