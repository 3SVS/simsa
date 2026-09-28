/**
 * paddle-client.mjs — fetch 기반 최소 Paddle Billing 클라이언트. **샌드박스 전용.**
 *
 * 안전장치(요청을 한 번도 보내기 전에 throw):
 *  - baseUrl 은 https://sandbox-api.paddle.com 하나만 허용(허용 목록). 라이브(api.paddle.com)는
 *    "라이브" 라고 명시한 SandboxOnlyError. 그 밖의 호스트·http·포트 지정도 거부.
 *  - 라이브 API 키(pdl + live 접두사) 거부. 키 값은 에러 메시지에 절대 넣지 않는다.
 *  - 경로는 "/"로 시작하는 상대 경로만, "..", "//", 스킴 금지. 최종 URL origin 을 다시 확인.
 *  - 페이지네이션 next URL 도 같은 origin 검사.
 *  - 경로에 들어가는 ID 는 Paddle 형식(접두사_26자)만 → 경로 주입 불가.
 *
 * 응답: 4xx/5xx 도 throw 하지 않고 { ok:false, status, error } 로 돌려준다 — 거부 자체가 관측 대상이다
 * (예: trialing 구독에 /charge 가 거부되면 그게 분기 B/C 의 증거).
 *
 * 인증: Authorization: Bearer <키> (API 레퍼런스 about/authentication, 2026-09-28 접근).
 * 버전: Paddle-Version: 1.
 */
import { assertPaddleId } from "./lib/requests.mjs";

export const SANDBOX_API_BASE = "https://sandbox-api.paddle.com";
const LIVE_API_HOST = "api.paddle.com";

export class SandboxOnlyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SandboxOnlyError";
  }
}

/** @returns {string} 정규화된 origin(끝 슬래시 없음) */
export function assertSandboxBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl));
  } catch {
    throw new SandboxOnlyError("baseUrl 이 URL 이 아닙니다 — 이 도구는 https://sandbox-api.paddle.com 만 씁니다");
  }
  const host = url.hostname.toLowerCase();
  if (host === LIVE_API_HOST) {
    throw new SandboxOnlyError("라이브 Paddle API 주소(api.paddle.com)입니다 — 이 도구는 샌드박스 전용이라 즉시 중단합니다");
  }
  const expected = new URL(SANDBOX_API_BASE);
  const pathOk = url.pathname === "/" || url.pathname === "";
  if (url.protocol !== "https:" || host !== expected.hostname || url.port !== "" || !pathOk || url.search !== "" || url.username !== "") {
    throw new SandboxOnlyError(`허용되지 않은 API 주소입니다(${url.protocol}//${host}${url.port ? ":" + url.port : ""}) — https://sandbox-api.paddle.com 만 허용`);
  }
  return expected.origin;
}

export function assertNotLiveApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") throw new TypeError("PADDLE_SANDBOX_API_KEY 가 비어 있습니다");
  if (/^pdl_live_/i.test(apiKey.trim())) {
    throw new SandboxOnlyError("라이브 API 키(pdl_live_…)입니다 — 샌드박스 키(pdl_sdbx_…)만 쓸 수 있습니다. 값은 출력하지 않았습니다");
  }
  return apiKey.trim();
}

function assertRelativePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("://") || path.includes("\\")) {
    throw new TypeError("경로는 '/'로 시작하는 상대 경로여야 합니다");
  }
  const pathname = path.split("?")[0] ?? "";
  if (pathname.split("/").some((seg) => seg === ".." || seg === ".")) throw new TypeError("경로에 '..' 를 쓸 수 없습니다");
  return path;
}

function toQueryRecord(query) {
  /** @type {Record<string,string>} */
  const out = {};
  if (query === null || typeof query !== "object") return out;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}

async function parseResponse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  const obj = json !== null && typeof json === "object" ? /** @type {Record<string, any>} */ (json) : null;
  const meta = obj && obj.meta && typeof obj.meta === "object" ? obj.meta : null;
  let error = obj && obj.error && typeof obj.error === "object" ? obj.error : null;
  if (!res.ok && error === null) error = { type: "non_json", code: `http_${res.status}`, detail: text.slice(0, 300) };
  return {
    ok: res.ok,
    status: res.status,
    requestId: meta && typeof meta.request_id === "string" ? meta.request_id : null,
    data: obj ? obj.data ?? null : null,
    error,
    pagination: meta && meta.pagination && typeof meta.pagination === "object" ? meta.pagination : null,
  };
}

/**
 * @param {{ apiKey: string, baseUrl?: string, fetch?: typeof globalThis.fetch, paddleVersion?: string }} opts
 */
export function createPaddleClient(opts) {
  const origin = assertSandboxBaseUrl(opts?.baseUrl ?? SANDBOX_API_BASE);
  const apiKey = assertNotLiveApiKey(opts?.apiKey);
  const fetchImpl = opts?.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new TypeError("fetch 구현이 없습니다(Node 20+ 필요)");
  const paddleVersion = opts?.paddleVersion ?? "1";

  /**
   * @param {"GET"|"POST"|"PATCH"} method
   * @param {string} path
   * @param {{ query?: Record<string, unknown>, body?: unknown }} [init]
   */
  async function request(method, path, init = {}) {
    assertRelativePath(path);
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new SandboxOnlyError("요청이 샌드박스 호스트를 벗어납니다");
    const query = toQueryRecord(init.query);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Paddle-Version": paddleVersion,
    };
    const res = await fetchImpl(url.toString(), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const parsed = await parseResponse(res);
    // 기록용 요청 서술 — 헤더(키)는 절대 싣지 않는다.
    return { ...parsed, request: { method, path: url.pathname, query, body: init.body === undefined ? null : init.body } };
  }

  /** 커서 페이지네이션(meta.pagination.next)을 따라가며 모은다. next 도 샌드박스 origin 만. */
  async function listAll(path, query = {}, { maxPages = 20 } = {}) {
    /** @type {unknown[]} */
    const items = [];
    let res = await request("GET", path, { query });
    let pages = 1;
    for (;;) {
      if (!res.ok) return { ok: false, items, pages, last: res };
      if (Array.isArray(res.data)) items.push(...res.data);
      const next = res.pagination && res.pagination.has_more ? res.pagination.next : null;
      if (typeof next !== "string" || next === "" || pages >= maxPages) break;
      const nextUrl = new URL(next);
      if (nextUrl.origin !== origin) throw new SandboxOnlyError("페이지네이션 next 가 샌드박스 호스트가 아닙니다 — 따라가지 않습니다");
      res = await request("GET", nextUrl.pathname, { query: Object.fromEntries(nextUrl.searchParams) });
      pages += 1;
    }
    return { ok: true, items, pages, last: res };
  }

  const subPath = (id, suffix = "") => `/subscriptions/${encodeURIComponent(assertPaddleId(id, "sub", "subscriptionId"))}${suffix}`;

  return {
    baseUrl: origin,
    request,
    listAll,
    products: {
      list: (query) => request("GET", "/products", { query }),
      create: (body) => request("POST", "/products", { body }),
    },
    prices: {
      list: (query) => request("GET", "/prices", { query }),
      create: (body) => request("POST", "/prices", { body }),
    },
    subscriptions: {
      get: async (id, query) => request("GET", subPath(id), { query }),
      update: async (id, body) => request("PATCH", subPath(id), { body }),
      charge: async (id, body) => request("POST", subPath(id, "/charge"), { body }),
      previewCharge: async (id, body) => request("POST", subPath(id, "/charge/preview"), { body }),
      cancel: async (id, body) => request("POST", subPath(id, "/cancel"), { body }),
      activate: async (id) => request("POST", subPath(id, "/activate"), { body: {} }),
    },
    transactions: {
      get: async (id) => request("GET", `/transactions/${encodeURIComponent(assertPaddleId(id, "txn", "transactionId"))}`),
      list: (query) => request("GET", "/transactions", { query }),
    },
    adjustments: {
      create: (body) => request("POST", "/adjustments", { body }),
      list: (query) => request("GET", "/adjustments", { query }),
    },
  };
}
