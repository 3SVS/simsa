/**
 * redact — 증거 파일에 쓰기 전 가림. 양방향으로 고정한다:
 *  (가림) 키·토큰·Bearer·이메일·카드 번호·고객 포털 URL·주소 줄
 *  (보존) Paddle ID·금액·ISO 날짜·한글 프로젝트명 — 증거로서 의미가 있어야 한다(과교정 방지)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REDACTED, redact, redactText, assertNoLeak } from "../lib/redact.mjs";
import { FAKE_SANDBOX_KEY, FAKE_CLIENT_TOKEN, FAKE_WEBHOOK_SECRET, KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

describe("가림 — 키 이름 기반", () => {
  it("authorization·api_key·token·email·card·management_urls·주소 줄", () => {
    const out = redact({
      authorization: `Bearer ${FAKE_SANDBOX_KEY}`,
      api_key: FAKE_SANDBOX_KEY,
      client_token: FAKE_CLIENT_TOKEN,
      email: "bae.spike@example.com",
      card: { type: "visa", last4: "4242", expiry_month: 12, expiry_year: 2030, cardholder_name: "홍 길동" },
      management_urls: { update_payment_method: "https://sandbox-customer-portal.paddle.com/x?token=abc" },
      address: { first_line: "서울시 강남구 테헤란로 1", postal_code: "06236", country_code: "KR" },
    });
    assert.equal(out.authorization, REDACTED);
    assert.equal(out.api_key, REDACTED);
    assert.equal(out.client_token, REDACTED);
    assert.equal(out.email, REDACTED);
    assert.equal(out.card, REDACTED);
    assert.equal(out.management_urls, REDACTED);
    assert.equal(out.address.first_line, REDACTED);
    assert.equal(out.address.postal_code, REDACTED);
    assert.equal(out.address.country_code, "KR", "국가 코드는 비식별 메타 — 보존");
  });

  it("null 값은 null 로 둔다(없던 값을 있던 것처럼 보이게 하지 않음)", () => {
    assert.deepEqual(redact({ email: null, card: undefined }), { email: null, card: undefined });
  });
});

describe("가림 — 문자열 패턴 기반(어느 필드에 섞여 있든)", () => {
  it("Paddle 비밀값·client-side token·Bearer·이메일·카드 번호(공백/하이픈)", () => {
    const s = [
      `key=${FAKE_SANDBOX_KEY}`,
      `secret=${FAKE_WEBHOOK_SECRET}`,
      `token ${FAKE_CLIENT_TOKEN}`,
      "Authorization: Bearer abc.def-ghi",
      "문의 bae.spike+ko@example.com 로",
      "card 4242 4242 4242 4242 / 4000-0566-5566-5556 / 4000000000000002",
    ].join(" | ");
    const out = redactText(s);
    assert.ok(!out.includes(FAKE_SANDBOX_KEY));
    assert.ok(!out.includes(FAKE_WEBHOOK_SECRET));
    assert.ok(!out.includes(FAKE_CLIENT_TOKEN));
    assert.ok(!out.includes("abc.def-ghi"));
    assert.ok(!out.includes("example.com"));
    assert.ok(!/4242 4242/.test(out) && !/4000-0566/.test(out) && !/4000000000000002/.test(out));
    assert.match(out, /\[REDACTED:paddle_secret\]/);
    assert.match(out, /\[REDACTED:client_token\]/);
    assert.match(out, /\[REDACTED:email\]/);
    assert.match(out, /\[REDACTED:card\]/);
    assert.ok(out.includes("문의"), "주변 한글은 남는다");
  });

  it("호출자가 넘긴 실제 비밀값은 패턴과 무관하게 정확 일치로 가린다", () => {
    const odd = "weird-secret-without-known-shape-123";
    const out = redact({ note: `x ${odd} y` }, { secrets: [odd] });
    assert.equal(out.note, `x ${REDACTED} y`);
  });
});

describe("보존 — 증거로서 의미 있는 값", () => {
  it("Paddle ID·금액·ISO 날짜·한글 프로젝트명·상태", () => {
    const input = {
      id: fakeId("sub", "keep"),
      status: "trialing",
      items: [{ price: { id: fakeId("pri", "keep"), unit_price: { amount: "19900", currency_code: "USD" } } }],
      next_billed_at: "2026-10-28T05:00:00.000Z",
      custom_data: { simsa_project_name: KO_PROJECT_NAME, spike: "simsa-paddle-spike-2026-10" },
      details: { totals: { subtotal: "19900", tax: "1766", total: "21666", fee: "1133", earnings: "20533" } },
    };
    const out = redact(input);
    assert.deepEqual(out, input);
  });

  it("같은 객체를 두 곳에서 참조해도(순환 아님) 둘 다 내용 그대로 — [Circular] 오표기 금지", () => {
    // 시나리오가 같은 요청 본문을 preview·charge 두 단계에 쓰면 두 번째가 "[Circular]"로 사라지던 결함
    const body = { effective_from: "immediately", items: [{ price_id: fakeId("pri", "shared"), quantity: 1 }] };
    const out = redact({ steps: [{ request: { body } }, { request: { body } }] });
    assert.deepEqual(out.steps[0].request.body, body);
    assert.deepEqual(out.steps[1].request.body, body);
  });

  it("원본을 바꾸지 않는다 · 순환 참조는 [Circular]", () => {
    const a = { email: "x@example.com", nested: {} };
    a.nested.self = a;
    const out = redact(a);
    assert.equal(a.email, "x@example.com");
    assert.equal(out.email, REDACTED);
    assert.equal(out.nested.self, "[Circular]");
  });
});

describe("assertNoLeak — 두 번째 안전망", () => {
  it("가리지 않은 JSON 에서는 throw, 가린 뒤에는 통과", () => {
    const raw = { customer: { email: "bae.spike@example.com" }, note: `k=${FAKE_SANDBOX_KEY}` };
    assert.throws(() => assertNoLeak(JSON.stringify(raw)), /assertNoLeak/);
    assert.equal(assertNoLeak(JSON.stringify(redact(raw))), true);
  });
  it("정확 일치 비밀값이 남아 있으면 throw(메시지에 값 없음)", () => {
    const secret = "plain-secret-value-xyz";
    try {
      assertNoLeak(`{"a":"${secret}"}`, { secrets: [secret] });
      assert.fail("throw 했어야 함");
    } catch (e) {
      assert.ok(!String(e.message).includes(secret));
    }
  });
});
