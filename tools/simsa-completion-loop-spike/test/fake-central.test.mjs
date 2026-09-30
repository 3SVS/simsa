import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFakeCentral, devSpecFixture, SCENARIOS, LIVE_CENTRAL_ORIGIN, FAKE_CENTRAL_ORIGIN } from "../lib/fake-central.mjs";

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

  it("Rule 6: 지시서 픽스처는 한국어 리얼 기획(초보자 4줄이 그려지는 모양)", () => {
    const d = devSpecFixture("ko");
    assert.equal(d.brief.productName, "(주)트루픽셀 예약 앱");
    assert.ok(d.features.length > 0 && d.acceptance.length > 0);
    assert.ok(d.features.some((x) => x.priority === "must"));
  });
});
