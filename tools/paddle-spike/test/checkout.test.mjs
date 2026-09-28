/**
 * 로컬 체크아웃 페이지 · 설정 · 이벤트 추출 — 서버를 띄우지 않고 순수 함수로(네트워크 0).
 *  - client-side token 은 허용 목록(test_ + 영숫자 27자)만 — 라이브 토큰·서버 API 키·임의 값 거부
 *  - 로컬 서버는 Host 가 127.0.0.1/localhost:<포트> 가 아니면 403(DNS rebinding 방어)
 *  - 한글 프로젝트명이 customData 로 그대로 실린다
 *  - $0 가격이 샌드박스에서 거부됐으면 그 변형은 열지 않는다
 *  - index.html 은 sandbox 환경을 고정하고 토큰을 하드코딩하지 않는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSandboxClientToken, buildCheckoutConfig, routeRequest, startServer } from "../serve.mjs";
import { TEST_CARD } from "../run-checkout.mjs";
import { extractCompletedTransactionId } from "../lib/checkout-events.mjs";
import { SandboxOnlyError } from "../paddle-client.mjs";
import { SPIKE_TAG } from "../lib/catalog.mjs";
import { FAKE_CLIENT_TOKEN, FAKE_LIVE_CLIENT_TOKEN, FAKE_LIVE_KEY, FAKE_SANDBOX_KEY, FAKE_WEBHOOK_SECRET, KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = {
  products: { build_guarantee: fakeId("pro", "b"), repair_fee: fakeId("pro", "r") },
  prices: {
    card_trial_19: { id: fakeId("pri", "t19"), status: "created" },
    card_trial_0: { id: null, status: "rejected" },
    build_once_199: { id: fakeId("pri", "o199"), status: "existing" },
  },
};

describe("client-side token", () => {
  it("라이브 토큰 거부, 샌드박스 토큰 허용", () => {
    assert.throws(() => assertSandboxClientToken(FAKE_LIVE_CLIENT_TOKEN), SandboxOnlyError);
    assert.throws(() => assertSandboxClientToken(""), TypeError);
    assert.equal(assertSandboxClientToken(FAKE_CLIENT_TOKEN), FAKE_CLIENT_TOKEN);
  });
});

/**
 * client-side token 은 허용 목록으로 받는다: test_ + 영숫자 27자(Paddle 문서의 형식 정규식
 * ^(test|live)_[a-zA-Z0-9]{27}$ 중 샌드박스 쪽 — developer.paddle.com/paddle-js/about/client-side-tokens, 2026-09-28 접근).
 * 이 값은 /config.json(인증 없음)으로 서빙되고 브라우저의 Paddle.Initialize 로 들어간다. 그래서 두 칸을 서로
 * 바꿔 넣는 흔한 실수로 서버 API 키(pdl_…)가 들어오면, 체크아웃을 열기 전에 멈춰야 한다.
 * 가짜 값은 런타임에 이어 붙인다(helpers/fakes.mjs 와 같은 규칙).
 */
describe("client-side token = 허용 목록(test_ + 영숫자 27자)만", () => {
  const tok = (prefix, body) => [prefix, body].join("_");
  const rejectsWithoutValue = (value, pattern) =>
    assert.throws(
      () => assertSandboxClientToken(value),
      (e) => e instanceof TypeError && pattern.test(e.message) && !e.message.includes(value.trim()),
      JSON.stringify(value.slice(0, 12)),
    );

  it("서버 비밀값(API 키·알림 시크릿, pdl_…)을 client-side token 칸에 넣으면 'API 키' 라고 거부하고, 값은 싣지 않는다", () => {
    for (const secret of [FAKE_SANDBOX_KEY, FAKE_LIVE_KEY, FAKE_WEBHOOK_SECRET, `  ${FAKE_SANDBOX_KEY}\n`]) {
      rejectsWithoutValue(secret, /API 키/);
    }
  });

  it("test_ + 영숫자 27자가 아닌 값은 전부 거부(형식 안내, 값은 싣지 않는다)", () => {
    for (const bad of [
      "hello",
      "FAKE" + "0".repeat(23), // 접두사 없음
      tok("test", "FAKE" + "0".repeat(21) + "X"), // 26자
      tok("test", "FAKE" + "0".repeat(23) + "X"), // 28자
      tok("TEST", "FAKE" + "0".repeat(22) + "X"), // 대문자 접두사
      tok("test", "FAKE" + "0".repeat(22) + "-"), // 영숫자 아님
      tok("test", "FAKE" + "0".repeat(10) + " " + "0".repeat(11) + "X"), // 가운데 공백
      tok("test", "가".repeat(27)), // 비ASCII(규칙 6)
      tok("test", "FAKE" + "0".repeat(22) + "X") + "\n" + "extra", // 줄바꿈 뒤 덧붙임
      tok("test", "FAKE" + "0".repeat(10)) + "</script><script>", // 페이지로 흘러가는 값
    ]) {
      rejectsWithoutValue(bad, /test_/);
    }
  });

  it("buildCheckoutConfig 도 같은 가드 — API 키로는 /config.json 에 실릴 설정 자체가 만들어지지 않는다", () => {
    assert.throws(
      () => buildCheckoutConfig({ clientToken: FAKE_SANDBOX_KEY, catalog, variant: "trial19", projectName: KO_PROJECT_NAME }),
      (e) => e instanceof TypeError && !e.message.includes(FAKE_SANDBOX_KEY),
    );
  });

  it("(행동 보존) 앞뒤 공백은 벗기고 받는다 · 라이브 토큰은 여전히 SandboxOnlyError", () => {
    assert.equal(assertSandboxClientToken(`  ${FAKE_CLIENT_TOKEN}\n`), FAKE_CLIENT_TOKEN);
    assert.throws(() => assertSandboxClientToken(FAKE_LIVE_CLIENT_TOKEN), SandboxOnlyError);
  });
});

describe("buildCheckoutConfig", () => {
  it("trial19: 가격 id · 한글 프로젝트명 customData · overlay · 고객 미리 채움", () => {
    const cfg = buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19", projectName: KO_PROJECT_NAME, email: "bae.spike@example.com" });
    assert.equal(cfg.priceId, fakeId("pri", "t19"));
    assert.equal(cfg.environment, "sandbox");
    assert.equal(cfg.customData.simsa_project_name, KO_PROJECT_NAME);
    assert.equal(cfg.customData.spike, SPIKE_TAG);
    assert.equal(cfg.customData.variant, "trial19");
    assert.equal(cfg.customer.email, "bae.spike@example.com");
    assert.equal(cfg.customer.address.countryCode, "US");
    assert.equal(cfg.settings.displayMode, "overlay");
  });
  it("샌드박스가 거부한 $0 가격 변형은 열지 않는다", () => {
    assert.throws(() => buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial0", projectName: KO_PROJECT_NAME }), /rejected|거부/);
  });
  it("알 수 없는 변형·라이브 토큰 거부", () => {
    assert.throws(() => buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "annual" }), TypeError);
    assert.throws(() => buildCheckoutConfig({ clientToken: FAKE_LIVE_CLIENT_TOKEN, catalog, variant: "trial19" }), SandboxOnlyError);
  });
  it("이메일에 공백·비ASCII 가 있으면 거부(Paddle.js 요건) — 한글은 프로젝트명에만", () => {
    assert.throws(() => buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19", email: "배 승훈@example.com" }), TypeError);
  });
});

/**
 * 체크아웃 스크린샷(evidence/shots/*.png)은 이미지라 redact → assertNoLeak 를 거치지 않는다.
 * Paddle 오버레이는 미리 채운 이메일을 화면에 보여 준다. 그래서 화면에 들어갈 이메일을 코드로
 * 예약 도메인(RFC 2606: example.com·example.net·example.org)으로 묶는다 — 실제 주소가 PNG 에
 * 가려지지 않은 채 남는 길을 막는다.
 */
describe("체크아웃 이메일 = 예약 도메인만 (스크린샷은 가려지지 않는다)", () => {
  const cfgWith = (email) => buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19", projectName: KO_PROJECT_NAME, email });

  it("실제 메일 도메인은 체크아웃을 열기 전에 거부하고, 오류에 그 주소를 싣지 않는다", () => {
    for (const email of [
      "spike-operator@gmail.com",
      "trupixel.owner@naver.com",
      "ceo@trupixel.co.kr",
      "x@notexample.com",
      "x@example.com.evil.io",
      "x@example.co",
      "real.person@gmail.com@example.com",
    ]) {
      assert.throws(
        () => cfgWith(email),
        (e) => e instanceof TypeError && /example\.com/.test(e.message) && !e.message.includes(email),
        email,
      );
    }
  });

  it("예약 도메인(대소문자·+태그·하위 도메인)은 그대로 통과", () => {
    for (const email of ["bae.spike@example.com", "paddle-spike+2@EXAMPLE.org", "qa_1@example.net", "run-3@checkout.example.com"]) {
      assert.equal(cfgWith(email).customer.email, email);
    }
  });

  it("기본 이메일도 예약 도메인이다", () => {
    const cfg = buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19" });
    assert.match(cfg.customer.email, /@example\.com$/);
  });
});

describe("체크아웃 카드 = Paddle 공개 테스트 카드 상수", () => {
  it("스크린샷에 찍히는 카드는 env 가 아니라 코드 상수 4242(샌드박스 전용 공개 테스트 카드)뿐", () => {
    assert.equal(TEST_CARD.number.replace(/\s/g, ""), "4242424242424242");
    assert.ok(Object.isFrozen(TEST_CARD));
  });
});

describe("routeRequest", () => {
  const cfg = buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19", projectName: KO_PROJECT_NAME });
  const html = "<html>page</html>";
  it("/ → index.html, /config.json → 설정(no-store, UTF-8 한글), 그 밖 404", () => {
    const page = routeRequest("/", { config: cfg, html });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html; charset=utf-8/);
    const conf = routeRequest("/config.json", { config: cfg, html });
    assert.equal(conf.status, 200);
    assert.equal(conf.headers["cache-control"], "no-store");
    assert.equal(JSON.parse(conf.body).customData.simsa_project_name, KO_PROJECT_NAME);
    assert.equal(routeRequest("/../../.env.local", { config: cfg, html }).status, 404);
    assert.equal(routeRequest("/evidence/pool.json", { config: cfg, html }).status, 404);
  });
});

/**
 * 로컬 서버는 127.0.0.1 에만 붙지만, DNS rebinding(공격 페이지가 자기 도메인을 127.0.0.1 로 다시 풀게 하는 것)이면
 * 브라우저가 그 도메인 이름으로 이 서버를 부른다 — Host 헤더가 127.0.0.1/localhost:<포트> 가 아니면 403.
 * 루프백 소켓만 쓴다(외부 네트워크 0). Host 는 node:http 로 직접 넣는다(fetch 는 Host 를 못 바꾼다).
 */
describe("serve: Host 검사(DNS rebinding 방어)", () => {
  const cfg = buildCheckoutConfig({ clientToken: FAKE_CLIENT_TOKEN, catalog, variant: "trial19", projectName: KO_PROJECT_NAME });
  /** @returns {Promise<{ status: number|undefined, body: string }>} */
  const get = (port, path, host) =>
    new Promise((resolvePromise, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolvePromise({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
  const withServer = async (fn) => {
    const srv = await startServer({ config: cfg, html: "<html>page</html>", port: 0 });
    try {
      await fn(Number(new URL(srv.url).port));
    } finally {
      await srv.close();
    }
  };

  it("(행동 보존) 127.0.0.1:<포트>·localhost:<포트> 는 그대로 200", async () => {
    await withServer(async (port) => {
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`]) {
        const res = await get(port, "/config.json", host);
        assert.equal(res.status, 200, host);
        assert.equal(JSON.parse(res.body).customData.simsa_project_name, KO_PROJECT_NAME);
      }
    });
  });

  it("다른 이름·다른 포트로 들어온 요청은 403 이고 설정·페이지를 싣지 않는다", async () => {
    await withServer(async (port) => {
      for (const host of [`rebind.example:${port}`, `127.0.0.1.rebind.example:${port}`, `127.0.0.1:${port + 1}`, "127.0.0.1", `127.0.0.1:${port}@rebind.example`]) {
        for (const path of ["/config.json", "/"]) {
          const res = await get(port, path, host);
          assert.equal(res.status, 403, `${host} ${path}`);
          assert.ok(!res.body.includes(FAKE_CLIENT_TOKEN) && !res.body.includes("page"), `${host} ${path}`);
        }
      }
    });
  });
});

describe("checkout/index.html (정적 검사)", () => {
  const html = readFileSync(join(SPIKE_DIR, "checkout", "index.html"), "utf8");
  it("Paddle.js v2 · sandbox 고정 · 설정은 /config.json 에서", () => {
    assert.ok(html.includes("https://cdn.paddle.com/paddle/v2/paddle.js"));
    assert.ok(html.includes('Paddle.Environment.set("sandbox")'));
    assert.ok(html.includes("/config.json"));
    assert.ok(html.includes("customData"));
  });
  it("토큰·키 하드코딩 없음", () => {
    assert.ok(!/\b(?:test|live)_[A-Za-z0-9]{27}\b/.test(html));
    assert.ok(!/pdl_/.test(html));
  });
});

describe("checkout 이벤트 → 거래 id", () => {
  it("마지막 checkout.completed 의 transaction_id", () => {
    const events = [
      { name: "checkout.loaded", data: {} },
      { name: "checkout.completed", data: { transaction_id: fakeId("txn", "one") } },
      { name: "checkout.closed", data: {} },
    ];
    assert.equal(extractCompletedTransactionId(events), fakeId("txn", "one"));
  });
  it("없거나 형식이 틀리면 null", () => {
    assert.equal(extractCompletedTransactionId([{ name: "checkout.completed", data: { transaction_id: "../x" } }]), null);
    assert.equal(extractCompletedTransactionId(null), null);
  });
});
