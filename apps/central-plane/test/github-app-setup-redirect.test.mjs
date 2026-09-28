/**
 * GitHub App 설치 직후 화면 (2026-09-28 Bae 라이브 신고).
 *
 * App의 Setup URL이 옛 Conclave CLI 로그인 콜백(/auth/github/callback)을 가리키고 있어, 설치를 마친
 * 유저가 "device flow · session closed / Missing ?code or ?state" 오류 화면을 봤다. 설치 자체는 성공이었다.
 * GitHub은 설치 뒤 Setup URL로 `?installation_id=…&setup_action=install|update`만 붙여 보낸다(code·state 없음).
 *
 * 고정하는 것:
 *  ① 옛 콜백 경로에 installation_id + setup_action이 오면 오류 대신 대시보드 연결 완료 화면으로 보낸다.
 *  ② 새 경로 GET /github/app/setup 도 같은 곳으로 보낸다(App 설정의 Setup URL을 이리로 바꿀 수 있게).
 *  ③ CLI 로그인(code+state)과 진짜 오류(아무 것도 없음)는 종전 그대로 — 과교정 방지.
 *  ④ 설치 id·동작은 숫자/허용값만 넘기고, 그 밖의 쿼리는 버린다(열린 리다이렉트 금지).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const DASH = "https://app.trysimsa.com";
const env = { WORKSPACE_GH_DASHBOARD_URL: DASH };

async function get(path) {
  const app = createApp({ fetch: async () => new Response("{}", { status: 500 }) });
  return app.fetch(new Request(`https://conclave-ai.seunghunbae.workers.dev${path}`, { redirect: "manual" }), env, {
    waitUntil() {},
    passThroughOnException() {},
  });
}

describe("GitHub App 설치 직후 리다이렉트", () => {
  it("① 옛 콜백 + installation_id + setup_action=install → 대시보드 /github/connected 로 302", async () => {
    const res = await get("/auth/github/callback?installation_id=91822733&setup_action=install");
    assert.equal(res.status, 302, `status ${res.status} (옛 코드는 400 'Missing ?code or ?state')`);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin, DASH);
    assert.equal(loc.pathname, "/github/connected");
    assert.equal(loc.searchParams.get("app"), "install");
    assert.equal(loc.searchParams.get("installation_id"), "91822733");
  });

  it("① setup_action=update(권한 변경 승인·저장소 추가)도 같은 곳으로", async () => {
    const res = await get("/auth/github/callback?installation_id=5&setup_action=update");
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.pathname, "/github/connected");
    assert.equal(loc.searchParams.get("app"), "update");
  });

  it("② 새 경로 GET /github/app/setup 도 대시보드로", async () => {
    const res = await get("/github/app/setup?installation_id=123&setup_action=install");
    assert.equal(res.status, 302, `status ${res.status} (옛 코드엔 이 경로가 없다)`);
    const loc = new URL(res.headers.get("location"));
    assert.equal(`${loc.origin}${loc.pathname}`, `${DASH}/github/connected`);
  });

  it("② 새 경로에 installation_id가 없거나 숫자가 아니면 id 없이 연결 화면으로(오류 화면 아님)", async () => {
    for (const q of ["", "?installation_id=abc&setup_action=install", "?setup_action=request"]) {
      const res = await get(`/github/app/setup${q}`);
      assert.equal(res.status, 302, q);
      const loc = new URL(res.headers.get("location"));
      assert.equal(loc.pathname, "/github/connected", q);
      assert.equal(loc.searchParams.get("installation_id"), null, q);
    }
  });

  it("④ 허용되지 않은 setup_action·추가 쿼리는 버린다(열린 리다이렉트·주입 금지)", async () => {
    const res = await get("/github/app/setup?installation_id=7&setup_action=javascript:alert(1)&next=https://evil.example");
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin, DASH);
    assert.equal(loc.searchParams.get("app"), null);
    assert.equal(loc.searchParams.get("next"), null);
  });

  it("③ 행동 보존 가드: 아무 쿼리도 없으면 종전 오류 화면(400) 그대로", async () => {
    const res = await get("/auth/github/callback");
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Missing \?code or \?state/);
  });

  it("③ 행동 보존 가드: code+state가 있으면 CLI 로그인 경로(설정 없으면 503) — 설치 리다이렉트로 새지 않는다", async () => {
    const res = await get("/auth/github/callback?code=abc&state=WXYZ-1234&installation_id=9&setup_action=install");
    assert.notEqual(res.status, 302);
    assert.equal(res.status, 503); // GH_APP_CLIENT_ID/SECRET 미설정 테스트 env
  });
});
