/**
 * SI 티어 Train B — B3: S 모드 저장소 프로비저닝 (D-5).
 *
 * 프로젝트당 **Simsa GitHub 조직에 private 저장소를 자동 생성**하고(유저 클릭 0), 템플릿 스캐폴드를
 * 첫 커밋으로 넣는다. 유저는 언제든 zip 다운로드·"내 GitHub로 가져가기"(B9)가 가능하다.
 *
 * 자격: 기존 GitHub App(GH_APP_ID·GH_APP_PRIVATE_KEY)의 **조직 설치 토큰**. 유저 토큰은 없다.
 *   필요 권한(App 설정, Bae 액션): Repository → Administration: write(생성) · Contents: write(커밋).
 *   조직은 env `HOSTING_GH_ORG`(기본 "simsa-hosted", D-5). 조직이 없거나 App 미설치면 `not_installed`로
 *   정직하게 실패한다 — 예시 저장소를 꾸미지 않는다.
 *
 * 커밋은 git clone 없이 **Git Data API**(blob → tree → commit → ref)로 만든다. Worker에는 git이 없고,
 * 컨테이너를 띄울 이유도 없다(파일 수십 개).
 *
 * `fetch`는 주입(seam) — 테스트는 요청 모양을 고정한다. 토큰은 로그·에러에 싣지 않는다.
 */
import type { Env } from "../env.js";
import { mintAppJwt, getInstallationToken } from "../gh-app.js";

const GITHUB_API = "https://api.github.com";
export const DEFAULT_HOSTING_GH_ORG = "simsa-hosted";

type FetchLike = typeof fetch;

export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "not_configured" | "not_installed" | "gh_error" | "network"; status?: number; message?: string };

export type ScaffoldFile = { path: string; content: string; executable?: boolean };

/** 저장소 이름 = `<slug>` (조직이 simsa-hosted이므로 `simsa-hosted/<slug>`). 슬러그 규칙은 hosting-provision과 동일. */
export const REPO_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export function hostingOrg(env: Pick<Env, "HOSTING_GH_ORG">): string {
  const v = (env.HOSTING_GH_ORG ?? "").trim();
  return v || DEFAULT_HOSTING_GH_ORG;
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "simsa-hosting",
    ...extra,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const b: unknown = await res.json().catch(() => null);
  return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
}

function ghErr<T>(res: Response, body: Record<string, unknown>): RepoResult<T> {
  return { ok: false, error: "gh_error", status: res.status, message: String(body["message"] ?? "").slice(0, 200) };
}

/**
 * 조직 설치 토큰. App JWT → `GET /orgs/{org}/installation` → 설치 토큰(60분).
 * 404 = 조직이 없거나 App이 그 조직에 설치되지 않음 → `not_installed`.
 */
export async function getOrgInstallationToken(env: Env, fetchImpl: FetchLike = fetch): Promise<RepoResult<{ token: string; installationId: number; org: string }>> {
  if (!env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY) return { ok: false, error: "not_configured" };
  const org = hostingOrg(env);
  let jwt: string;
  try {
    jwt = await mintAppJwt(env);
  } catch (err) {
    return { ok: false, error: "not_configured", message: String((err as Error)?.message ?? err).slice(0, 120) };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${GITHUB_API}/orgs/${encodeURIComponent(org)}/installation`, { headers: headers(jwt) });
  } catch (err) {
    return { ok: false, error: "network", message: String((err as Error)?.message ?? err).slice(0, 200) };
  }
  const body = await readJson(res);
  if (res.status === 404) return { ok: false, error: "not_installed", status: 404, message: `GitHub App not installed on org ${org}` };
  if (!res.ok) return ghErr(res, body);
  const installationId = typeof body["id"] === "number" ? body["id"] : NaN;
  if (!Number.isFinite(installationId)) return { ok: false, error: "gh_error", status: res.status, message: "installation id missing" };
  try {
    const t = await getInstallationToken(env, installationId, fetchImpl);
    return { ok: true, value: { token: t.token, installationId, org } };
  } catch (err) {
    return { ok: false, error: "gh_error", message: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/**
 * private 저장소 생성(멱등: 이미 있으면 그대로 성공, `created:false`).
 * `auto_init:false` — 첫 커밋은 우리 스캐폴드여야 한다(GitHub 기본 README가 섞이지 않게).
 */
export async function ensureHostedRepo(
  env: Env,
  args: { slug: string; description?: string },
  fetchImpl: FetchLike = fetch,
): Promise<RepoResult<{ org: string; name: string; fullName: string; htmlUrl: string; created: boolean; token: string }>> {
  if (!REPO_NAME_RE.test(args.slug)) return { ok: false, error: "gh_error", message: "invalid_slug" };
  const auth = await getOrgInstallationToken(env, fetchImpl);
  if (!auth.ok) return auth;
  const { token, org } = auth.value;
  const get = await fetchImpl(`${GITHUB_API}/repos/${org}/${args.slug}`, { headers: headers(token) }).catch(() => null);
  if (get && get.ok) {
    const b = await readJson(get);
    return { ok: true, value: { org, name: args.slug, fullName: String(b["full_name"] ?? `${org}/${args.slug}`), htmlUrl: String(b["html_url"] ?? ""), created: false, token } };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${GITHUB_API}/orgs/${encodeURIComponent(org)}/repos`, {
      method: "POST",
      headers: headers(token, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: args.slug,
        description: (args.description ?? "Simsa hosted app").slice(0, 300),
        private: true,
        auto_init: false,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      }),
    });
  } catch (err) {
    return { ok: false, error: "network", message: String((err as Error)?.message ?? err).slice(0, 200) };
  }
  const body = await readJson(res);
  if (!res.ok) return ghErr(res, body);
  return { ok: true, value: { org, name: args.slug, fullName: String(body["full_name"] ?? `${org}/${args.slug}`), htmlUrl: String(body["html_url"] ?? ""), created: true, token } };
}

/**
 * 스캐폴드를 한 커밋으로 push (Git Data API). 빈 저장소면 부모 없는 첫 커밋 + `refs/heads/main` 생성,
 * 아니면 main 위에 커밋. 파일은 blob(base64) → tree → commit → ref 순.
 */
export async function pushScaffold(
  args: { token: string; org: string; name: string; files: ScaffoldFile[]; message: string; branch?: string },
  fetchImpl: FetchLike = fetch,
): Promise<RepoResult<{ commitSha: string; treeSha: string; fileCount: number; branch: string }>> {
  const branch = args.branch ?? "main";
  const base = `${GITHUB_API}/repos/${args.org}/${args.name}`;
  const h = headers(args.token, { "content-type": "application/json" });
  const post = async (path: string, payload: unknown): Promise<Record<string, unknown> & { __status: number }> => {
    const res = await fetchImpl(`${base}${path}`, { method: "POST", headers: h, body: JSON.stringify(payload) });
    const body = await readJson(res);
    return { ...body, __status: res.status };
  };
  try {
    // 현재 main이 있으면 그 위에(있을 때만 parent) — 없으면 첫 커밋.
    const refRes = await fetchImpl(`${base}/git/ref/heads/${branch}`, { headers: headers(args.token) });
    const refBody = await readJson(refRes);
    const parentSha = refRes.ok ? String((refBody["object"] as Record<string, unknown> | undefined)?.["sha"] ?? "") : "";

    const tree: Array<{ path: string; mode: "100644" | "100755"; type: "blob"; sha: string }> = [];
    for (const f of args.files) {
      const blob = await post("/git/blobs", { content: toBase64Utf8(f.content), encoding: "base64" });
      if (blob.__status >= 300 || typeof blob["sha"] !== "string") return { ok: false, error: "gh_error", status: blob.__status, message: `blob ${f.path}: ${String(blob["message"] ?? "").slice(0, 120)}` };
      tree.push({ path: f.path, mode: f.executable ? "100755" : "100644", type: "blob", sha: blob["sha"] });
    }
    const treeRes = await post("/git/trees", { tree });
    if (treeRes.__status >= 300 || typeof treeRes["sha"] !== "string") return { ok: false, error: "gh_error", status: treeRes.__status, message: `tree: ${String(treeRes["message"] ?? "").slice(0, 120)}` };
    const commitRes = await post("/git/commits", {
      message: args.message,
      tree: treeRes["sha"],
      parents: parentSha ? [parentSha] : [],
      author: { name: "Simsa", email: "build@simsa.page" },
    });
    if (commitRes.__status >= 300 || typeof commitRes["sha"] !== "string") return { ok: false, error: "gh_error", status: commitRes.__status, message: `commit: ${String(commitRes["message"] ?? "").slice(0, 120)}` };
    const commitSha = commitRes["sha"];
    if (parentSha) {
      const upd = await fetchImpl(`${base}/git/refs/heads/${branch}`, { method: "PATCH", headers: h, body: JSON.stringify({ sha: commitSha, force: false }) });
      if (!upd.ok) return ghErr(upd, await readJson(upd));
    } else {
      const created = await post("/git/refs", { ref: `refs/heads/${branch}`, sha: commitSha });
      if (created.__status >= 300) return { ok: false, error: "gh_error", status: created.__status, message: `ref: ${String(created["message"] ?? "").slice(0, 120)}` };
    }
    return { ok: true, value: { commitSha, treeSha: treeRes["sha"], fileCount: args.files.length, branch } };
  } catch (err) {
    return { ok: false, error: "network", message: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/** UTF-8 안전 base64(한글 파일 내용 — Rule 6). */
export function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
