/**
 * probe-mailbox.test.mjs — 검수용 일회용 메일함 (2026-08-26).
 *
 * 고정하는 계약:
 *   ① 우리 앞으로 온 것만 처리한다 — 모르는 주소는 조용히 버린다(스팸을 쌓지 않는다)
 *   ② **본문을 저장하지 않는다** — 남의 앱 메일에는 그 앱 사용자의 정보가 담긴다
 *   ③ 수신거부 링크는 넘기지 않는다 — 누르면 되돌리기 어렵다
 *   ④ 메일함 경로는 **무보호로 열리지 않는다** — 확인 링크는 그 자체가 계정 접근권
 *   ⑤ 메일 처리 실패가 워커를 깨뜨리지 않는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runIdFromAddress, extractLinks, decodeBodyForLinks, handleProbeEmail } = await import(
  "../dist/probe-mailbox.js"
);
const { createApp } = await import("../dist/router.js");

describe("① 우리 앞으로 온 것만 (주소 파싱)", () => {
  it("probe-<runId>@… 를 받는다", () => {
    assert.equal(runIdFromAddress("probe-wvc_9am2yegj19@probe.trysimsa.com"), "wvc_9am2yegj19");
    assert.equal(runIdFromAddress("PROBE-ABC123XYZ@Probe.TrySimsa.com"), "abc123xyz", "대소문자 무관");
  });

  it("★모르는 주소는 버린다 — 스팸을 D1에 쌓지 않는다", () => {
    for (const addr of ["hello@probe.trysimsa.com", "probe@x.com", "probe-@x.com", "probe-ab@x.com", "", "그냥문자열"]) {
      assert.equal(runIdFromAddress(addr), null, addr);
    }
  });

  it("주소를 지어내 다른 실행의 메일함을 노리지 못한다", () => {
    // 경로 구분자·공백 등이 섞이면 형식 자체가 안 맞는다.
    assert.equal(runIdFromAddress("probe-abc/../def@x.com"), null);
    assert.equal(runIdFromAddress("probe-abc def@x.com"), null);
  });
});

describe("②③ 링크만 뽑는다", () => {
  const HTML = `<html><body>
    <p>가입을 완료하려면 아래를 눌러주세요</p>
    <a href="https://myapp.com/verify?token=abc123">이메일 인증하기</a>
    <a href="https://myapp.com/help">도움말</a>
    <a href="https://myapp.com/unsubscribe?u=9">수신거부</a>
  </body></html>`;

  it("확인 링크를 뽑는다", () => {
    const links = extractLinks(HTML);
    assert.ok(links.includes("https://myapp.com/verify?token=abc123"));
  });

  it("★어느 게 확인 링크인지 여기서 고르지 않는다 — 도움말도 함께 넘긴다", () => {
    // 앱마다 문구가 달라서 여기서 똑똑한 척 고르면 넘어진다. 판단은 실제로
    // 열어보는 쪽(컨테이너)의 몫이다.
    assert.ok(extractLinks(HTML).includes("https://myapp.com/help"));
  });

  it("★수신거부는 넘기지 않는다 — 누르면 되돌리기 어렵다", () => {
    const links = extractLinks(HTML);
    assert.ok(!links.some((l) => /unsubscribe/.test(l)));
    assert.ok(!extractLinks('<a href="https://x.com/수신거부">x</a>').length);
  });

  it("평문 메일에서도 뽑는다", () => {
    assert.deepEqual(extractLinks("확인: https://myapp.com/v/1 감사합니다"), ["https://myapp.com/v/1"]);
  });

  it("문장부호가 붙어 와도 잘라낸다", () => {
    assert.deepEqual(extractLinks("여기를 누르세요 (https://myapp.com/v/2)."), ["https://myapp.com/v/2"]);
  });

  it("quoted-printable 줄바꿈으로 끊긴 링크를 잇는다", () => {
    const raw = "https://myapp.com/verify?token=3D=\r\nabcdef";
    assert.ok(extractLinks(decodeBodyForLinks(raw))[0].includes("abcdef"));
  });

  it("중복은 한 번만, 개수는 제한된다", () => {
    const many = Array.from({ length: 60 }, (_, i) => `https://x.com/${i}`).join(" ");
    assert.ok(extractLinks(many + " " + many).length <= 25);
  });
});

describe("⑤ 메일 처리 실패가 워커를 깨뜨리지 않는다", () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  const msg = (to, raw) => ({
    from: "noreply@myapp.com",
    to,
    headers: { get: () => "가입을 완료해주세요" },
    raw: new Response(raw).body,
    rawSize: raw.length,
  });

  it("모르는 주소는 ignored", async () => {
    assert.equal(await handleProbeEmail(env, msg("hello@x.com", "hi")), "ignored");
  });

  it("정상 주소는 stored", async () => {
    assert.equal(await handleProbeEmail(env, msg("probe-abc123@x.com", '<a href="https://y.com/v">v</a>')), "stored");
  });

  it("★DB가 터져도 던지지 않는다", async () => {
    const broken = { DB: { prepare: () => { throw new Error("d1 down"); } } };
    assert.equal(await handleProbeEmail(broken, msg("probe-abc123@x.com", "hi")), "ignored");
  });
});

describe("④ 메일함 경로는 무보호로 열리지 않는다", () => {
  const emptyDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}) }) }) };
  const call = (env, token, method = "GET") =>
    createApp().request(
      "/internal/probe-mail?runId=abc123",
      { method, headers: token ? { authorization: `Bearer ${token}` } : {} },
      env,
    );

  it("토큰이 없으면 401", async () => {
    assert.equal((await call({ DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" }, "")).status, 401);
    assert.equal((await call({ DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" }, "wrong")).status, 401);
  });

  it("★서버에 토큰이 설정 안 됐으면 503 — 무보호로 열리지 않는다", async () => {
    assert.equal((await call({ DB: emptyDb }, "anything")).status, 503);
  });

  it("runId가 없으면 400", async () => {
    const res = await createApp().request(
      "/internal/probe-mail",
      { headers: { authorization: "Bearer t" } },
      { DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" },
    );
    assert.equal(res.status, 400);
  });

  it("정상 토큰이면 목록을 준다", async () => {
    const res = await call({ DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" }, "t");
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).emails, []);
  });

  it("삭제도 같은 보호를 받는다", async () => {
    assert.equal((await call({ DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" }, "wrong", "DELETE")).status, 401);
    assert.equal((await call({ DB: emptyDb, INTERNAL_CALLBACK_TOKEN: "t" }, "t", "DELETE")).status, 200);
  });
});
