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

export type UserWorkerModule = { name: string; content: string; type?: "application/javascript+module" | "text/plain" | "application/json" };

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

/**
 * 프로젝트당 D1 하나 (D-12). 이름 `simsa-hosted-<slug>`.
 *
 * 멱등(#578 검증 결함 3): 같은 이름이 이미 있으면(지난 시도가 D1을 만들고 끝났거나 잡 행을 못 남김) 만들기가
 * 거부된다 — 종전엔 그 거부를 그대로 돌려줘 같은 프로젝트의 [다시 시도]가 매번 502 hosting_d1_failed로 막혔다.
 * 이제 거부되면 **이름으로 찾아 정확히 같은 이름**의 D1을 쓴다. Cloudflare 오류 코드에 기대지 않는다(코드를
 * 라이브로 재 본 적이 없다 — 이름이 진실이다). 찾지 못하면 처음 오류를 그대로 돌려준다(다른 D1을 쓰지 않는다).
 */
export async function createProjectD1(env: ProvisionEnv, slug: string, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ id: string; name: string }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!SLUG_RE.test(slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  const name = `${HOSTED_D1_PREFIX}${slug}`;
  const created = await call(fetchImpl, `${API}/accounts/${c.account}/d1/database`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }, (result) => {
    const r = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
    return { id: String(r["uuid"] ?? ""), name };
  });
  if (created.ok || created.error !== "cf_error") return created;
  const existing = await findProjectD1ByName(c, name, fetchImpl);
  return existing ?? created;
}

/** 이름이 **정확히** 같은 D1 하나(목록 조회 `?name=`은 부분 일치라 여기서 한 번 더 거른다). 없거나 실패면 null. */
async function findProjectD1ByName(c: { token: string; account: string }, name: string, fetchImpl: FetchLike): Promise<ProvisionResult<{ id: string; name: string }> | null> {
  const found = await call(fetchImpl, `${API}/accounts/${c.account}/d1/database?name=${encodeURIComponent(name)}&per_page=100`, {
    method: "GET",
    headers: { authorization: `Bearer ${c.token}` },
  }, (result) => {
    const list = Array.isArray(result) ? result : [];
    for (const item of list) {
      const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      if (r["name"] === name && typeof r["uuid"] === "string" && r["uuid"]) return r["uuid"];
    }
    return null;
  });
  return found.ok && found.value ? { ok: true, value: { id: found.value, name } } : null;
}

/** 업로드 metadata — 순수(테스트로 모양 고정). */
export function buildUploadMetadata(args: { mainModule: string; compatibilityDate: string; d1Id?: string; vars?: Record<string, string> }): Record<string, unknown> {
  const bindings: Array<Record<string, unknown>> = [];
  if (args.d1Id) bindings.push({ type: "d1", name: "DB", id: args.d1Id });
  for (const [name, text] of Object.entries(args.vars ?? {})) bindings.push({ type: "plain_text", name, text });
  return { main_module: args.mainModule, compatibility_date: args.compatibilityDate, bindings, tags: ["simsa-hosted"] };
}

/** 유저 Worker 업로드(PUT = 같은 slug 덮어쓰기). modules[0]이 main. */
export async function uploadUserWorker(
  env: ProvisionEnv,
  args: { slug: string; modules: UserWorkerModule[]; compatibilityDate: string; d1Id?: string; vars?: Record<string, string> },
  fetchImpl: FetchLike = fetch,
): Promise<ProvisionResult<{ slug: string }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  if (!SLUG_RE.test(args.slug)) return { ok: false, error: "cf_error", message: "invalid_slug" };
  const main = args.modules[0];
  if (!main) return { ok: false, error: "cf_error", message: "no_modules" };
  const form = new FormData();
  const meta = buildUploadMetadata({ mainModule: main.name, compatibilityDate: args.compatibilityDate, d1Id: args.d1Id, vars: args.vars });
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

/** 유저 Worker 삭제(프로젝트 삭제·정지 해제 불가 시). 없으면 성공 취급(멱등). */
export async function deleteUserWorker(env: ProvisionEnv, slug: string, fetchImpl: FetchLike = fetch): Promise<ProvisionResult<{ slug: string; existed: boolean }>> {
  const c = creds(env);
  if (!c) return { ok: false, error: "not_configured" };
  const r = await call(fetchImpl, `${API}/accounts/${c.account}/workers/dispatch/namespaces/${HOSTING_NAMESPACE}/scripts/${slug}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${c.token}` },
  }, () => ({ slug, existed: true }));
  if (!r.ok && r.status === 404) return { ok: true, value: { slug, existed: false } };
  return r;
}
