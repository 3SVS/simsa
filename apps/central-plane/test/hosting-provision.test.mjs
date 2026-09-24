/**
 * SI 티어 Train B — B2: 호스팅 프로비저닝 클라이언트. fetch 주입 — 네트워크 없음.
 * 요청 모양(메서드·경로·metadata·바인딩)을 고정하고, 토큰이 결과·에러에 새지 않음을 확인한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  HOSTING_NAMESPACE, SLUG_RE, toHostedSlug, ensureNamespace, createProjectD1,
  buildUploadMetadata, uploadUserWorker, deleteUserWorker,
} = await import("../dist/workspace/hosting-provision.js");

const ENV = { HOSTING_CF_API_TOKEN: "tok-SECRET-123", HOSTING_CF_ACCOUNT_ID: "acc1" };
const RESERVED = new Set(["www", "api", "app", "admin"]);

function mockFetch(responder = () => null) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const { status = 200, body } = responder(url, init) ?? {};
    return new Response(JSON.stringify(body ?? { success: true, result: {} }), { status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

describe("toHostedSlug — 결정론, ASCII 키(Rule 6)", () => {
  it("영문 제목 → kebab + id 조각", () => {
    assert.equal(toHostedSlug("Bakery Pickup!", "wsp_ewd3lmln10", RESERVED), "bakery-pickup-d3lmln10");
  });
  it("한글 제목은 ASCII로 못 바꾸므로 app-<id> (모지바케·퓨니코드 없음)", () => {
    const s = toHostedSlug("동네 빵집 픽업 예약", "wsp_ewd3lmln10", RESERVED);
    assert.equal(s, "app-d3lmln10");
    assert.match(s, SLUG_RE);
  });
  it("혼합 제목 '아파트 반찬 공동구매 (101동·102동)' → 숫자만 남아도 규칙 통과", () => {
    const s = toHostedSlug("아파트 반찬 공동구매 (101동·102동)", "wsp_exkw8kxxyf", RESERVED);
    assert.match(s, SLUG_RE);
    assert.ok(s.endsWith("kw8kxxyf"), s);
  });
  it("항상 SLUG_RE 통과 + 40자 이하 + 예약어 아님", () => {
    for (const t of ["", "--", "A".repeat(200), "www", "api", "a b c", "Émilie's Café", "x"]) {
      const s = toHostedSlug(t, "proj_ABC-123_xyz", RESERVED);
      assert.match(s, SLUG_RE, `${t} → ${s}`);
      assert.ok(s.length <= 40);
      assert.ok(!RESERVED.has(s));
    }
  });
});

describe("미설정 → not_configured (정직하게 꺼짐)", () => {
  it("토큰 또는 계정 id가 없으면 fetch를 부르지 않는다", async () => {
    const { f, calls } = mockFetch();
    for (const env of [{}, { HOSTING_CF_API_TOKEN: "t" }, { HOSTING_CF_ACCOUNT_ID: "a" }]) {
      assert.deepEqual(await ensureNamespace(env, f), { ok: false, error: "not_configured" });
      assert.equal((await createProjectD1(env, "abc", f)).error, "not_configured");
      assert.equal((await uploadUserWorker(env, { slug: "abc", modules: [{ name: "i.mjs", content: "" }], compatibilityDate: "2026-09-01" }, f)).error, "not_configured");
    }
    assert.equal(calls.length, 0);
  });
});

describe("ensureNamespace", () => {
  it("POST /accounts/:id/workers/dispatch/namespaces {name}", async () => {
    const { f, calls } = mockFetch(() => ({ body: { success: true, result: { namespace_name: HOSTING_NAMESPACE } } }));
    const r = await ensureNamespace(ENV, f);
    assert.deepEqual(r, { ok: true, value: { name: HOSTING_NAMESPACE, created: true } });
    assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc1/workers/dispatch/namespaces");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: "simsa-hosted" });
    assert.equal(calls[0].init.headers.authorization, "Bearer tok-SECRET-123");
  });
  it("이미 있으면 created:false로 성공(멱등)", async () => {
    const { f } = mockFetch(() => ({ status: 409, body: { success: false, errors: [{ code: 10076, message: "A namespace with this name already exists." }] } }));
    assert.deepEqual(await ensureNamespace(ENV, f), { ok: true, value: { name: HOSTING_NAMESPACE, created: false } });
  });
  it("권한 오류는 cf_error + code, 토큰은 결과 어디에도 없음", async () => {
    const { f } = mockFetch(() => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }));
    const r = await ensureNamespace(ENV, f);
    assert.equal(r.ok, false);
    assert.equal(r.error, "cf_error");
    assert.equal(r.status, 403);
    assert.deepEqual(r.cfErrors, [{ code: 10000, message: "Authentication error" }]);
    assert.ok(!JSON.stringify(r).includes("tok-SECRET"));
  });
  it("네트워크 예외 → network", async () => {
    const r = await ensureNamespace(ENV, async () => { throw new Error("ECONNRESET"); });
    assert.equal(r.error, "network");
    assert.match(r.message, /ECONNRESET/);
  });
});

describe("createProjectD1 (D-12)", () => {
  it("POST /d1/database {name: simsa-hosted-<slug>} → uuid", async () => {
    const { f, calls } = mockFetch(() => ({ body: { success: true, result: { uuid: "d1-uuid-1", name: "simsa-hosted-app-abc" } } }));
    const r = await createProjectD1(ENV, "app-abc", f);
    assert.deepEqual(r, { ok: true, value: { id: "d1-uuid-1", name: "simsa-hosted-app-abc" } });
    assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc1/d1/database");
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: "simsa-hosted-app-abc" });
  });
  it("잘못된 slug는 요청 전에 거부", async () => {
    const { f, calls } = mockFetch();
    for (const bad of ["A", "-abc", "abc-", "a--b", "한글", "a.b"]) {
      assert.equal((await createProjectD1(ENV, bad, f)).message, "invalid_slug", bad);
    }
    assert.equal(calls.length, 0);
  });
});

describe("uploadUserWorker", () => {
  it("buildUploadMetadata: main_module · compatibility_date · d1 DB 바인딩 · plain_text vars · 태그", () => {
    assert.deepEqual(buildUploadMetadata({ mainModule: "index.mjs", compatibilityDate: "2026-09-01", d1Id: "u1", vars: { APP_NAME: "빵집" } }), {
      main_module: "index.mjs",
      compatibility_date: "2026-09-01",
      bindings: [{ type: "d1", name: "DB", id: "u1" }, { type: "plain_text", name: "APP_NAME", text: "빵집" }],
      tags: ["simsa-hosted"],
    });
    assert.deepEqual(buildUploadMetadata({ mainModule: "m.mjs", compatibilityDate: "d" }).bindings, []);
  });
  it("PUT …/dispatch/namespaces/simsa-hosted/scripts/<slug> multipart: metadata + 모듈 파일", async () => {
    const { f, calls } = mockFetch();
    const r = await uploadUserWorker(ENV, {
      slug: "app-abc",
      modules: [{ name: "index.mjs", content: "export default { fetch() { return new Response('hi') } }" }, { name: "assets.json", content: "{}", type: "application/json" }],
      compatibilityDate: "2026-09-01",
      d1Id: "u1",
    }, f);
    assert.deepEqual(r, { ok: true, value: { slug: "app-abc" } });
    const c = calls[0];
    assert.equal(c.url, "https://api.cloudflare.com/client/v4/accounts/acc1/workers/dispatch/namespaces/simsa-hosted/scripts/app-abc");
    assert.equal(c.init.method, "PUT");
    assert.ok(c.init.body instanceof FormData);
    const meta = JSON.parse(await c.init.body.get("metadata").text());
    assert.equal(meta.main_module, "index.mjs");
    assert.deepEqual(meta.bindings, [{ type: "d1", name: "DB", id: "u1" }]);
    const main = c.init.body.get("index.mjs");
    assert.equal(main.type, "application/javascript+module");
    assert.match(await main.text(), /Response\('hi'\)/);
    assert.equal(c.init.body.get("assets.json").type, "application/json");
  });
  it("모듈 0개·잘못된 slug는 요청 전에 거부", async () => {
    const { f, calls } = mockFetch();
    assert.equal((await uploadUserWorker(ENV, { slug: "app-abc", modules: [], compatibilityDate: "d" }, f)).message, "no_modules");
    assert.equal((await uploadUserWorker(ENV, { slug: "www.x", modules: [{ name: "a", content: "" }], compatibilityDate: "d" }, f)).message, "invalid_slug");
    assert.equal(calls.length, 0);
  });
});

describe("deleteUserWorker", () => {
  it("DELETE, 404는 existed:false 성공(멱등)", async () => {
    const ok = mockFetch();
    assert.deepEqual(await deleteUserWorker(ENV, "app-abc", ok.f), { ok: true, value: { slug: "app-abc", existed: true } });
    assert.equal(ok.calls[0].init.method, "DELETE");
    const gone = mockFetch(() => ({ status: 404, body: { success: false, errors: [{ code: 10007, message: "not found" }] } }));
    assert.deepEqual(await deleteUserWorker(ENV, "app-abc", gone.f), { ok: true, value: { slug: "app-abc", existed: false } });
  });
});
