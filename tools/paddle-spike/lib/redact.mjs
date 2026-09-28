/**
 * redact.mjs — 증거 파일에 쓰기 **전에** 키·토큰·이메일·카드 정보를 가린다.
 *
 * 두 겹으로 가린다.
 *  1) 키 이름 기반: authorization·api_key·token·secret·email·card·cvc·management_urls(고객 포털
 *     토큰이 URL에 들어 있음)·주소 줄 등은 값 전체를 [REDACTED]로.
 *  2) 문자열 패턴 기반: Paddle 비밀값(pdl_…)·client-side token(test_/live_…)·Bearer 헤더·
 *     이메일·13~19자리 카드 번호(공백/하이픈 허용)를 모든 문자열 안에서 치환.
 *  + 정확 일치: 호출자가 넘긴 실제 키 문자열(secrets)은 어디에 있든 치환.
 *
 * Paddle ID(sub_/txn_/pri_…)·금액("19900")·ISO 날짜·한글 텍스트는 건드리지 않는다
 * (증거로서 의미가 있어야 하므로 — 테스트가 양방향을 확인한다).
 */
export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /^(authorization|proxy[-_]?authorization|api[-_]?key|apikey|client[-_]?token|access[-_]?token|refresh[-_]?token|token|secret|secret[-_]?key|webhook[-_]?secret|endpoint[-_]?secret[-_]?key|password|passcode|cvc|cvv|cvc2|security[-_]?code|card|card[-_]?number|cardholder[-_]?name|pan|expiry|expiry[-_]?month|expiry[-_]?year|last4|email|email[-_]?address|management[-_]?urls|postal[-_]?code|postcode|first[-_]?line|second[-_]?line)$/i;

/** 문자열 안 패턴. 순서 중요: 구체적인 것부터. */
const STRING_PATTERNS = [
  // Paddle 서버 비밀값: API 키(pdl_sdbx_apikey_… / pdl_live_apikey_…)·알림 시크릿(pdl_ntfset_…)
  { re: /\bpdl_[A-Za-z0-9_]{6,}/g, label: "paddle_secret" },
  // Paddle.js client-side token: 샌드박스 test_…, 라이브 live_…
  { re: /\b(?:test|live)_[A-Za-z0-9]{16,}\b/g, label: "client_token" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, label: "bearer" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, label: "email" },
  // 카드 번호: 13~19자리, 숫자 사이 공백/하이픈 한 칸 허용
  { re: /\b(?:\d[ -]?){12,18}\d\b/g, label: "card" },
];

function redactString(s, exactSecrets) {
  let out = s;
  for (const secret of exactSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(`${REDACTED}`);
  }
  for (const { re, label } of STRING_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, `[REDACTED:${label}]`);
  }
  return out;
}

function normalizeSecrets(secrets) {
  if (!Array.isArray(secrets)) return [];
  return secrets
    .filter((s) => typeof s === "string" && s.trim().length >= 8)
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length);
}

/**
 * 깊은 복사하며 가린다(원본 불변). 순환 참조는 "[Circular]".
 * 순환 판정은 **현재 조상 경로**로만 한다 — 같은 객체를 두 곳에서 참조하는 것(공유 참조)은 순환이 아니다.
 * (예: 같은 요청 본문을 preview·charge 두 단계에 기록해도 둘 다 내용이 남아야 한다.)
 * @param {unknown} value
 * @param {{ secrets?: string[] }} [opts]
 */
export function redact(value, opts = {}) {
  const exact = normalizeSecrets(opts.secrets);
  const ancestors = new Set();
  /** @param {unknown} v @param {string|undefined} key */
  function walk(v, key) {
    if (key !== undefined && SENSITIVE_KEY.test(key)) {
      return v === null || v === undefined ? v : REDACTED;
    }
    if (typeof v === "string") return redactString(v, exact);
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (ancestors.has(v)) return "[Circular]";
    ancestors.add(v);
    try {
      if (Array.isArray(v)) return v.map((item) => walk(item, undefined));
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, child] of Object.entries(v)) out[k] = walk(child, k);
      return out;
    } finally {
      ancestors.delete(v);
    }
  }
  return walk(value, undefined);
}

/** 문자열 하나만 가릴 때. */
export function redactText(text, opts = {}) {
  return typeof text === "string" ? redactString(text, normalizeSecrets(opts.secrets)) : text;
}

/**
 * 직렬화된 증거에 비밀값이 남았는지 마지막으로 확인한다(두 번째 안전망).
 * 남았으면 쓰기 전에 throw — 가림 규칙에 구멍이 있다는 뜻이다.
 */
export function assertNoLeak(serialized, opts = {}) {
  if (typeof serialized !== "string") throw new TypeError("assertNoLeak: 문자열이 필요합니다");
  for (const secret of normalizeSecrets(opts.secrets)) {
    if (serialized.includes(secret)) throw new Error("assertNoLeak: 실제 비밀값이 증거에 남아 있습니다");
  }
  for (const { re, label } of STRING_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(serialized)) throw new Error(`assertNoLeak: 가려지지 않은 ${label} 패턴이 남아 있습니다`);
  }
  return true;
}
