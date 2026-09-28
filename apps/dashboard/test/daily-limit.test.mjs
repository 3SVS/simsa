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
 * #558 검증:
 *  P2-1  알림이 떠 있는 채로 resetAt이 지나면 문장이 "내일(자정 UTC 이후)"로 바뀌었다(이미 풀린
 *        상한을 '내일'이라고 말함) → "지금 다시 할 수 있어요"(dailyLimitCleared).
 *  P2-11 단어('오늘/내일/오전/오후/이후', 'today/tomorrow/after/AM/PM', 월 이름)가 코드에 박혀
 *        사전만으로 문장을 고칠 수 없었다 → t.visualChecks.resetWhen으로 옮기고, lib는 숫자만.
 * #558 검증 2차:
 *  P2-1  '지금 다시'를 렌더 시점의 클라이언트 시계로만 판정 → 시계가 빠르면 방금 받은 429에도 떴다.
 *        받은 시각(receivedAt)을 함께 두고 receivedAt < resetAt ≤ now 일 때만 (resetPassedSinceReceipt).
 *  P2-2  resetAt 검증이 Date.parse의 관대한 해석에 기댔다 → 엄격한 ISO-8601(오프셋 포함) + 달력 왕복.
 *
 * 표시: [행동 보존] = 옛 코드에서도 통과(회귀 증거 아님). 표시 없음 = 옛 코드에서 실패.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as dl from "../src/lib/daily-limit.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const { readDailyLimit, formatResetAt, errorNoticeText } = dl;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const RESET = "2026-09-29T00:00:00.000Z"; // UTC 자정 = 서울 9/29 09:00 = 뉴욕 9/28 20:00 = LA 9/28 17:00
const KO = getDictionary("ko").visualChecks.resetWhen;
const EN = getDictionary("en").visualChecks.resetWhen;

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

// #558 검증 2차 P2-2 — isValidIso가 `!isNaN(Date.parse(v))`만 봤다. Date.parse는 관대해서
// "Sep 29"(V8: 2001-09-29)·"1"·"2026"을 통과시키고, 오프셋 없는 "2026-09-29T00:00:00"은 **읽는 사람의
// 시간대**로 해석해 서울에서 "내일 오전 0시 이후"(기대: 오전 9시)를 만들었다. 2월 30일은 3월 2일로
// 넘겨 버린다. 외부 경계의 값이므로 엄격한 ISO-8601(날짜+시각+오프셋) + 달력 왕복 검사로 거른다.
describe("P2-2(2차): resetAt은 엄격한 ISO-8601만 — Date.parse의 관대한 해석을 믿지 않는다", () => {
  const capped = (resetAt) => ({ ok: false, error: "daily_limit_reached", kind: "inspection", limit: 10, resetAt });

  it("ISO 모양이 아닌 값('Sep 29'·'1'·'2026')은 resetAt=null — 상한이라는 사실은 유지", () => {
    for (const v of ["Sep 29", "1", "2026", "Tue Sep 29 2026 09:00:00 GMT+0900"]) {
      assert.deepEqual(readDailyLimit(capped(v)), { kind: "inspection", limit: 10, resetAt: null }, v);
    }
  });

  it("오프셋 없는 시각·날짜만 있는 값도 null — 읽는 사람의 시간대로 해석돼 시각이 어긋난다", () => {
    for (const v of ["2026-09-29T00:00:00", "2026-09-29T00:00", "2026-09-29"]) {
      assert.equal(readDailyLimit(capped(v)).resetAt, null, v);
      assert.equal(formatResetAt(v, KO, { now: new Date("2026-09-28T05:00:00Z"), timeZone: "Asia/Seoul" }), null, v);
    }
  });

  it("달력에 없는 날짜·시각(2월 30일·25시)은 null — V8은 다음 달로 넘겨 버린다", () => {
    for (const v of ["2026-02-30T00:00:00Z", "2026-09-29T25:00:00Z", "2026-13-01T00:00:00Z"]) {
      assert.equal(readDailyLimit(capped(v)).resetAt, null, v);
    }
  });

  it("오프셋 없는 resetAt은 일반 문장 — 서울 독자에게 '내일 오전 0시 이후'를 만들지 않는다", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(
      errorNoticeText(e, "dailyLimitReached", "2026-09-29T00:00:00", KO, { now, timeZone: "Asia/Seoul" }),
      e.dailyLimitReached,
    );
  });

  it("[행동 보존] 서버가 보내는 모양(toISOString·밀리초 유무·초 생략·Z·+09:00)은 그대로 받는다", () => {
    for (const v of [RESET, "2026-09-29T00:00:00Z", "2026-09-29T00:00Z", "2026-09-29T09:00:00+09:00", "2026-09-28T20:00:00-04:00"]) {
      assert.equal(readDailyLimit(capped(v)).resetAt, v, v);
    }
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt("2026-09-29T09:00:00+09:00", KO, { now, timeZone: "Asia/Seoul" }), "내일 오전 9시 이후");
  });
});

describe("daily-limit: formatResetAt (유저 로캘 사전·시간대의 '언제부터')", () => {
  it("한국: 오후에 막히면 → '내일 오전 9시 이후'", () => {
    const now = new Date("2026-09-28T05:00:00Z"); // 서울 14:00
    assert.equal(formatResetAt(RESET, KO, { now, timeZone: "Asia/Seoul" }), "내일 오전 9시 이후");
  });

  it("한국: 새벽(자정~9시)에 막히면 같은 날 → '오늘 오전 9시 이후'", () => {
    const now = new Date("2026-09-28T16:00:00Z"); // 서울 9/29 01:00
    assert.equal(formatResetAt(RESET, KO, { now, timeZone: "Asia/Seoul" }), "오늘 오전 9시 이후");
  });

  it("미국 동부: UTC 자정은 같은 날 저녁 — '내일'이라고 하지 않는다", () => {
    const now = new Date("2026-09-28T15:00:00Z"); // 뉴욕 11:00 EDT
    assert.equal(formatResetAt(RESET, EN, { now, timeZone: "America/New_York" }), "after 8 PM today");
  });

  it("미국 서부: 저녁에 막히면 다음 UTC 자정은 내일 오후 5시", () => {
    const now = new Date("2026-09-29T01:00:00Z"); // LA 9/28 18:00 PDT
    assert.equal(
      formatResetAt("2026-09-30T00:00:00Z", EN, { now, timeZone: "America/Los_Angeles" }),
      "after 5 PM tomorrow",
    );
  });

  it("영어 UI + 서울 시간대 → 'after 9 AM tomorrow'", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt(RESET, EN, { now, timeZone: "Asia/Seoul" }), "after 9 AM tomorrow");
  });

  it("30분 단위 시간대는 분까지 말한다", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt(RESET, KO, { now, timeZone: "Asia/Kolkata" }), "내일 오전 5시 30분 이후");
    assert.equal(formatResetAt(RESET, EN, { now, timeZone: "Asia/Kolkata" }), "after 5:30 AM tomorrow");
  });

  it("자정·정오 표기가 모호하지 않다", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    assert.equal(formatResetAt(RESET, KO, { now, timeZone: "UTC" }), "내일 오전 0시 이후");
    assert.equal(formatResetAt(RESET, EN, { now, timeZone: "UTC" }), "after 12 AM tomorrow");
    const noon = new Date("2026-09-28T03:00:00Z"); // 서울 12:00 → 리셋 12:00은 '오후 12시'
    assert.equal(
      formatResetAt("2026-09-28T03:30:00Z", KO, { now: new Date("2026-09-28T01:00:00Z"), timeZone: "Asia/Seoul" }),
      "오늘 오후 12시 30분 이후",
    );
    assert.equal(
      formatResetAt(noon.toISOString(), EN, { now: new Date("2026-09-28T01:00:00Z"), timeZone: "Asia/Seoul" }),
      "after 12 PM today",
    );
  });

  it("이틀 이상 뒤면 날짜로 말한다", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    assert.equal(formatResetAt("2026-10-01T00:00:00Z", KO, { now, timeZone: "Asia/Seoul" }), "10월 1일 오전 9시 이후");
    assert.equal(formatResetAt("2026-10-01T00:00:00Z", EN, { now, timeZone: "Asia/Seoul" }), "after 9 AM on Oct 1");
  });

  it("잘못된 값·이미 지난 시각·알 수 없는 시간대·쓸 수 없는 사전 → null", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    for (const bad of ["not-a-date", "", "   ", null, undefined, 12345, {}]) {
      assert.equal(formatResetAt(bad, KO, { now, timeZone: "Asia/Seoul" }), null, String(bad));
    }
    assert.equal(formatResetAt("2026-09-28T04:00:00Z", KO, { now, timeZone: "Asia/Seoul" }), null);
    assert.equal(formatResetAt(RESET, KO, { now, timeZone: "Mars/Olympus_Mons" }), null);
    for (const words of [null, undefined, "ko", {}, { ...KO, months: ["1"] }, { ...KO, today: 1 }]) {
      assert.equal(formatResetAt(RESET, words, { now, timeZone: "Asia/Seoul" }), null, JSON.stringify(words));
    }
  });

  it("now를 안 주면 현재 시각 기준 — 먼 미래 리셋도 문자열을 만든다", () => {
    const out = formatResetAt("2099-01-01T00:00:00Z", EN, { timeZone: "UTC" });
    assert.equal(out, "after 12 AM on Jan 1");
  });
});

describe("P2-11: 단어·어순은 사전에서 온다 (lib는 숫자만)", () => {
  it("사전 조각을 바꾸면 문장이 그대로 따라 바뀐다 — 코드에 박힌 단어가 없다", () => {
    const now = new Date("2026-09-28T05:00:00Z");
    const custom = {
      today: "TODAY<{time}>",
      tomorrow: "TOMORROW<{time}>",
      onDate: "DATE<{day}/{month} {time}>",
      time: "{hour}{period}",
      timeWithMinute: "{hour}h{mm}{period}",
      am: "a",
      pm: "p",
      midnightHour: "00",
      months: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"],
    };
    assert.equal(formatResetAt(RESET, custom, { now, timeZone: "Asia/Seoul" }), "TOMORROW<9a>");
    assert.equal(formatResetAt(RESET, custom, { now, timeZone: "America/New_York" }), "TODAY<8p>");
    assert.equal(formatResetAt(RESET, custom, { now, timeZone: "Asia/Kolkata" }), "TOMORROW<5h30a>");
    assert.equal(formatResetAt(RESET, custom, { now, timeZone: "UTC" }), "TOMORROW<00a>");
    assert.equal(formatResetAt("2026-10-01T00:00:00Z", custom, { now, timeZone: "Asia/Seoul" }), "DATE<1/m10 9a>");
  });

  it("daily-limit.mjs의 코드(주석 제외)에 한글·시간 단어 문자열이 없다", () => {
    const src = readFileSync(path.join(HERE, "../src/lib/daily-limit.mjs"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/[가-힣]/.test(code), "Hangul in code");
    const dictKeys = new Set(Object.keys(KO)); // 사전 키 이름("today" 등)은 문구가 아니다
    const literals = [...code.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).filter((s) => !dictKeys.has(s));
    const words = literals.filter((s) => /\b(today|tomorrow|after|AM|PM|Jan|Oct)\b/.test(s));
    assert.deepEqual(words, []);
  });

  it("사전 KO/EN 모두 resetWhen을 갖고, 월은 12개", () => {
    for (const w of [KO, EN]) {
      for (const k of ["today", "tomorrow", "onDate", "time", "timeWithMinute", "am", "pm", "midnightHour"]) {
        assert.equal(typeof w[k], "string", k);
      }
      assert.equal(w.months.length, 12);
    }
    for (const k of ["today", "tomorrow", "onDate"]) {
      assert.ok(KO[k].includes("{time}") && EN[k].includes("{time}"), k);
    }
  });
});

describe("daily-limit: errorNoticeText (사전 문구 + resetAt 치환)", () => {
  const now = new Date("2026-09-28T05:00:00Z");

  it("검수 상한 + resetAt → 유저 시각이 들어간 문장", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", RESET, KO, { now, timeZone: "Asia/Seoul" }),
      "오늘 확인 횟수를 다 썼어요. 내일 오전 9시 이후 다시 할 수 있어요.",
    );
    const en = getDictionary("en").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(en, "dailyLimitReached", RESET, EN, { now, timeZone: "America/New_York" }),
      "You've used all of today's checks. You can check again after 8 PM today.",
    );
  });

  it("resetAt이 없거나 잘못되면 계약의 일반 문구 그대로", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", null, KO, { now }),
      "오늘 확인 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.",
    );
    assert.equal(errorNoticeText(ko, "dailyLimitReached", "garbage", KO, { now }), ko.dailyLimitReached);
  });

  it("수리 상한도 같은 규칙(수리 사전)", () => {
    const ko = getDictionary("ko").visualChecks.repair.errors;
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", RESET, KO, { now, timeZone: "Asia/Seoul" }),
      "오늘 고치기 횟수를 다 썼어요. 내일 오전 9시 이후 다시 할 수 있어요.",
    );
    assert.equal(
      errorNoticeText(ko, "dailyLimitReached", null, KO, { now }),
      "오늘 고치기 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.",
    );
  });

  it("상한이 아닌 키는 resetAt을 무시하고 그 키의 문구, 모르는 키는 generic", () => {
    const ko = getDictionary("ko").visualChecks.runErrors;
    assert.equal(errorNoticeText(ko, "inspectionDisabled", RESET, KO, { now }), ko.inspectionDisabled);
    assert.equal(errorNoticeText(ko, "runAlreadyActive", null, KO), ko.runAlreadyActive);
    assert.equal(errorNoticeText(ko, "noSuchKey", null, KO), ko.generic);
  });
});

describe("P2-1: 알림이 resetAt을 넘겨 떠 있어도 '내일'이라고 하지 않는다", () => {
  // 같은 알림(같은 resetAt)을 경계 앞·뒤에서 다시 그린다 — 화면은 렌더마다 new Date()로 다시 계산한다.
  // 알림은 경계 **앞에서** 받았다(receivedAt = before) — 2차 P2-1부터 받은 시각을 함께 넘긴다.
  const before = new Date("2026-09-28T23:55:00Z");
  const after = new Date("2026-09-29T00:05:00Z");
  const receivedAt = before.getTime();

  it("KO(서울) 검수: 앞 '오늘 오전 9시 이후' → 뒤 '지금 다시 할 수 있어요'", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(e, "dailyLimitReached", RESET, KO, { now: before, receivedAt, timeZone: "Asia/Seoul" }),
      "오늘 확인 횟수를 다 썼어요. 오늘 오전 9시 이후 다시 할 수 있어요.",
    );
    const later = errorNoticeText(e, "dailyLimitReached", RESET, KO, { now: after, receivedAt, timeZone: "Asia/Seoul" });
    assert.ok(!/내일/.test(later), later);
    assert.equal(later, e.dailyLimitCleared);
    assert.match(later, /지금 다시 할 수 있어요/);
  });

  it("EN(뉴욕) 검수: 'after 8 PM today' → 'now'", () => {
    const e = getDictionary("en").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(e, "dailyLimitReached", RESET, EN, { now: before, receivedAt, timeZone: "America/New_York" }),
      "You've used all of today's checks. You can check again after 8 PM today.",
    );
    const later = errorNoticeText(e, "dailyLimitReached", RESET, EN, { now: after, receivedAt, timeZone: "America/New_York" });
    assert.ok(!/tomorrow/i.test(later), later);
    assert.equal(later, e.dailyLimitCleared);
  });

  it("수리도 같은 규칙 (KO/EN)", () => {
    for (const [loc, words] of [["ko", KO], ["en", EN]]) {
      const e = getDictionary(loc).visualChecks.repair.errors;
      const later = errorNoticeText(e, "dailyLimitReached", RESET, words, { now: after, receivedAt, timeZone: "UTC" });
      assert.equal(later, e.dailyLimitCleared, loc);
      assert.ok(!/내일|tomorrow/i.test(later), later);
    }
  });

  it("[행동 보존] 잘못된 resetAt은 '지났다'로 보지 않는다 — 일반 문구", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    assert.equal(errorNoticeText(e, "dailyLimitReached", "garbage", KO, { now: after, receivedAt }), e.dailyLimitReached);
    assert.equal(errorNoticeText(e, "dailyLimitReached", null, KO, { now: after, receivedAt }), e.dailyLimitReached);
  });
});

// #558 검증 2차 P2-1 — resetAtPassed()가 서버의 resetAt을 **렌더 시점의 클라이언트 시계**와만 비교해,
// '알림이 resetAt을 넘겨 떠 있는 경우'와 '방금 거절된 경우'를 구분하지 못했다. 서버 23:59:30Z에 429
// (resetAt 00:00Z)가 오고 클라이언트 시계가 90초 빠르면(00:01:00Z) 방금 받은 거절에 "지금 다시 할 수
// 있어요"가 떴다 — 다시 누르면 또 429. UTC 자정 = KST 09:00(한국 사용자가 가장 많은 아침). 새 프로젝트
// 토스트는 받는 순간 한 번 계산하므로 긍정 문장만 10초 보이고 첫 검수가 시작되지 않았다는 사실이 사라졌다.
// → 받은 시각(receivedAt, 클라이언트 시계)을 함께 두고, receivedAt < resetAt ≤ now 일 때만 cleared.
describe("P2-1(2차): '지금 다시'는 리셋 **전에** 받은 알림이 리셋을 넘겨 떠 있을 때만", () => {
  const RESET_AT = "2026-09-29T00:00:00Z";
  const skewedNow = new Date("2026-09-29T00:01:00Z"); // 서버 23:59:30Z, 클라이언트 시계 +90초

  it("방금 받은 429 — 수신 시각이 이미 resetAt 뒤(시계 차이)면 'cleared'가 아니라 일반 문장 (KO/EN · 검수/수리)", () => {
    for (const [loc, words] of [["ko", KO], ["en", EN]]) {
      const d = getDictionary(loc).visualChecks;
      for (const e of [d.runErrors, d.repair.errors]) {
        const out = errorNoticeText(e, "dailyLimitReached", RESET_AT, words, {
          now: skewedNow,
          receivedAt: skewedNow.getTime(),
          timeZone: "Asia/Seoul",
        });
        assert.equal(out, e.dailyLimitReached, `${loc}: ${out}`);
        assert.notEqual(out, e.dailyLimitCleared);
      }
    }
  });

  it("수신 시각이 없으면(받는 순간 한 번 계산하는 새 프로젝트 토스트) 'cleared'를 내지 않는다", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(e, "dailyLimitReached", RESET_AT, KO, { now: skewedNow, timeZone: "Asia/Seoul" }),
      e.dailyLimitReached,
    );
  });

  it("수신 시각이 이상하면(NaN·문자열·Infinity·Date 객체) 'cleared'를 내지 않는다", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    for (const receivedAt of [Number.NaN, "2026-09-28T23:00:00Z", Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, new Date("2026-09-28T23:00:00Z")]) {
      assert.equal(
        errorNoticeText(e, "dailyLimitReached", RESET_AT, KO, { now: skewedNow, receivedAt, timeZone: "Asia/Seoul" }),
        e.dailyLimitReached,
        String(receivedAt),
      );
    }
  });

  it("[행동 보존] 리셋 1분 전에 받은 알림이 리셋을 넘겨 떠 있으면 'cleared' (1차 P2-1 그대로)", () => {
    const e = getDictionary("ko").visualChecks.runErrors;
    assert.equal(
      errorNoticeText(e, "dailyLimitReached", RESET_AT, KO, {
        now: skewedNow,
        receivedAt: Date.parse("2026-09-28T23:59:00Z"),
        timeZone: "Asia/Seoul",
      }),
      e.dailyLimitCleared,
    );
  });

  it("resetPassedSinceReceipt: receivedAt < resetAt ≤ now 일 때만 true", () => {
    const f = dl.resetPassedSinceReceipt;
    assert.equal(typeof f, "function");
    const r = Date.parse(RESET_AT);
    assert.equal(f(RESET_AT, r - 60_000, { now: new Date(r + 60_000) }), true);
    assert.equal(f(RESET_AT, r - 60_000, { now: new Date(r) }), true); // 경계 = 지남
    assert.equal(f(RESET_AT, r - 60_000, { now: new Date(r - 1) }), false); // 아직
    assert.equal(f(RESET_AT, r, { now: new Date(r + 60_000) }), false); // 리셋 시각에 받은 거절
    assert.equal(f(RESET_AT, r + 60_000, { now: new Date(r + 60_000) }), false); // 시계 차이
    assert.equal(f(RESET_AT, undefined, { now: new Date(r + 60_000) }), false);
    assert.equal(f("garbage", r - 60_000, { now: new Date(r + 60_000) }), false);
    assert.equal(f(null, r - 60_000, { now: new Date(r + 60_000) }), false);
  });

  it("옛 이름 resetAtPassed는 없다 — 받은 시각 없이 '지났다'를 판정하는 길을 남기지 않는다", () => {
    assert.equal("resetAtPassed" in dl, false);
  });
});
