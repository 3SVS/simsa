/**
 * workspace-github-status-install.test.mjs — AF-7 (설계 D-9).
 *
 * 계정이 여러 개인 사용자에게 OAuth는 함정이다: 기존 승인을 조용히 재사용하므로
 * 계정을 바꾸려면 연결 해제 → github.com 로그아웃 → 재연결을 매번 밟아야 한다.
 * App 설치는 설치 화면에서 계정·조직·저장소를 직접 고르게 해준다.
 *
 * 그래서 설치 경로를 **연결 화면에서 처음부터** 보여준다 — 종전처럼 비공개 저장소
 * 조회가 실패한 뒤에야 나타나는 구제책이 아니라, 동등한 선택지로.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const INSTALL = "https://github.com/apps/x/installations/new";
const ORIGIN = "https://app.trysimsa.com";

async function status(env, query = "") {
  const res = await createApp().request(
    `/workspace/github/status${query}`,
    { headers: { origin: ORIGIN } },
    env,
  );
  return { status: res.status, body: await res.json() };
}

const emptyDb = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) };

describe("★설치 경로는 연결 전에도 온다 (AF-7)", () => {
  it("userKey가 없어도 installUrl을 준다 — 화면이 처음부터 두 갈래를 보여줄 수 있게", async () => {
    const { body } = await status({ DB: emptyDb, GH_APP_INSTALL_URL: INSTALL });
    assert.equal(body.connected, false);
    assert.equal(body.installUrl, INSTALL);
  });

  it("연결되지 않은 사용자에게도 준다", async () => {
    const { body } = await status({ DB: emptyDb, GH_APP_INSTALL_URL: INSTALL }, "?userKey=uk_x");
    assert.equal(body.connected, false);
    assert.equal(body.installUrl, INSTALL);
  });

  it("★설정이 없으면 죽은 버튼을 만들지 않는다 — 필드 자체를 빼서 화면이 비활성 처리", async () => {
    const { body } = await status({ DB: emptyDb });
    assert.equal(body.installUrl, undefined);
  });

  it("빈 문자열도 없는 것으로 다룬다", async () => {
    const { body } = await status({ DB: emptyDb, GH_APP_INSTALL_URL: "" });
    assert.equal(body.installUrl, undefined);
  });

  it("토큰·시크릿이 응답에 새지 않는다", async () => {
    const { body } = await status(
      { DB: emptyDb, GH_APP_INSTALL_URL: INSTALL, CONCLAVE_TOKEN_KEK: "kek-secret", WORKSPACE_GH_CLIENT_SECRET: "cs-secret" },
      "?userKey=uk_x",
    );
    const text = JSON.stringify(body);
    for (const secret of ["kek-secret", "cs-secret"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });
});
