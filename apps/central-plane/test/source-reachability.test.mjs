/**
 * source-reachability.test.mjs — 연결 시점 도달성 계측 (2026-08-23).
 *
 * 고정하는 계약:
 *   ① 공개 저장소는 **계정 없이** readable — 이게 "주소만 넣어도 된다"의 근거다
 *   ② 404는 needs_access — 비공개일 수도, 오타일 수도(구분 불가)
 *   ③ ★레이트리밋을 "못 읽음"으로 셈하지 않는다 — 그러면 멀쩡한 공개 저장소를
 *      "비공개인가 봐요"로 오진한다. 비인증 GitHub API는 IP당 60회/시간이고
 *      Worker는 egress IP를 공유하므로 이 오진은 드문 일이 아니다
 *   ④ 계측은 **던지지 않는다** — 부가 정보가 연결을 깨뜨리면 안 된다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { probeGithubRepo, probeWebsite } = await import("../dist/workspace/source-reachability.js");

/** GitHub 연결이 없는 익명 사용자 — 토큰 조회가 빈손으로 끝난다. */
const anonEnv = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("공개 저장소는 계정 없이 읽힌다 (①)", () => {
  it("200 + private:false → readable/public/anonymous", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async () => json({ private: false }));
    assert.deepEqual(r, { state: "readable", visibility: "public", via: "anonymous" });
  });

  it("인증 헤더 없이 나간다 — 익명 경로임을 실제로 확인", async () => {
    let sawAuth = true;
    await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async (_u, init) => {
      sawAuth = "authorization" in (init?.headers ?? {});
      return json({ private: false });
    });
    assert.equal(sawAuth, false);
  });

  it("owner/repo가 URL에 인코딩되어 들어간다", async () => {
    let url = "";
    await probeGithubRepo(anonEnv, "uk_none", "some-org/my_app.v2", async (u) => {
      url = u;
      return json({ private: false });
    });
    assert.equal(url, "https://api.github.com/repos/some-org/my_app.v2");
  });
});

describe("안 보이는 저장소 (②)", () => {
  it("404 → needs_access", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/secret", async () => json({}, 404));
    assert.equal(r.state, "needs_access");
  });

  it("403이지만 레이트리밋이 아니면 needs_access", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/secret", async () =>
      json({}, 403, { "x-ratelimit-remaining": "42" }),
    );
    assert.equal(r.state, "needs_access");
  });
});

describe("★레이트리밋이면 웹 페이지로 폴백한다 (2026-08-24 라이브 실측)", () => {
  // 배포 직후 익명 4건 중 2건이 rate_limited였다. unknown 분류는 옳았지만
  // 실사용에서 절반이 "모르겠어요"면 계측이 값을 못 낸다.
  // github.com HEAD는 API 레이트리밋과 별개다(연속 20회 200 실측).
  const rateLimitedApi = (webStatus) => async (url, init) => {
    if (url.startsWith("https://api.github.com")) return json({}, 429);
    assert.equal(init?.method, "HEAD", "웹 폴백은 본문을 받지 않는다");
    assert.equal(url, "https://github.com/3SVS/simsa");
    return new Response("", { status: webStatus });
  };

  it("API 429 → 웹 200이면 readable/public — 공개 저장소를 되살린다", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", rateLimitedApi(200));
    assert.deepEqual(r, { state: "readable", visibility: "public", via: "anonymous" });
  });

  it("API 429 → 웹 404면 needs_access — 익명에겐 비공개도 404다", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", rateLimitedApi(404));
    assert.equal(r.state, "needs_access");
  });

  it("403 + remaining:0도 같은 폴백을 탄다", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async (url) =>
      url.startsWith("https://api.github.com")
        ? json({}, 403, { "x-ratelimit-remaining": "0" })
        : new Response("", { status: 200 }),
    );
    assert.equal(r.state, "readable");
  });

  it("★웹까지 실패하면 종전대로 unknown — 폴백이 회귀를 만들지 않는다", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async (url) => {
      if (url.startsWith("https://api.github.com")) return json({}, 429);
      throw new Error("web down");
    });
    assert.deepEqual(r, { state: "unknown", reason: "rate_limited" });
  });

  it("★성공한 API 답은 폴백이 건드리지 않는다", async () => {
    let webCalled = false;
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async (url) => {
      if (!url.startsWith("https://api.github.com")) { webCalled = true; }
      return json({ private: true });
    });
    assert.equal(r.visibility, "private");
    assert.equal(webCalled, false, "API가 답했으면 웹은 부르지 않는다");
  });
});

describe("★모름과 못 읽음을 구분한다 (③)", () => {

  it("네트워크 예외 → unknown (던지지 않는다, ④)", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async () => {
      throw new Error("boom");
    });
    assert.equal(r.state, "unknown");
  });

  it("500 → unknown/network — 서버 장애를 '비공개'로 말하지 않는다", async () => {
    const r = await probeGithubRepo(anonEnv, "uk_none", "3SVS/simsa", async () => json({}, 500));
    assert.deepEqual(r, { state: "unknown", reason: "network" });
  });
});

describe("앱 주소 — 살아 있는가까지만 잰다", () => {
  it("200이면 readable", async () => {
    const r = await probeWebsite("https://my-app.vercel.app/", async () => new Response("ok", { status: 200 }));
    assert.equal(r.state, "readable");
  });

  it("★401/403도 readable — 로그인이 필요할 뿐 서버는 살아 있다", async () => {
    for (const status of [401, 403]) {
      const r = await probeWebsite("https://my-app.vercel.app/", async () => new Response("", { status }));
      assert.equal(r.state, "readable", `${status}`);
    }
  });

  it("★500도 readable — 앱이 고장 난 건 검수가 할 말이지 연결 실패가 아니다", async () => {
    const r = await probeWebsite("https://my-app.vercel.app/", async () => new Response("", { status: 500 }));
    assert.equal(r.state, "readable");
  });

  it("닿지 못하면 unknown (던지지 않는다)", async () => {
    const r = await probeWebsite("https://nope.invalid/", async () => {
      throw new Error("dns");
    });
    assert.equal(r.state, "unknown");
  });

  it("한글 경로가 든 주소도 그대로 요청한다 (Rule 6)", async () => {
    let url = "";
    const target = "https://내앱.example.com/검수/시작";
    await probeWebsite(target, async (u) => {
      url = u;
      return new Response("ok", { status: 200 });
    });
    assert.equal(url, target, "주소를 임의로 손대지 않는다");
  });
});
