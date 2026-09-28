/**
 * Paddle-Signature 검증 — 순수 함수, 가짜 시크릿으로 만든 서명.
 * 형식(공식 문서 webhooks/signature-verification, 2026-09-28 접근):
 *   헤더 `ts=<unix초>;h1=<hex>` · 서명 대상 `${ts}:${원문 본문}` · HMAC-SHA256(엔드포인트 시크릿) ·
 *   기본 허용 오차 5초 · 시크릿 교체 중엔 h1 이 여러 개.
 * 기대 서명은 테스트가 node:crypto 로 **독립 계산**한다(구현을 재사용하지 않음).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DEFAULT_TOLERANCE_SEC, parseSignatureHeader, verifyPaddleSignature } from "../webhook-verify.mjs";
import { FAKE_WEBHOOK_SECRET, KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

const TS = 1_790_000_000; // 2026-09 근처 고정 시각
const body = JSON.stringify({
  event_id: "evt_" + "0".repeat(26),
  event_type: "transaction.completed",
  occurred_at: "2026-10-01T00:00:00.000Z",
  data: { id: fakeId("txn", "wh"), custom_data: { simsa_project_name: KO_PROJECT_NAME } },
});
const rawBytes = Buffer.from(body, "utf8");
const sign = (ts, bytes, secret = FAKE_WEBHOOK_SECRET) =>
  createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${ts}:`, "utf8"), bytes])).digest("hex");
const header = (ts, ...h1s) => [`ts=${ts}`, ...h1s.map((h) => `h1=${h}`)].join(";");

describe("정상", () => {
  it("원문 바이트(한글 포함) + 올바른 시크릿 + 허용 오차 안 → ok", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS + 3 });
    assert.deepEqual(res, { ok: true, ts: TS });
  });
  it("문자열 본문은 UTF-8 로 해석한다(한글 본문에서 같은 결과)", () => {
    const res = verifyPaddleSignature({ rawBody: body, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
    assert.equal(res.ok, true);
  });
  it("시크릿 교체 중 h1 여러 개 — 하나라도 맞으면 ok", () => {
    const wrong = sign(TS, rawBytes, "other-secret-for-rotation-test");
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, wrong, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
    assert.equal(res.ok, true);
  });
  it("기본 허용 오차는 문서 기본값 5초", () => {
    assert.equal(DEFAULT_TOLERANCE_SEC, 5);
  });
});

describe("변조", () => {
  it("본문 한 글자 변조 → signature_mismatch", () => {
    const tampered = Buffer.from(body.replace("transaction.completed", "transaction.completeD"), "utf8");
    const res = verifyPaddleSignature({ rawBody: tampered, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
    assert.deepEqual(res, { ok: false, reason: "signature_mismatch" });
  });
  it("공백 추가(JSON 재직렬화) → signature_mismatch — 원문을 변형하면 안 된다", () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body), null, 2), "utf8");
    const res = verifyPaddleSignature({ rawBody: reserialized, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
    assert.equal(res.reason, "signature_mismatch");
  });
  it("한글 본문을 latin1 로 잘못 디코딩한 문자열 → signature_mismatch(인코딩 사고 탐지)", () => {
    const mojibake = rawBytes.toString("latin1");
    const res = verifyPaddleSignature({ rawBody: mojibake, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
    assert.equal(res.reason, "signature_mismatch");
  });
  it("다른 시크릿 → signature_mismatch", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes)), secret: "a-different-fake-secret", nowSec: TS });
    assert.equal(res.reason, "signature_mismatch");
  });
  it("ts 를 바꿔치기(서명은 옛 ts) → signature_mismatch", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS + 1, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS + 1 });
    assert.equal(res.reason, "signature_mismatch");
  });
});

describe("시간 초과", () => {
  it("과거 6초 → timestamp_out_of_tolerance (서명이 맞아도)", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS + 6 });
    assert.deepEqual(res, { ok: false, reason: "timestamp_out_of_tolerance" });
  });
  it("미래 6초도 거부", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS - 6 });
    assert.equal(res.reason, "timestamp_out_of_tolerance");
  });
  it("허용 오차는 주입 가능(재전송 관측용 300초)", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes)), secret: FAKE_WEBHOOK_SECRET, nowSec: TS + 200, toleranceSec: 300 });
    assert.equal(res.ok, true);
  });
});

describe("형식 오류", () => {
  for (const bad of ["", "h1=abc", "ts=abc;h1=00", "ts=1;h1=", "ts=1;h1=zz", "garbage", `ts=${TS}`]) {
    it(`malformed_header: ${JSON.stringify(bad)}`, () => {
      const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: bad, secret: FAKE_WEBHOOK_SECRET, nowSec: TS });
      assert.deepEqual(res, { ok: false, reason: "malformed_header" });
    });
  }
  it("시크릿이 비면 missing_secret(빈 키로 HMAC 을 계산해 통과시키는 사고 방지)", () => {
    const res = verifyPaddleSignature({ rawBody: rawBytes, signatureHeader: header(TS, sign(TS, rawBytes, "")), secret: "", nowSec: TS });
    assert.deepEqual(res, { ok: false, reason: "missing_secret" });
  });
  it("헤더 파서: 공백·순서 무관, h1 여러 개 수집", () => {
    assert.deepEqual(parseSignatureHeader(" h1=ab ; ts=12 ;h1=cd"), { ts: 12, h1: ["ab", "cd"] });
    assert.equal(parseSignatureHeader(null), null);
  });
});
