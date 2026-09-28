/**
 * Train W — W-2 클라이언트 (D-7 amend [PILOT]: 검수 10/일 · 수리 5/일, UTC 일 기준).
 *
 * 서버 계약: 429 { ok:false, error:"daily_limit_reached", kind:"inspection"|"repair",
 * limit:<n>, resetAt:"<ISO>" }. 화면은 resetAt이 있으면 **유저가 사는 시간대의 시각**으로
 * "내일 오전 9시 이후"처럼 말하고, 없거나 이상하면 일반 문구("내일(자정 UTC 이후)")로 돌아간다.
 *
 * ★시간대를 명시한다: UTC 자정은 서울에선 "내일 오전 9시"지만 뉴욕·LA에선 **같은 날 저녁**이다.
 *  "내일"을 박아 두면 미국 유저에게 거짓말이 된다 — 그래서 오늘/내일은 계산한다.
 *
 * 이 파일의 검사는 모두 고치기 전 코드에서 실패한다(모듈이 없었다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readDailyLimit, formatResetAt, errorNoticeText } from "../src/lib/daily-limit.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const RESET = "2026-09-29T00:00:00.000Z"; // UTC 자정 = 서울 9/29 09:00 = 뉴욕 9/28 20:00 = LA 9/28 17:00

describe("daily-limit: readDailyLimit (429 본문 파서 — 외부 경계라 모양을 믿지 않는다)", () => {
  it("계약 모양 그대로면 kind·limit·resetAt을 돌려준다 (검수)", () => {
    assert.deepEqual(
      readDailyLimit({ ok: false, error: "daily_limit_reached", kind: "inspection", limit: 10, resetAt: RESET }),
      { kind: "inspection", limit: 10, resetAt: RESET },
    );
  });

  it("kind별 — 수리 상한도 같은 모양으로 읽는다", () => {
    assert.deepEqual(
      readDailyLimit({ ok: false, error: "daily_limit_reached", kind: "repair", limit: 5, resetAt: RESET }),
      { kind: "repair", limit: 5, resetAt: RESET },
    );
  });

  it("필드가 빠지거나 이상하면 그 필드만 null — 상한이라는 사실은 유지", () => {
    assert.deepEqual(readDailyLimit({ ok: false, error: "daily_limit_reached" }), {
      kind: null,
      limit: null,
      resetAt: null,
    });
    assert.deepEqual(
      readDailyLimit({ ok: false, error: "daily_limit_reached", kind: "build", limit: "10", resetAt: "내일" }),
      { kind: null, limit: null, resetAt: null },
    );
    assert.equal(readDailyLimit({ error: "daily_limit_reached", limit: 0 }).limit, null);
    assert.equal(readDailyLimit({ error: "daily_limit_reached", limit: -3 }).limit, null);
    assert.equal(readDailyLimit({ error: "daily_limit_reached", limit: 2.5 }).limit, null);
  });

  it("상한 응답이 아니면 null (옛 서버의 rate_limited·다른 코드·쓰레기)", () => {
    assert.equal(readDailyLimit({ ok: false, error: "rate_limited", retryAfterSeconds: 60 }), null);
    assert.equal(readDailyLimit({ ok: false, error: "HTTP 429" }), null);
    assert.equal(readDailyLimit({ ok: true }), null);
    assert.equal(readDailyLimit(null), null);
    assert.equal(readDailyLimit(undefined), null);
    assert.equal(readDailyLimit("daily_limit_reached"), null);
  });
});

describe("daily-limit: formatResetAt (유저 로캘·시간대의 '언제부터')", () => {
  it("한국: 오후에 막히면 → '내일 오전 9시 이후'", () => {
    const now = new Date("2026-09-28T05:00:00Z"); // 서울 14:00
    assert.equal(formatResetAt(RESET, "ko", { now, timeZone: "Asia/Seoul" }), "내일 오전 9시 이후");
  });

  it("한국: 새벽(자정~9시)에 막히면 같은 날 → '오늘 오전 9시 이후'", () => {
    const now = new Date("2026-09-28T16:00:00Z"); // 서울 9/29 01:00
    assert.equal(formatResetAt(RESET, "ko", { now, timeZone: "Asia/Seoul" }), "오늘 오전 9시 이후");
  });

  it("미국 동부: UTC 자정은 같은 날 저녁 — '내일'이라고 하지 않는다", () => {
    const now = new Date("2026-09-28T15:00:00Z"); // 뉴욕 11:00 EDT
    assert.equal(formatResetAt(RESET, "en", { now, timeZone: "America/New_York" }), "after 8 PM today");
  });

  it("미국 서부: 저녁에 막히면 다음 UTC 자정은 내일 오후 5시", () => {
    const now = new Date("2026-09-29T01:00:00Z"); // LA 9/28 18:00 PDT
    assert.equal(
      formatResetAt("2026-09-30T00:00:00Z", "en", { now, timeZone: "America/Los_Angeles" }),
      "after 5 PM tomorrow",
    );
  });

  it("영어 UI + 서울 시간대 → 'after 9 AM tomorrow'", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt(RESET, "en", { now, timeZone: "Asia/Seoul" }), "after 9 AM tomorrow");
  });

  it("30분 단위 시간대는 분까지 말한다", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt(RESET, "ko", { now, timeZone: "Asia/Kolkata" }), "내일 오전 5시 30분 이후");
    assert.equal(formatResetAt(RESET, "en", { now, timeZone: "Asia/Kolkata" }), "after 5:30 AM tomorrow");
  });

  it("자정·정오 표기가 모호하지 않다", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    assert.equal(formatResetAt(RESET, "ko", { now, timeZone: "UTC" }), "내일 오전 0시 이후");
    assert.equal(formatResetAt(RESET, "en", { now, timeZone: "UTC" }), "after 12 AM tomorrow");
    const noon = new Date("2026-09-28T03:00:00Z"); // 서울 12:00 → 리셋 12:00은 '오후 12시'
    assert.equal(
      formatResetAt("2026-09-28T03:30:00Z", "ko", { now: new Date("2026-09-28T01:00:00Z"), timeZone: "Asia/Seoul" }),
      "오늘 오후 12시 30분 이후",
    );
    assert.equal(
      formatResetAt(noon.toISOString(), "en", { now: new Date("2026-09-28T01:00:00Z"), timeZone: "Asia/Seoul" }),
      "after 12 PM today",
    );
  });

  it("이틀 이상 뒤면 날짜로 말한다", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(
      formatResetAt("2026-10-01T00:00:00Z", "ko", { now, timeZone: "Asia/Seoul" }),
      "10월 1일 오전 9시 이후",
    );
    assert.equal(
      formatResetAt("2026-10-01T00:00:00Z", "en", { now, timeZone: "Asia/Seoul" }),
      "after 9 AM on Oct 1",
    );
  });

  it("잘못된 값·이미 지난 시각·알 수 없는 시간대 → null (일반 문구로 돌아간다)", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    for (const bad of ["not-a-date", "", "   ", null, undefined, 12345, {}]) {
      assert.equal(formatResetAt(bad, "ko", { now, timeZone: "Asia/Seoul" }), null, String(bad));
    }
    assert.equal(formatResetAt("2026-09-28T04:00:00Z", "ko", { now, timeZone: "Asia/Seoul" }), null);
    assert.equal(formatResetAt(RESET, "ko", { now, timeZone: "Mars/Olympus_Mons" }), null);
  });

  it("now를 안 주면 현재 시각 기준 — 먼 미래 리셋도 문자열을 만든다", () => {
    const out = formatResetAt("2099-01-01T00:00:00Z", "en", { timeZone: "UTC" });
    assert.equal(out, "after 12 AM on Jan 1");
  });
});

describe("daily-limit: errorNoticeText (사전 문구 + resetAt 치환)", () => {
  const now = new Date("2026-09-28T05:00:00Z");

  it("검수 상한 + resetAt → 유저 시각이 들어간 문장", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", RESET, "ko", { now, timeZone: "Asia/Seoul" }),
      "오늘 확인 횟수를 다 썼어요. 내일 오전 9시 이후 다시 할 수 있어요.",
    );
    const en = getDictionary("en").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(en, "dailyLimitReached", RESET, "en", { now, timeZone: "America/New_York" }),
      "You've used all of today's checks. You can check again after 8 PM today.",
    );
  });

  it("resetAt이 없거나 잘못되면 계약의 일반 문구 그대로", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", null, "ko", { now }),
      "오늘 확인 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.",
    );
    assert.equal(errorNoticeText(ko, "dailyLimitReached", "garbage", "ko", { now }), ko.dailyLimitReached);
  });

  it("수리 상한도 같은 규칙(수리 사전)", () => {
    const ko = getDictionary("ko").visualChecks.repair.errors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", RESET, "ko", { now, timeZone: "Asia/Seoul" }),
      "오늘 고치기 횟수를 다 썼어요. 내일 오전 9시 이후 다시 할 수 있어요.",
    );
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", null, "ko", { now }),
      "오늘 고치기 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.",
    );
  });

  it("상한이 아닌 키는 resetAt을 무시하고 그 키의 문구, 모르는 키는 generic", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(errorNoticeText(ko, "inspectionDisabled", RESET, "ko", { now }), ko.inspectionDisabled);
    assert.equal(errorNoticeText(ko, "runAlreadyActive", null, "ko"), ko.runAlreadyActive);
    assert.equal(errorNoticeText(ko, "noSuchKey", null, "ko"), ko.generic);
  });
});
