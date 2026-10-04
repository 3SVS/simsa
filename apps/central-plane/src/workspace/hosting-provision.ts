/**
 * SI 티어 Train B — B2: S 모드 호스팅 프로비저닝 클라이언트 (D-6 · D-12).
 *
 * 우리 Cloudflare 계정 API로:
 *   - dispatch namespace 보장(있으면 그대로)
 *   - 프로젝트당 D1 하나 생성(`simsa-hosted-<slug>`)
 *   - 유저 Worker 업로드(multipart: metadata{main_module, compatibility_date, bindings[d1, plain_text]} + 모듈 파일들)
 *   - 유저 Worker 삭제 / D1 삭제(프로젝트 삭제 시)
 *
 * 규칙:
 *  - **운영 자격만 쓴다**(env `HOSTING_CF_API_TOKEN` + `HOSTING_CF_ACCOUNT_ID`). 유저 토큰 경로는 없다(D-6).
 *  - 토큰은 로그·에러 문자열에 절대 싣지 않는다. 에러는 Cloudflare `errors[].code/message`만.
 *  - `fetch`는 주입(seam) — 테스트는 네트워크 없이 요청 모양을 고정한다.
 *  - 멱등: namespace "already exists"는 성공 취급, 업로드는 PUT(같은 이름 덮어쓰기).
 *  - 슬러그 규칙은 apps/hosting-dispatch/src/route.ts와 **동일**(테스트가 둘을 함께 고정).
 */

export const HOSTING_NAMESPACE = "simsa-hosted";
export const HOSTED_D1_PREFIX = "simsa-hosted-";
/** 네임스페이스가 이미 있을 때 Cloudflare가 돌려주는 코드(라이브 실측 2026-09-25). */
export const NAMESPACE_EXISTS_CODE = 100120;
const API = "https://api.cloudflare.com/client/v4";

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

/**
 * 프로젝트 제목·id → 호스팅 slug. 결정론. 한글 제목은 ASCII로 못 바꾸므로 id 조각을 쓴다(Rule 6:
 * 키는 ASCII로 정규화, 표시용 원본명은 따로 보존). 예약어·짧은 결과면 `app-<id>`.
 */
export function toHostedSlug(title: string, projectId: string, reserved: ReadonlySet<string>): string {
  const idPart = projectId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8) || "x";
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28)
    .replace(/-$/g, "");
  const candidate = base.length >= 3 ? `${base}-${idPart}` : `app-${idPart}`;
  const trimmed = candidate.slice(0, 40).replace(/-$/g, "");
  if (SLUG_RE.test(trimmed) && !reserved.has(trimmed)) return trimmed;
  return `app-${idPart}`.slice(0, 40);
}

export type ProvisionEnv = {
  HOSTING_CF_API_TOKEN?: string;
  HOSTING_CF_ACCOUNT_ID?: string;
};

export type CfError = { code: number; message: string };
export type ProvisionResult<T> = { ok: true; value: T } | { ok: false; error: "not_configured" | "cf_error" | "network"; status?: number; cfErrors?: CfError[]; message?: string };

/** content: 문자열(JS·텍스트) 또는 바이트(wasm — B-5b-4 산출물의 추가 모듈). */
export type UserWorkerModule = { name: string; content: string | Uint8Array; type?: "application/javascript+module" | "text/plain" | "application/json" | "application/wasm" };

/**
 * B-5b-4: 호스팅 앱의 배포 설정은 **Worker 상수**다 — 컨테이너(생성 코드가 돈 곳)가 보낸 값을 쓰지 않는다. 템플릿
 * wrangler.toml(보호 파일)과 같은 값이어야 한다(test/train-b-b5b-s3-deploy.test.mjs가 두 쪽을 비교).
 */
export const HOSTED_COMPATIBILITY_DATE = "2026-09-01";
/** 템플릿 wrangler.toml [assets]: SPA 폴백 + `/api/*`는 Worker 먼저. binding 이름은 ASSETS. */
export const HOSTED_ASSETS_CONFIG = Object.freeze({ not_found_handling: "single-page-application", run_worker_first: Object.freeze(["/api/*"]) });
export const HOSTED_ASSETS_BINDING = "ASSETS";
/** wrangler 기본(d1 migrations apply)과 같은 기록 테이블 — 개발자가 `wrangler d1 migrations list`로 봐도 같은 이력. */
export const D1_MIGRATIONS_TABLE = "d1_migrations";
/** build-artifact.ts MIGRATION_NAME_RE와 같다(여기서 한 번 더 — 이름이 SQL 문자열에 들어간다). */
const MIGRATION_NAME_RE = /^[0-9]{4}_[A-Za-z0-9_-]{1,80}\.sql$/;
/** D1 uuid(templates/…/wrangler.toml·createProjectD1 결과). URL 경로에 들어간다. */
const D1_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function creds(env: ProvisionEnv): { token: string; account: string } | null {
  const token = env.HOSTING_CF_API_TOKEN?.trim();
  const account = env.HOSTING_CF_ACCOUNT_ID?.trim();
  return token && account ? { token, account } : null;
}

function cfErrors(body: unknown): CfError[] {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errs = Array.isArray(b["errors"]) ? b["errors"] : [];
  return errs
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({ code: typeof e["code"] === "number" ? e["code"] : 0, message: String(e["message"] ?? "").slice(0, 200) }));
}

async function call<T>(fetchImpl: FetchLike, url: string, init: RequestInit, pick: (result: unknown) => T): Promise<ProvisionResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    return { ok: false, error: "network", message: String((err as Error)?.message ?? err).slice(0, 200) };
  }
  const body: unknown = await res.json().catch(() => null);
  const success = typeof body === "object" && body !== null && (body as Record<string, unknown>)["success"] === true;
  if (!res.ok || !success) return { ok: false, error: "cf_error", status: res.status, cfErrors: cfErrors(body) };
  return { ok: true, value: pick((body as Record<string, unknown>)["result"]) };
}

/** dispatch namespace 보장. 이미 있으면 성공(멱등). */
export async function ensureNamespace(env: ProvisionEnv, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ name: string; created: boolean }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  const r = await call(fetchImpl, `${API}/accounts/${c.account}/workers/dispatch/namespaces`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: HOSTING_NAMESPACE }),
  }, () => ({ name: HOSTING_NAMESPACE, created: true }));
  // 라이브 실측(2026-09-25): 이미 있으면 400 + code 100120 "Invalid dispatch namespace name. Ensure it does
  // not already exist and …". 메시지가 "already exists"가 아니라 "already exist"다 — 코드로 판정한다.
  if (!r.ok && r.error === "cf_error" && (r.cfErrors ?? []).some((e) => e.code === NAMESPACE_EXISTS_CODE || /already exist/i.test(e.message))) {
    return { ok: true, value: { name: HOSTING_NAMESPACE, created: false } };
  }
  return r;
}

/** 프로젝트당 D1 하나 (D-12). 이름 `simsa-hosted-<slug>`. */
export async function createProjectD1(env: ProvisionEnv, slug: string, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ id: string; name: string }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!SLUG_RE.test(slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  const name = `${HOSTED_D1_PREFIX}${slug}`;
  return call(fetchImpl, `${API}/accounts/${c.account}/d1/database`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }, (result) => {
    const r = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
    return { id: String(r["uuid"] ?? ""), name };
  });
}

/** 정적 자산을 붙일 때(B-5b-4): 업로드 세션의 완료 JWT + 라우팅 설정. wrangler createWorkerUploadForm과 같은 모양. */
export type UserWorkerAssets = { jwt: string; config: Record<string, unknown> };

/** 업로드 metadata — 순수(테스트로 모양 고정). assets가 있으면 `assets:{jwt,config}` + ASSETS 바인딩(wrangler와 같은 모양). */
export function buildUploadMetadata(args: { mainModule: string; compatibilityDate: string; d1Id?: string; vars?: Record<string, string>; assets?: UserWorkerAssets }): Record<string, unknown> {
  const bindings: Array<Record<string, unknown>> = [];
  if (args.d1Id) bindings.push({ type: "d1", name: "DB", id: args.d1Id });
  for (const [name, text] of Object.entries(args.vars ?? {})) bindings.push({ type: "plain_text", name, text });
  if (args.assets) bindings.push({ type: "assets", name: HOSTED_ASSETS_BINDING });
  return {
    main_module: args.mainModule,
    compatibility_date: args.compatibilityDate,
    bindings,
    tags: ["simsa-hosted"],
    ...(args.assets ? { assets: { jwt: args.assets.jwt, config: args.assets.config } } : {}),
  };
}

/** 유저 Worker 업로드(PUT = 같은 slug 덮어쓰기). modules[0]이 main. */
export async function uploadUserWorker(
  env: ProvisionEnv,
  args: { slug: string; modules: UserWorkerModule[]; compatibilityDate: string; d1Id?: string; vars?: Record<string, string>; assets?: UserWorkerAssets },
  fetchImpl: FetchLike = fetch,
): Promise<ProvisionResult<{ slug: string }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!SLUG_RE.test(args.slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  const main = args.modules[0];
  if (!main) return { ok: false, error: "cf_error", message: "no_modules" };
  const form = new FormData();
  const meta = buildUploadMetadata({ mainModule: main.name, compatibilityDate: args.compatibilityDate, d1Id: args.d1Id, vars: args.vars, assets: args.assets });
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  for (const m of args.modules) {
    form.append(m.name, new Blob([m.content], { type: m.type ?? "application/javascript+module" }), m.name);
  }
  return call(fetchImpl, `${API}/accounts/${c.account}/workers/dispatch/namespaces/${HOSTING_NAMESPACE}/scripts/${args.slug}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${c.token}` },
    body: form,
  }, () => ({ slug: args.slug }));
}

// ─── B-5b-4 (S3): 프로젝트 D1 마이그레이션 · 정적 자산 업로드 ───────────────────────────────────────

/**
 * D1 HTTP API `/query` 한 번. 성공 = 최상위 success:true + 문장 결과마다 success가 false가 아님.
 * 문장 결과 배열을 돌려준다(SELECT의 행을 읽을 때).
 */
async function d1Query(c: { token: string; account: string }, d1Id: string, sql: string, fetchImpl: FetchLike): Promise<ProvisionResult<Array<Record<string, unknown>>>> {
  const r = await call(fetchImpl, `${API}/accounts/${c.account}/d1/database/${d1Id}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  }, (result) => (Array.isArray(result) ? result.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : []));
  if (!r.ok) return r;
  if (r.value.some((s) => s["success"] === false)) return { ok: false, error: "cf_error", message: "statement_failed" };
  return r;
}

/**
 * 프로젝트 D1에 마이그레이션 적용 — wrangler `d1 migrations apply --remote`와 같은 규약(실측: wrangler 4.141.0 소스):
 *   1) `CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at …)`
 *   2) 적용된 이름 읽기
 *   3) 안 된 것만 이름순으로, 파일 하나당 `/query` 한 번: `<SQL>\nINSERT INTO d1_migrations (name) values ('<이름>');`
 * 운영 자격은 Worker secret(HOSTING_CF_API_TOKEN)만 — 컨테이너는 이 호출에 닿지 않는다(D-6). d1Id는 **잡 행**의 값(Worker가
 * 프로비저닝 때 저장) — 산출물에서 받지 않는다. 이름은 MIGRATION_NAME_RE(따옴표 불가)로 다시 확인한다.
 * 실패하면 거기서 멈춘다(앞의 것은 적용된 채 — wrangler와 같다). 토큰은 오류에 싣지 않는다.
 */
export async function applyD1Migrations(
  env: ProvisionEnv,
  d1Id: string,
  migrations: ReadonlyArray<{ name: string; sql: string }>,
  fetchImpl: FetchLike = fetch,
): Promise<ProvisionResult<{ applied: string[]; alreadyApplied: string[] }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!D1_ID_RE.test(d1Id)) return { ok: false, error: "cf_error", message: "invalid_d1_id" };
  for (const m of migrations) if (!MIGRATION_NAME_RE.test(m.name)) return { ok: false, error: "cf_error", message: "invalid_migration_name" };
  if (migrations.length === 0) return { ok: true, value: { applied: [], alreadyApplied: [] } };
  const init = await d1Query(c, d1Id, `CREATE TABLE IF NOT EXISTS ${D1_MIGRATIONS_TABLE}(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`, fetchImpl);
  if (!init.ok) return init;
  const listed = await d1Query(c, d1Id, `SELECT name FROM ${D1_MIGRATIONS_TABLE} ORDER BY id`, fetchImpl);
  if (!listed.ok) return listed;
  const done = new Set<string>();
  for (const stmt of listed.value) {
    const rows = Array.isArray(stmt["results"]) ? stmt["results"] : [];
    for (const row of rows) {
      const name = typeof row === "object" && row !== null ? (row as Record<string, unknown>)["name"] : undefined;
      if (typeof name === "string") done.add(name);
    }
  }
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  for (const m of [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (done.has(m.name)) {
      alreadyApplied.push(m.name);
      continue;
    }
    const r = await d1Query(c, d1Id, `${m.sql}\nINSERT INTO ${D1_MIGRATIONS_TABLE} (name) values ('${m.name}');`, fetchImpl);
    if (!r.ok) return { ...r, message: `${m.name}${r.message ? `:${r.message}` : ""}`.slice(0, 200) };
    applied.push(m.name);
  }
  return { ok: true, value: { applied, alreadyApplied } };
}

/** 정적 자산 파일 하나(업로드용). base64 = 내용, contentType = 확장자로(없으면 null). */
export type HostedAssetFile = { path: string; base64: string; bytes: number };

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", map: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  webmanifest: "application/manifest+json", wasm: "application/wasm", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
};

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function assetContentType(p: string): string | null {
  return ASSET_CONTENT_TYPES[extOf(p)] ?? null;
}

/**
 * 자산 해시(manifest의 hash — 32 hex). **Worker가 내용으로 계산한다**: SHA-256(base64 내용 + 확장자)의 앞 32자.
 * wrangler는 같은 입력을 BLAKE3로 해시한다(실측: wrangler 4.141.0 hashFile) — Workers에는 BLAKE3가 없어 SHA-256을 쓴다.
 * 계정 공용 자산 저장소가 해시로 중복을 거르므로(이미 있는 해시는 buckets에 안 온다) 해시는 **내용 주소**여야 한다 —
 * 그래서 컨테이너가 준 해시를 쓰지 않는다(다른 앱의 자산을 가로채는 길을 막는다).
 */
export async function assetHash(base64: string, p: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64 + extOf(p)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * 정적 자산 업로드(WfP 스크립트용) — wrangler syncAssets와 같은 흐름(실측: wrangler 4.141.0):
 *   1) POST …/workers/dispatch/namespaces/<ns>/scripts/<slug>/assets-upload-session { manifest:{ "/path": {hash,size} } }
 *      → { jwt, buckets: [[hash…]…] } (이미 있는 해시는 빠진다)
 *   2) 버킷마다 POST …/workers/assets/upload?base64=true — Authorization: Bearer <세션 jwt>(운영 토큰이 아니다),
 *      multipart 파트 이름 = 해시, 내용 = base64, 타입 = 콘텐츠 타입(없으면 "application/null" — wrangler와 같은 규약)
 *   3) 마지막 응답의 jwt = 완료 토큰 → uploadUserWorker의 assets.jwt. 올릴 것이 없으면 세션 jwt가 곧 완료 토큰.
 * 파일이 없으면 null(자산 없이 배포). 토큰은 오류에 싣지 않는다.
 */
export async function uploadUserWorkerAssets(
  env: ProvisionEnv,
  args: { slug: string; files: ReadonlyArray<HostedAssetFile> },
  fetchImpl: FetchLike = fetch,
): Promise<ProvisionResult<{ jwt: string; uploaded: number; total: number } | null>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!SLUG_RE.test(args.slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  if (args.files.length === 0) return { ok: true, value: null };
  const manifest: Record<string, { hash: string; size: number }> = {};
  const byHash = new Map<string, HostedAssetFile>();
  for (const f of args.files) {
    const hash = await assetHash(f.base64, f.path);
    manifest[f.path] = { hash, size: f.bytes };
    byHash.set(hash, f);
  }
  const session = await call(fetchImpl, `${API}/accounts/${c.account}/workers/dispatch/namespaces/${HOSTING_NAMESPACE}/scripts/${args.slug}/assets-upload-session`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
  }, (result) => {
    const r = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
    const buckets = Array.isArray(r["buckets"]) ? r["buckets"].map((b) => (Array.isArray(b) ? b.filter((h): h is string => typeof h === "string") : [])) : [];
    return { jwt: typeof r["jwt"] === "string" ? r["jwt"] : "", buckets };
  });
  if (!session.ok) return session;
  if (!session.value.jwt) return { ok: false, error: "cf_error", message: "assets_session_without_jwt" };
  const total = args.files.length;
  const pending = session.value.buckets.filter((b) => b.length > 0);
  if (pending.length === 0) return { ok: true, value: { jwt: session.value.jwt, uploaded: 0, total } };
  let completion = "";
  let uploaded = 0;
  for (const bucket of pending) {
    const form = new FormData();
    for (const hash of bucket) {
      const f = byHash.get(hash);
      if (!f) return { ok: false, error: "cf_error", message: "assets_unknown_hash" };
      form.append(hash, new File([f.base64], hash, { type: assetContentType(f.path) ?? "application/null" }), hash);
    }
    const r = await call(fetchImpl, `${API}/accounts/${c.account}/workers/assets/upload?base64=true`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.value.jwt}` },
      body: form,
    }, (result) => {
      const x = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
      return typeof x["jwt"] === "string" ? x["jwt"] : "";
    });
    if (!r.ok) return { ...r, message: "assets_upload_failed" };
    if (r.value) completion = r.value;
    uploaded += bucket.length;
  }
  if (!completion) return { ok: false, error: "cf_error", message: "assets_upload_incomplete" };
  return { ok: true, value: { jwt: completion, uploaded, total } };
}

/** 유저 Worker 삭제(프로젝트 삭제·정지 해제 불가 시). 없으면 성공 취급(멱등). */
export async function deleteUserWorker(env: ProvisionEnv, slug: string, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ slug: string; existed: boolean }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  // slug는 URL 경로에 들어간다 — 규칙 밖이면 요청하지 않는다(프로젝트 삭제 정리가 D1 행의 값을 넘긴다).
  if (!SLUG_RE.test(slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  const r = await call(fetchImpl, `${API}/accounts/${c.account}/workers/dispatch/namespaces/${HOSTING_NAMESPACE}/scripts/${slug}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${c.token}` },
  }, () => ({ slug, existed: true }));
  if (!r.ok && r.status === 404) return { ok: true, value: { slug, existed: false } };
  return r;
}

/**
 * 프로젝트 D1 삭제(프로젝트 삭제 — PR #569 S3 검증 결함 2: 앱 최종 사용자의 행이 쌓이는 곳). DELETE
 * /accounts/:id/d1/database/:d1Id. 없으면(404) 성공 취급(멱등). d1Id는 잡 행의 값 — 모양을 다시 확인한다(URL 경로).
 * 운영 자격은 Worker secret만. 토큰은 오류에 싣지 않는다.
 */
export async function deleteProjectD1(env: ProvisionEnv, d1Id: string, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ d1Id: string; existed: boolean }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!D1_ID_RE.test(d1Id)) return { ok: false, error: "cf_error", message: "invalid_d1_id" };
  const r = await call(fetchImpl, `${API}/accounts/${c.account}/d1/database/${d1Id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${c.token}` },
  }, () => ({ d1Id, existed: true }));
  if (!r.ok && r.status === 404) return { ok: true, value: { d1Id, existed: false } };
  return r;
}
