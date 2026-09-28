/**
 * webhook-verify.mjs — Paddle-Signature 검증 순수 함수. ($-2 `POST /webhook/paddle` 가 옮겨 쓸 참조 구현)
 *
 * 형식(developer.paddle.com/webhooks/signature-verification, 2026-09-28 접근):
 *  - 헤더: `Paddle-Signature: ts=<unix 초>;h1=<hex HMAC>` — 시크릿 교체 중엔 h1 이 여러 개.
 *  - 서명 대상: `${ts}:${원문 본문}` — 본문을 파싱·재직렬화하면(공백 하나라도) 불일치.
 *  - 알고리즘: HMAC-SHA256, 키 = 알림 대상(notification destination)의 엔드포인트 시크릿.
 *  - 재전송 방어: ts 와 현재 시각 차이 허용 오차, 문서 기본 5초.
 *
 * 본문은 **바이트 그대로** 받는 것이 원칙이다(Buffer/Uint8Array). 문자열이 오면 UTF-8 로 인코딩한다 —
 * 한글이 든 본문을 latin1 등으로 잘못 디코딩한 문자열은 여기서 불일치로 드러난다(테스트 고정).
 * 비교는 timingSafeEqual(길이 같을 때만). 이유 코드만 돌려주고 시크릿·서명 값은 싣지 않는다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_TOLERANCE_SEC = 5;
const HEX64 = /^[0-9a-f]{64}$/i;

/** @returns {{ ts: number, h1: string[] } | null} */
export function parseSignatureHeader(header) {
  if (typeof header !== "string" || header.trim() === "") return null;
  let ts = null;
  /** @type {string[]} */
  const h1 = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") {
      if (!/^\d{1,12}$/.test(value)) return null;
      ts = Number(value);
    } else if (key === "h1") {
      h1.push(value);
    }
  }
  if (ts === null || h1.length === 0) return null;
  return { ts, h1 };
}

function toBytes(rawBody) {
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  return null;
}

/**
 * @param {{ rawBody: string|Uint8Array, signatureHeader: string|null|undefined, secret: string,
 *           nowSec?: number, toleranceSec?: number }} p
 * @returns {{ ok: true, ts: number } | { ok: false, reason: "missing_secret"|"invalid_body"|"malformed_header"|"timestamp_out_of_tolerance"|"signature_mismatch" }}
 */
export function verifyPaddleSignature(p) {
  const secret = typeof p?.secret === "string" ? p.secret : "";
  if (secret === "") return { ok: false, reason: "missing_secret" };
  const bytes = toBytes(p.rawBody);
  if (bytes === null) return { ok: false, reason: "invalid_body" };
  const parsed = parseSignatureHeader(p.signatureHeader);
  if (parsed === null) return { ok: false, reason: "malformed_header" };
  const candidates = parsed.h1.filter((h) => HEX64.test(h));
  if (candidates.length === 0) return { ok: false, reason: "malformed_header" };

  const nowSec = Number.isFinite(p.nowSec) ? /** @type {number} */ (p.nowSec) : Math.floor(Date.now() / 1000);
  const tolerance = Number.isFinite(p.toleranceSec) ? /** @type {number} */ (p.toleranceSec) : DEFAULT_TOLERANCE_SEC;
  if (Math.abs(nowSec - parsed.ts) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${parsed.ts}:`, "utf8"), bytes]))
    .digest();
  for (const h of candidates) {
    const got = Buffer.from(h, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, ts: parsed.ts };
  }
  return { ok: false, reason: "signature_mismatch" };
}
