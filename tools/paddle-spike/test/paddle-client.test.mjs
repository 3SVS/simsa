/**
 * paddle-client — 샌드박스 전용 가드 + 요청 모양. 네트워크 0(가짜 fetch 주입).
 *
 * 고정하는 것:
 *  ① 라이브 API 주소(api.paddle.com)·그 밖의 호스트·http 는 **생성 즉시 throw** — 요청 한 번 없이.
 *  ② 라이브 키(pdl + live 접두사)도 즉시 throw.
 *  ③ 경로에 절대 URL·스킴 상대 URL을 넣어 호스트를 빠져나갈 수 없다. 페이지네이션 next 도 같은 검사.
 *  ④ 요청은 Bearer + Paddle-Version + JSON 본문으로 샌드박스 호스트에만 간다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SANDBOX_API_BASE,
  SandboxOnlyError,
  assertSandboxBaseUrl,
  assertNotLiveApiKey,
  createPaddleClient,
} from "../paddle-client.mjs";
import { FAKE_SANDBOX_KEY, FAKE_LIVE_KEY, fakeId, makeFakeFetch } from "./helpers/fakes.mjs";

const neverFetch = async () => {
  throw new Error("fetch must not be called");
};

describe("① 라이브 URL 거부 — 생성 즉시, 요청 0", () => {
  const liveOrForeign = [
    "https://api.paddle.com",
    "https://api.paddle.com/",
    "https://API.PADDLE.COM",
    "https://vendors.paddle.com",
    "http://sandbox-api.paddle.com",
    "https://sandbox-api.paddle.com.evil.example",
    "https://evil.example/sandbox-api.paddle.com",
    "https://sandbox-api.paddle.com:8443",
    "not a url",
    "",
  ];
  for (const baseUrl of liveOrForeign) {
    it(`거부: ${JSON.stringify(baseUrl)}`, () => {
      assert.throws(() => assertSandboxBaseUrl(baseUrl), SandboxOnlyError);
      assert.throws(() => createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, baseUrl, fetch: neverFetch }), SandboxOnlyError);
    });
  }

  it("라이브 주소에는 '라이브' 라는 말이 들어간 명시적 메시지", () => {
    assert.throws(() => assertSandboxBaseUrl("https://api.paddle.com"), /라이브/);
  });

  it("기본값·명시 샌드박스 주소는 허용", () => {
    assert.equal(SANDBOX_API_BASE, "https://sandbox-api.paddle.com");
    assert.equal(assertSandboxBaseUrl("https://sandbox-api.paddle.com/"), "https://sandbox-api.paddle.com");
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch: neverFetch });
    assert.equal(client.baseUrl, SANDBOX_API_BASE);
  });
});

describe("② 라이브 키 거부", () => {
  it("pdl + live 접두사 키는 생성 즉시 throw", () => {
    assert.throws(() => assertNotLiveApiKey(FAKE_LIVE_KEY), SandboxOnlyError);
    assert.throws(() => createPaddleClient({ apiKey: FAKE_LIVE_KEY, fetch: neverFetch }), SandboxOnlyError);
  });
  it("에러 메시지에 키 값이 들어가지 않는다", () => {
    try {
      assertNotLiveApiKey(FAKE_LIVE_KEY);
      assert.fail("throw 했어야 함");
    } catch (e) {
      assert.ok(!String(e.message).includes(FAKE_LIVE_KEY));
    }
  });
  it("빈 키는 거부", () => {
    assert.throws(() => createPaddleClient({ apiKey: "", fetch: neverFetch }), TypeError);
  });
});

describe("③ 호스트 탈출 금지", () => {
  const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch: neverFetch });
  for (const path of ["https://api.paddle.com/subscriptions", "//api.paddle.com/x", "subscriptions", "/a/../../x?y"]) {
    it(`거부: ${path}`, async () => {
      await assert.rejects(() => client.request("GET", path), (e) => e instanceof SandboxOnlyError || e instanceof TypeError);
    });
  }

  it("ID 가 Paddle 형식이 아니면 경로를 만들기 전에 throw(경로 주입 방지)", async () => {
    await assert.rejects(() => client.subscriptions.get("sub_../../prices"), TypeError);
    await assert.rejects(() => client.subscriptions.charge("../x", {}), TypeError);
  });

  it("페이지네이션 next 가 라이브 호스트면 따라가지 않고 throw", async () => {
    const { fetch } = makeFakeFetch(() => ({
      status: 200,
      body: {
        data: [{ id: fakeId("pri", "a") }],
        meta: { request_id: "req-1", pagination: { has_more: true, next: "https://api.paddle.com/prices?after=pri_x" } },
      },
    }));
    const c = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    await assert.rejects(() => c.listAll("/prices", {}), SandboxOnlyError);
  });
});

describe("④ 요청 모양", () => {
  it("charge: POST sandbox /subscriptions/{id}/charge, Bearer·Paddle-Version·JSON", async () => {
    const sub = fakeId("sub", "charge");
    const { fetch, calls } = makeFakeFetch(() => ({
      status: 201,
      body: { data: { id: sub, status: "trialing" }, meta: { request_id: "req-abc" } },
    }));
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    const body = { effective_from: "immediately", items: [{ price_id: fakeId("pri", "b"), quantity: 1 }] };
    const res = await client.subscriptions.charge(sub, body);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.url.origin, SANDBOX_API_BASE);
    assert.equal(call.url.pathname, `/subscriptions/${sub}/charge`);
    assert.equal(call.headers.authorization, `Bearer ${FAKE_SANDBOX_KEY}`);
    assert.equal(call.headers["paddle-version"], "1");
    assert.equal(call.headers["content-type"], "application/json");
    assert.deepEqual(call.body, body);
    assert.equal(res.ok, true);
    assert.equal(res.status, 201);
    assert.equal(res.requestId, "req-abc");
    assert.equal(res.data.status, "trialing");
    // 기록용 요청 서술에는 헤더(키)가 없다
    assert.deepEqual(Object.keys(res.request).sort(), ["body", "method", "path", "query"]);
    assert.ok(!JSON.stringify(res.request).includes(FAKE_SANDBOX_KEY));
  });

  it("previewCharge·cancel·activate·update·adjustments 경로", async () => {
    const sub = fakeId("sub", "paths");
    const { fetch, calls } = makeFakeFetch(() => ({ status: 200, body: { data: {}, meta: { request_id: "r" } } }));
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    await client.subscriptions.previewCharge(sub, { effective_from: "immediately", items: [] });
    await client.subscriptions.cancel(sub, { effective_from: "immediately" });
    await client.subscriptions.activate(sub);
    await client.subscriptions.update(sub, { scheduled_change: null });
    await client.adjustments.create({ action: "refund" });
    await client.transactions.list({ subscription_id: sub, origin: "subscription_charge" });
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url.pathname}`),
      [
        `POST /subscriptions/${sub}/charge/preview`,
        `POST /subscriptions/${sub}/cancel`,
        `POST /subscriptions/${sub}/activate`,
        `PATCH /subscriptions/${sub}`,
        "POST /adjustments",
        "GET /transactions",
      ],
    );
    const q = calls[5].url.searchParams;
    assert.equal(q.get("subscription_id"), sub);
    assert.equal(q.get("origin"), "subscription_charge");
  });

  it("4xx 는 throw 하지 않고 error 코드·request_id 를 돌려준다(관측 대상이므로)", async () => {
    const { fetch } = makeFakeFetch(() => ({
      status: 400,
      body: {
        error: { type: "request_error", code: "subscription_update_when_trialing", detail: "not allowed" },
        meta: { request_id: "req-err" },
      },
    }));
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    const res = await client.subscriptions.charge(fakeId("sub", "err"), { effective_from: "immediately", items: [] });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.equal(res.error.code, "subscription_update_when_trialing");
    assert.equal(res.requestId, "req-err");
  });

  it("JSON 이 아닌 응답도 죽지 않고 ok:false + raw 앞부분", async () => {
    const { fetch } = makeFakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    const res = await client.transactions.get(fakeId("txn", "x"));
    assert.equal(res.ok, false);
    assert.equal(res.status, 502);
    assert.match(res.error.detail, /bad gateway/);
  });

  it("listAll 은 샌드박스 next 를 따라가며 모은다", async () => {
    let page = 0;
    const { fetch, calls } = makeFakeFetch(() => {
      page += 1;
      return page === 1
        ? {
            body: {
              data: [{ id: fakeId("pro", "a") }],
              meta: { request_id: "r1", pagination: { has_more: true, next: `${SANDBOX_API_BASE}/products?after=${fakeId("pro", "a")}&per_page=1` } },
            },
          }
        : { body: { data: [{ id: fakeId("pro", "b") }], meta: { request_id: "r2", pagination: { has_more: false, next: null } } } };
    });
    const client = createPaddleClient({ apiKey: FAKE_SANDBOX_KEY, fetch });
    const res = await client.listAll("/products", { per_page: "1" });
    assert.equal(res.ok, true);
    assert.deepEqual(res.items.map((x) => x.id), [fakeId("pro", "a"), fakeId("pro", "b")]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url.searchParams.get("after"), fakeId("pro", "a"));
  });
});
