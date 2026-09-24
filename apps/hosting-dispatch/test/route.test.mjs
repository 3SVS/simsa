/**
 * SI 티어 Train B — B2: 호스팅 라우터. 순수 판단(decideRoute) + HTTP 껍데기(handle, DISPATCHER 모크).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { decideRoute, isValidSlug, SLUG_RE, RESERVED_SLUGS } = await import("../dist/route.js");
const { handle } = await import("../dist/index.js");

const ROOT = "simsa.app";

describe("decideRoute", () => {
  it("<slug>.<root> → dispatch", () => {
    assert.deepEqual(decideRoute("app-d3lmln10.simsa.app", ROOT), { kind: "dispatch", slug: "app-d3lmln10" });
    assert.deepEqual(decideRoute("Bakery-Pickup-1.SIMSA.app.", ROOT), { kind: "dispatch", slug: "bakery-pickup-1" });
  });
  it("미설정 도메인 → not_configured", () => {
    assert.deepEqual(decideRoute("x.simsa.app", ""), { kind: "not_configured" });
    assert.deepEqual(decideRoute("x.simsa.app", "  "), { kind: "not_configured" });
  });
  it("루트·다른 도메인·중첩·예약어·잘못된 slug → not_hosted(이유)", () => {
    assert.equal(decideRoute("simsa.app", ROOT).reason, "root");
    assert.equal(decideRoute("abc.evil-simsa.app", ROOT).reason, "other_domain");
    assert.equal(decideRoute("abc.simsa.app.evil.com", ROOT).reason, "other_domain");
    assert.equal(decideRoute("a.bcd.simsa.app", ROOT).reason, "nested");
    for (const r of ["www", "api", "admin", "login", "billing"]) assert.equal(decideRoute(`${r}.simsa.app`, ROOT).reason, "reserved", r);
    for (const bad of ["ab", "-abc", "abc-", "a--bc", "xn--hangul", "a".repeat(41)]) assert.equal(decideRoute(`${bad}.simsa.app`, ROOT).reason, "invalid_slug", bad);
  });
  it("정지된 slug → suspended (B7 꽂는 자리)", () => {
    assert.deepEqual(decideRoute("bad-app.simsa.app", ROOT, (s) => s === "bad-app"), { kind: "suspended", slug: "bad-app" });
  });
  it("isValidSlug = 정규식 && 예약어 아님", () => {
    assert.equal(isValidSlug("app-d3lmln10"), true);
    assert.equal(isValidSlug("www"), false);
    assert.equal(isValidSlug("a--b"), false);
  });
});

describe("handle (DISPATCHER 모크)", () => {
  const env = (impl) => ({ HOSTING_ROOT_DOMAIN: ROOT, DISPATCHER: { get: impl } });
  const req = (host, p = "/") => new Request(`https://${host}${p}`);

  it("정상: 유저 Worker 응답 + x-simsa-hosted 헤더", async () => {
    let asked = null;
    const r = await handle(req("app-abc.simsa.app", "/menu"), env((name) => { asked = name; return { fetch: async (rq) => new Response(`hello ${new URL(rq.url).pathname}`, { status: 201 }) }; }));
    assert.equal(asked, "app-abc");
    assert.equal(r.status, 201);
    assert.equal(await r.text(), "hello /menu");
    assert.equal(r.headers.get("x-simsa-hosted"), "app-abc");
  });
  it("네임스페이스에 없음 → 404 app not deployed yet", async () => {
    const r = await handle(req("app-abc.simsa.app"), env(() => { throw new Error("Worker not found: app-abc"); }));
    assert.equal(r.status, 404);
    assert.match(await r.text(), /not deployed/);
  });
  it("유저 Worker 예외 → 502 (라우터 오류와 구분)", async () => {
    const r = await handle(req("app-abc.simsa.app"), env(() => ({ fetch: async () => { throw new Error("boom"); } })));
    assert.equal(r.status, 502);
    assert.match(await r.text(), /the app failed/);
  });
  it("미설정 503 · 호스팅 아님 404 · 정지 410", async () => {
    assert.equal((await handle(req("app-abc.simsa.app"), { DISPATCHER: { get() { throw new Error("x"); } } })).status, 503);
    assert.equal((await handle(req("www.simsa.app"), env(() => { throw new Error("should not dispatch"); }))).status, 404);
    const s = await handle(req("bad-app.simsa.app"), env(() => { throw new Error("should not dispatch"); }), (x) => x === "bad-app");
    assert.equal(s.status, 410);
    assert.equal(s.headers.get("x-simsa-hosted"), "bad-app");
  });
});

describe("lock-step with central-plane provisioning", () => {
  it("SLUG_RE는 central-plane hosting-provision.ts와 같은 정규식", () => {
    const HERE = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(HERE, "../../central-plane/src/workspace/hosting-provision.ts"), "utf8");
    const m = /export const SLUG_RE = (\/.+\/);/.exec(src);
    assert.ok(m, "hosting-provision.ts must export SLUG_RE literal");
    assert.equal(m[1], SLUG_RE.toString());
  });
  it("예약어에 피싱 표면(login·billing·pay·auth·admin)이 들어 있다", () => {
    for (const r of ["login", "billing", "pay", "auth", "admin", "api", "www"]) assert.ok(RESERVED_SLUGS.has(r), r);
  });
});
