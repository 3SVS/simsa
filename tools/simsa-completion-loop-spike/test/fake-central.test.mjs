import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as fakeMod from "../lib/fake-central.mjs";

const { createFakeCentral, devSpecFixture, SCENARIOS, LIVE_CENTRAL_ORIGIN, FAKE_CENTRAL_ORIGIN } = fakeMod;
// 네임스페이스로 받는다 — 옛 모듈에 없는 export 때문에 파일이 통째로 죽지 않고 테스트마다 제 이유로 실패하게(#578 결함 7).
const builderPackFixture = (...a) => {
  assert.equal(typeof fakeMod.builderPackFixture, "function", "builderPackFixture");
  return fakeMod.builderPackFixture(...a);
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const P = "wsp_tp7x9k2m1q";
const url = (rest) => `${FAKE_CENTRAL_ORIGIN}/workspace/projects/${P}${rest}`;

describe("fake-central (journey-audit --local, B-8 J6)", () => {
  it("가로채는 주소에 라이브 central이 들어 있다 — 가로채기를 놓쳐 라이브에 닿는 일이 없게", () => {
    const f = createFakeCentral({ projectId: P, scenario: "not_implemented" });
    assert.ok(f.origins.includes(LIVE_CENTRAL_ORIGIN));
    assert.ok(f.origins.includes(FAKE_CENTRAL_ORIGIN));
    // 대시보드 API 클라이언트의 기본 주소와 같아야 가로챈다.
    const api = readFileSync(path.join(REPO, "apps/dashboard/src/lib/build-job-api.ts"), "utf8");
    assert.ok(api.includes(LIVE_CENTRAL_ORIGIN));
  });

  it("POST build → 202 잡, 진행 중이면 409 build_already_active(activeJobId)", () => {
    const f = createFakeCentral({ projectId: P, scenario: "not_implemented" });
    const a = f.handle("POST", url("/build"));
    assert.equal(a.status, 202);
    assert.equal(a.json.job.status, "queued");
    const b = f.handle("POST", url("/build"));
    assert.equal(b.status, 409);
    assert.equal(b.json.error, "build_already_active");
    assert.equal(b.json.activeJobId, a.json.job.id);
  });

  it("상세 조회마다 한 칸 — not_implemented는 실제 서버 문장으로 끝난다(failedStage unknown)", () => {
    const f = createFakeCentral({ projectId: P, scenario: "not_implemented" });
    const id = f.handle("POST", url("/build")).json.job.id;
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(f.handle("GET", url(`/build-jobs/${id}`)).json.job.status);
    assert.deepEqual(seen, ["queued", "failed", "failed", "failed"]);
    const job = f.handle("GET", url(`/build-jobs/${id}`)).json.job;
    assert.equal(job.error, "builder_stage_not_implemented:build");
    const runner = readFileSync(path.join(REPO, "apps/central-plane/builder-container/builder-run.mjs"), "utf8");
    assert.match(runner, /builder_stage_not_implemented:/);
  });

  it("목록 조회는 나아가지 않는다(새로고침 복원이 같은 상태)", () => {
    const f = createFakeCentral({ projectId: P, scenario: "done" });
    f.handle("POST", url("/build"));
    const s1 = f.handle("GET", url("/build-jobs")).json.jobs[0].status;
    const s2 = f.handle("GET", url("/build-jobs")).json.jobs[0].status;
    assert.equal(s1, s2);
  });

  it("done 시나리오는 서버 상태 순서대로 끝까지 가고 https 주소를 준다", () => {
    const f = createFakeCentral({ projectId: P, scenario: "done" });
    const id = f.handle("POST", url("/build")).json.job.id;
    let last;
    for (let i = 0; i < SCENARIOS.done.length + 2; i++) last = f.handle("GET", url(`/build-jobs/${id}`)).json.job;
    assert.equal(last.status, "done");
    assert.match(last.deployedUrl, /^https:\/\/app-7x9k2m1q\.simsa\.page$/);
    const jobDb = readFileSync(path.join(REPO, "apps/central-plane/src/workspace/build-job-db.ts"), "utf8");
    for (const s of SCENARIOS.done) assert.ok(jobDb.includes(`"${s.status}"`), s.status);
  });

  it("모르는 경로는 404로 답하고 unhandled에 적는다(조용히 삼키지 않는다)", () => {
    const f = createFakeCentral({ projectId: P, scenario: "done" });
    assert.equal(f.handle("GET", `${FAKE_CENTRAL_ORIGIN}/workspace/credits?userKey=x`).status, 404);
    assert.deepEqual(f.unhandled, ["GET /workspace/credits"]);
    assert.equal(f.handle("OPTIONS", url("/build")).status, 204);
  });

  it("★#578 결함 3: retryConflict(수정 전 실서버) — 멈춘 잡 뒤 두 번째 POST /build는 502 hosting_d1_failed, 잡을 만들지 않는다", () => {
    const f = createFakeCentral({ projectId: P, scenario: "not_implemented", retryConflict: true });
    const id = f.handle("POST", url("/build")).json.job.id;
    for (let i = 0; i < 3; i++) f.handle("GET", url(`/build-jobs/${id}`));
    const retry = f.handle("POST", url("/build"));
    assert.equal(retry.status, 502);
    assert.equal(retry.json.error, "hosting_d1_failed");
    assert.equal(f.jobs.length, 1);
    // 실서버 라우트가 실제로 이 코드를 502로 낸다(가짜가 지어낸 코드가 아니다).
    const route = readFileSync(path.join(REPO, "apps/central-plane/src/routes/workspace-build-jobs.ts"), "utf8");
    assert.match(route, /error: "hosting_d1_failed"[^\n]*502/);
  });

  it("★#578 결함 3: 기본(수정 뒤 서버) — 다시 시도는 202 새 잡(서버가 전 잡의 D1을 다시 쓴다)", () => {
    const f = createFakeCentral({ projectId: P, scenario: "not_implemented" });
    const id = f.handle("POST", url("/build")).json.job.id;
    for (let i = 0; i < 3; i++) f.handle("GET", url(`/build-jobs/${id}`));
    const retry = f.handle("POST", url("/build"));
    assert.equal(retry.status, 202);
    assert.notEqual(retry.json.job.id, id);
    const route = readFileSync(path.join(REPO, "apps/central-plane/src/routes/workspace-build-jobs.ts"), "utf8");
    assert.match(route, /d1Reused/, "the real route reuses the prior job's D1 — the fake's default mirrors that");
  });

  it("★#578 결함 2: GET /workspace/build-availability — 실서버와 같은 모양(open 기본 true, false면 not_open)", () => {
    assert.deepEqual(createFakeCentral({ projectId: P, scenario: "done" }).handle("GET", `${FAKE_CENTRAL_ORIGIN}/workspace/build-availability`).json, { ok: true, buildEnabled: true, reason: "open" });
    assert.deepEqual(createFakeCentral({ projectId: P, scenario: "done", open: false }).handle("GET", `${FAKE_CENTRAL_ORIGIN}/workspace/build-availability`).json, { ok: true, buildEnabled: false, reason: "not_open" });
    const route = readFileSync(path.join(REPO, "apps/central-plane/src/routes/workspace-build-jobs.ts"), "utf8");
    assert.match(route, /app\.get\("\/workspace\/build-availability"/);
  });

  it("★#578 결함 4: POST /workspace/export-builder-pack — 팩 파일 묶음(dev-spec/ + 개발 도구 프롬프트·비밀 파일 섞임)", () => {
    const r = createFakeCentral({ projectId: P, scenario: "done" }).handle("POST", `${FAKE_CENTRAL_ORIGIN}/workspace/export-builder-pack`);
    assert.equal(r.status, 200);
    const paths = r.json.bundle.files.map((x) => x.path);
    assert.ok(paths.includes("simsa-build-pack/dev-spec/README.md"));
    assert.ok(paths.some((p) => !p.includes("/dev-spec/")));
    assert.match(builderPackFixture("ko")[2].content, /\(주\)트루픽셀 예약 앱/);
  });

  it("Rule 6: 지시서 픽스처는 한국어 리얼 기획(초보자 4줄이 그려지는 모양)", () => {
    const d = devSpecFixture("ko");
    assert.equal(d.brief.productName, "(주)트루픽셀 예약 앱");
    assert.ok(d.features.length > 0 && d.acceptance.length > 0);
    assert.ok(d.features.some((x) => x.priority === "must"));
  });
});
