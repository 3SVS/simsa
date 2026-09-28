/**
 * 테스트용 가짜 값 · 가짜 fetch.
 *
 * 가짜 키·토큰은 **런타임에 조각을 이어 붙여** 만든다. 소스 파일에 비밀값 모양 리터럴을 두지 않기
 * 위해서다(2026-09-26 push protection 사고 — 탐지 테스트용 가짜 값도 스캐너가 막았다).
 * 값 자체도 FAKE·0 으로 채워 누가 봐도 가짜다.
 */
const join = (...parts) => parts.join("_");

/** 샌드박스 API 키 모양(pdl + sdbx + apikey + 26 + 22 + 3). */
export const FAKE_SANDBOX_KEY = join("pdl", "sdbx", "apikey", "0".repeat(26), "FAKE".repeat(5) + "FA", "zzz");
/** 라이브 API 키 모양 — 거부돼야 한다. */
export const FAKE_LIVE_KEY = join("pdl", "live", "apikey", "0".repeat(26), "FAKE".repeat(5) + "FA", "zzz");
/** Paddle.js client-side token(샌드박스 test + 27자). */
export const FAKE_CLIENT_TOKEN = join("test", "FAKE" + "0".repeat(22) + "X");
/** 라이브 client-side token — 거부돼야 한다. */
export const FAKE_LIVE_CLIENT_TOKEN = join("live", "FAKE" + "0".repeat(22) + "X");
/** 웹훅 알림 대상 시크릿 모양. */
export const FAKE_WEBHOOK_SECRET = join("pdl", "ntfset", "0".repeat(26), "FAKE".repeat(8));

/** Paddle ID 모양(접두사 + 소문자·숫자 26자). */
export function fakeId(prefix, seed = "") {
  const body = (String(seed).toLowerCase().replace(/[^a-z0-9]/g, "") + "0".repeat(26)).slice(0, 26);
  return `${prefix}_${body}`;
}

/** 실제 한국 유저가 넣을 법한 프로젝트명(규칙 6 — 특수문자·공백·한글). */
export const KO_PROJECT_NAME = "(주)트루픽셀 — 우리 동네 빵집 예약 앱 v2";

/** 가짜 Paddle(fake-paddle.mjs) 상태 파일에 심는 trialing 구독 모양. */
export function fakeTrialingSubscription(id, priceId) {
  return {
    id,
    status: "trialing",
    collection_mode: "automatic",
    next_billed_at: "2026-11-01T00:00:00.000Z",
    scheduled_change: null,
    items: [{ status: "trialing", price: { id: priceId, billing_cycle: { interval: "month", frequency: 1 }, trial_period: { interval: "day", frequency: 30 }, unit_price: { amount: "1900", currency_code: "USD" } } }],
    custom_data: { simsa_project_name: KO_PROJECT_NAME },
    // 고객 포털 URL 에는 토큰이 들어간다 — 증거에서 가려지는지 스모크가 확인
    management_urls: { cancel: "https://sandbox-customer-portal.paddle.com/portal-token-should-be-redacted" },
  };
}

/**
 * 호출을 기록하는 가짜 fetch. handler(url, init) → { status, body } | Response.
 * @param {(url: URL, init: RequestInit & { parsedBody?: unknown }) => ({ status?: number, body?: unknown } | Response)} handler
 */
export function makeFakeFetch(handler) {
  /** @type {{ url: URL, method: string, headers: Record<string,string>, body: unknown }[]} */
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    const parsedBody = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: String(init.method ?? "GET"), headers, body: parsedBody });
    const out = handler(url, { ...init, parsedBody });
    if (out instanceof Response) return out;
    return new Response(out.body === undefined ? "" : JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}
