/**
 * 로컬 체크아웃 페이지 · 설정 · 이벤트 추출 — 서버를 띄우지 않고 순수 함수로(네트워크 0).
 *  - 라이브 client-side token 거부(샌드박스 전용)
 *  - 한글 프로젝트명이 customData 로 그대로 실린다
 *  - $0 가격이 샌드박스에서 거부됐으면 그 변형은 열지 않는다
 *  - index.html 은 sandbox 환경을 고정하고 토큰을 하드코딩하지 않는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSandboxClientToken, buildCheckoutConfig, routeRequest } from "../serve.mjs";
import { TEST_CARD } from "../run-checkout.mjs";
import { extractCompletedTransactionId } from "../lib/checkout-events.mjs";
import { SandboxOnlyError } from "../paddle-client.mjs";
import { SPIKE_TAG } from "../lib/catalog.mjs";
import { FAKE_CLIENT_TOKEN, FAKE_LIVE_CLIENT_TOKEN, KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

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
