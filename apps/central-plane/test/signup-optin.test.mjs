/**
 * signup-optin.test.mjs — 로그인 뒤 검수는 **동의 없이 켜지지 않는다** (2026-08-26).
 *
 * 이건 기능 테스트가 아니라 **안전장치 테스트**다. 남의 앱에 일회용 계정을 만드는
 * 일이므로, UI가 체크박스를 빠뜨리거나 누가 기본값을 뒤집어도 **서버에서 막혀야** 한다.
 *
 * 고정하는 계약:
 *   ① 요청에 명시가 없으면 계정을 만들지 않는다
 *   ② 메일 받을 곳이 없으면 동의가 있어도 만들지 않는다
 *      (확인 메일을 못 받으면 가입이 중간에서 멈춰 **그 앱에 쓸모없는 계정만 남는다**)
 *   ③ 켜졌을 때만 컨테이너에 설정이 실린다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { dispatchInspection } = await import("../dist/routes/workspace-visual-check-runs.js");

function envWith(overrides = {}) {
  const sent = [];
  const env = {
    INTERNAL_CALLBACK_TOKEN: "tok",
    PROBE_MAIL_DOMAIN: "probe.trysimsa.com",
    INSPECTOR: {
      idFromName: () => "id",
      get: () => ({
        fetch: async (_url, init) => {
          sent.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ ok: true }), { status: 202 });
        },
      }),
    },
    ...overrides,
  };
  return { env, sent };
}

const ARGS = {
  runId: "wvc_1",
  projectId: "p1",
  userKey: "uk",
  targetUrl: "https://app.example.com",
  intent: "로그인해서 목록이 보여야 한다",
  locale: "ko",
  publicBaseUrl: "https://cp.example.com",
};

describe("① 동의가 없으면 계정을 만들지 않는다", () => {
  it("★withSignup을 안 보내면 signup 설정이 실리지 않는다", async () => {
    const { env, sent } = envWith();
    await dispatchInspection(env, ARGS);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].signup, undefined, "기본값은 반드시 꺼짐이다");
  });

  it("withSignup: false도 꺼짐", async () => {
    const { env, sent } = envWith();
    await dispatchInspection(env, { ...ARGS, withSignup: false });
    assert.equal(sent[0].signup, undefined);
  });
});

describe("② 메일 받을 곳이 없으면 동의가 있어도 안 만든다", () => {
  it("★PROBE_MAIL_DOMAIN이 없으면 켜지지 않는다 — 중간에 멈춘 계정만 남는다", async () => {
    const { env, sent } = envWith({ PROBE_MAIL_DOMAIN: undefined });
    await dispatchInspection(env, { ...ARGS, withSignup: true });
    assert.equal(sent[0].signup, undefined);
  });

  it("빈 문자열도 없는 것으로 다룬다", async () => {
    const { env, sent } = envWith({ PROBE_MAIL_DOMAIN: "" });
    await dispatchInspection(env, { ...ARGS, withSignup: true });
    assert.equal(sent[0].signup, undefined);
  });
});

describe("③ 둘 다 갖춰졌을 때만 실린다", () => {
  it("동의 + 수신 도메인 → 설정이 컨테이너로 간다", async () => {
    const { env, sent } = envWith();
    await dispatchInspection(env, { ...ARGS, withSignup: true });
    assert.equal(sent[0].signup.enabled, true);
    assert.equal(sent[0].signup.mailDomain, "probe.trysimsa.com");
    assert.equal(sent[0].signup.callbackBaseUrl, "https://cp.example.com");
  });

  it("메일함을 읽을 토큰이 함께 간다 — 없으면 컨테이너가 확인 링크를 못 꺼낸다", async () => {
    const { env, sent } = envWith();
    await dispatchInspection(env, { ...ARGS, withSignup: true });
    assert.equal(sent[0].signup.internalToken, "tok");
  });
});
