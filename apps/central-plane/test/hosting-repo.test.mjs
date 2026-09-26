/**
 * SI 티어 Train B — B3: 저장소 프로비저닝. fetch 주입, 네트워크 0.
 * 요청 순서·모양(설치 토큰 → 저장소 생성 → blob/tree/commit/ref)을 고정하고 토큰 누출 0을 확인한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { hostingOrg, ensureHostedRepo, pushScaffold, getOrgInstallationToken, toBase64Utf8, REPO_NAME_RE, DEFAULT_HOSTING_GH_ORG } =
  await import("../dist/workspace/hosting-repo.js");

// gh-app.ts mintAppJwt는 실제 RSA 키가 필요하다 — 테스트용 2048비트 키를 한 번 만든다(네트워크 없음).
import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const ENV = { GH_APP_ID: "12345", GH_APP_PRIVATE_KEY: PEM, HOSTING_GH_ORG: "simsa-hosted" };
const TOKEN = "ghs_INSTALL_SECRET";

/** 경로별 응답을 정하는 가짜 GitHub. 호출 기록을 남긴다. */
function fakeGitHub(overrides = {}) {
  const calls = [];
  const blobs = new Map();
  const routes = {
    "GET /orgs/simsa-hosted/installation": () => ({ status: 200, body: { id: 777 } }),
    "POST /app/installations/777/access_tokens": () => ({ status: 201, body: { token: TOKEN, expires_at: "2030-01-01T00:00:00Z" } }),
    "GET /repos/simsa-hosted/app-abc": () => ({ status: 404, body: { message: "Not Found" } }),
    "POST /orgs/simsa-hosted/repos": (init) => ({ status: 201, body: { full_name: "simsa-hosted/app-abc", html_url: "https://github.com/simsa-hosted/app-abc", private: JSON.parse(init.body).private } }),
    "GET /repos/simsa-hosted/app-abc/git/ref/heads/main": () => ({ status: 404, body: { message: "Not Found" } }),
    "POST /repos/simsa-hosted/app-abc/git/blobs": (init) => { const b = JSON.parse(init.body); const sha = "blob" + blobs.size; blobs.set(sha, b); return { status: 201, body: { sha } }; },
    "POST /repos/simsa-hosted/app-abc/git/trees": () => ({ status: 201, body: { sha: "tree1" } }),
    "POST /repos/simsa-hosted/app-abc/git/commits": () => ({ status: 201, body: { sha: "commit1" } }),
    "POST /repos/simsa-hosted/app-abc/git/refs": () => ({ status: 201, body: { ref: "refs/heads/main" } }),
    ...overrides,
  };
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    calls.push({ key, init });
    const r = routes[key] ? routes[key](init) : { status: 500, body: { message: `unrouted ${key}` } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { f, calls, blobs };
}

describe("hostingOrg · REPO_NAME_RE · toBase64Utf8", () => {
  it("기본 조직은 simsa-hosted(D-5), env로 덮음", () => {
    assert.equal(hostingOrg({}), DEFAULT_HOSTING_GH_ORG);
    assert.equal(hostingOrg({ HOSTING_GH_ORG: " 3SVS " }), "3SVS");
  });
  it("슬러그 규칙은 hosting-provision과 같다", async () => {
    const { SLUG_RE } = await import("../dist/workspace/hosting-provision.js");
    assert.equal(REPO_NAME_RE.toString(), SLUG_RE.toString());
  });
  it("한글 파일 내용도 base64 왕복 (Rule 6)", () => {
    const s = "동네 빵집 픽업 예약 — README\n";
    assert.equal(Buffer.from(toBase64Utf8(s), "base64").toString("utf8"), s);
  });
});

describe("getOrgInstallationToken", () => {
  it("미설정 → not_configured (fetch 호출 0)", async () => {
    const g = fakeGitHub();
    assert.deepEqual(await getOrgInstallationToken({}, g.f), { ok: false, error: "not_configured" });
    assert.equal(g.calls.length, 0);
  });
  it("JWT로 조직 설치 조회 → 설치 토큰", async () => {
    const g = fakeGitHub();
    const r = await getOrgInstallationToken(ENV, g.f);
    assert.deepEqual(r, { ok: true, value: { token: TOKEN, installationId: 777, org: "simsa-hosted" } });
    assert.equal(g.calls[0].key, "GET /orgs/simsa-hosted/installation");
    assert.match(g.calls[0].init.headers.authorization, /^Bearer eyJ/);
    assert.equal(g.calls[1].key, "POST /app/installations/777/access_tokens");
  });
  it("조직에 App 미설치(404) → not_installed, 토큰 발급 시도 없음", async () => {
    const g = fakeGitHub({ "GET /orgs/simsa-hosted/installation": () => ({ status: 404, body: { message: "Not Found" } }) });
    const r = await getOrgInstallationToken(ENV, g.f);
    assert.equal(r.error, "not_installed");
    assert.equal(g.calls.length, 1);
  });
});

describe("ensureHostedRepo", () => {
  it("없으면 private 저장소 생성(auto_init false) — created:true", async () => {
    const g = fakeGitHub();
    const r = await ensureHostedRepo(ENV, { slug: "app-abc", description: "동네 빵집 픽업 예약" }, g.f);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.value.created, true);
    assert.equal(r.value.fullName, "simsa-hosted/app-abc");
    const create = g.calls.find((c) => c.key === "POST /orgs/simsa-hosted/repos");
    const body = JSON.parse(create.init.body);
    assert.equal(body.private, true);
    assert.equal(body.auto_init, false);
    assert.equal(body.name, "app-abc");
    assert.equal(create.init.headers.authorization, `Bearer ${TOKEN}`);
  });
  it("이미 있으면 created:false (멱등)", async () => {
    const g = fakeGitHub({ "GET /repos/simsa-hosted/app-abc": () => ({ status: 200, body: { full_name: "simsa-hosted/app-abc", html_url: "https://github.com/simsa-hosted/app-abc" } }) });
    const r = await ensureHostedRepo(ENV, { slug: "app-abc" }, g.f);
    assert.equal(r.value.created, false);
    assert.ok(!g.calls.some((c) => c.key === "POST /orgs/simsa-hosted/repos"));
  });
  it("권한 부족(403)은 gh_error + 메시지, 토큰은 결과에 없음", async () => {
    const g = fakeGitHub({ "POST /orgs/simsa-hosted/repos": () => ({ status: 403, body: { message: "Resource not accessible by integration" } }) });
    const r = await ensureHostedRepo(ENV, { slug: "app-abc" }, g.f);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.match(r.message, /not accessible/);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });
  it("잘못된 slug는 요청 전에 거부", async () => {
    const g = fakeGitHub();
    assert.equal((await ensureHostedRepo(ENV, { slug: "Bad Slug" }, g.f)).message, "invalid_slug");
    assert.equal(g.calls.length, 0);
  });
});

describe("pushScaffold (Git Data API)", () => {
  const files = [
    { path: "package.json", content: '{"name":"x"}' },
    { path: "src/worker.ts", content: "export default {}" },
    { path: "README.md", content: "# 동네 빵집 픽업 예약\n" },
    { path: "scripts/run.sh", content: "#!/bin/sh\n", executable: true },
  ];
  it("빈 저장소: blob×N → tree → 부모 없는 commit → refs/heads/main 생성", async () => {
    const g = fakeGitHub();
    const r = await pushScaffold({ token: TOKEN, org: "simsa-hosted", name: "app-abc", files, message: "scaffold" }, g.f);
    assert.deepEqual(r, { ok: true, value: { commitSha: "commit1", treeSha: "tree1", fileCount: 4, branch: "main" } });
    const keys = g.calls.map((c) => c.key);
    assert.equal(keys.filter((k) => k.endsWith("/git/blobs")).length, 4);
    const tree = JSON.parse(g.calls.find((c) => c.key.endsWith("/git/trees")).init.body).tree;
    assert.deepEqual(tree.map((t) => [t.path, t.mode]), [["package.json", "100644"], ["src/worker.ts", "100644"], ["README.md", "100644"], ["scripts/run.sh", "100755"]]);
    const commit = JSON.parse(g.calls.find((c) => c.key.endsWith("/git/commits")).init.body);
    assert.deepEqual(commit.parents, []);
    assert.equal(commit.tree, "tree1");
    assert.equal(keys.at(-1), "POST /repos/simsa-hosted/app-abc/git/refs");
    // 한글 README가 blob으로 온전히 갔는가
    const readme = [...g.blobs.values()].find((b) => Buffer.from(b.content, "base64").toString("utf8").includes("빵집"));
    assert.ok(readme, "korean README blob");
  });
  it("main이 있으면 parent 붙이고 PATCH refs/heads/main", async () => {
    const g = fakeGitHub({
      "GET /repos/simsa-hosted/app-abc/git/ref/heads/main": () => ({ status: 200, body: { object: { sha: "old1" } } }),
      "PATCH /repos/simsa-hosted/app-abc/git/refs/heads/main": () => ({ status: 200, body: { object: { sha: "commit1" } } }),
    });
    const r = await pushScaffold({ token: TOKEN, org: "simsa-hosted", name: "app-abc", files: files.slice(0, 1), message: "update" }, g.f);
    assert.equal(r.ok, true, JSON.stringify(r));
    const commit = JSON.parse(g.calls.find((c) => c.key.endsWith("/git/commits")).init.body);
    assert.deepEqual(commit.parents, ["old1"]);
    assert.equal(g.calls.at(-1).key, "PATCH /repos/simsa-hosted/app-abc/git/refs/heads/main");
  });
  it("blob 실패는 어느 파일인지 말한다", async () => {
    const g = fakeGitHub({ "POST /repos/simsa-hosted/app-abc/git/blobs": () => ({ status: 422, body: { message: "too large" } }) });
    const r = await pushScaffold({ token: TOKEN, org: "simsa-hosted", name: "app-abc", files, message: "m" }, g.f);
    assert.equal(r.ok, false);
    assert.match(r.message, /blob package\.json: too large/);
  });
});
