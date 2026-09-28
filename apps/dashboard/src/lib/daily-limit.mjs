// Train W — W-2 client (재정렬 D-7 amend [PILOT]: 검수 10/일 · 수리 5/일, UTC 일 기준).
//
// PURE — no network, no timers, no storage. The server answers a capped
// request with
//   429 { ok:false, error:"daily_limit_reached", kind:"inspection"|"repair", limit:<n>, resetAt:"<ISO>" }
// and the dashboard turns resetAt into the reader's own clock ("내일 오전 9시 이후",
// "after 8 PM today").
//
// ★All words live in the dictionary (t.visualChecks.resetWhen — #558 검증 P2-11):
//  "today/tomorrow/on <date>", AM/PM words, word order and the month names are
//  templates there. This module only computes numbers (time-zone conversion
//  via Intl.formatToParts) and fills the templates.
//
// ★Why "today/tomorrow" is computed, not written: the reset is UTC midnight.
//  That is 09:00 the NEXT day in Seoul but 20:00 the SAME day in New York — a
//  hard-coded "tomorrow" would be false for half the readers.
//
// ★Locale-data independent: hour/minute come from numeric parts (hourCycle
//  h23). ICU builds differ (Node on Windows prints "AM 9시" for ko-KR where
//  browsers print "오전 9시"); only the time-zone conversion is delegated to Intl.
//
// ★A notice outlives its resetAt (#558 검증 P2-1): the sentence is rebuilt on
//  every render with the current clock, so a cap notice still on screen after
//  the reset must say "you can check again now" — never "tomorrow".

const DAY_MS = 86_400_000;

/**
 * Dictionary fragments for "when can I try again" (t.visualChecks.resetWhen).
 * @typedef {{
 *   today: string, tomorrow: string, onDate: string,
 *   time: string, timeWithMinute: string,
 *   am: string, pm: string, midnightHour: string,
 *   months: readonly string[],
 * }} ResetWords
 */

function isValidIso(v) {
  return typeof v === "string" && v.trim().length > 0 && !Number.isNaN(Date.parse(v));
}

function nowFrom(opts) {
  const n = opts?.now;
  return n instanceof Date && !Number.isNaN(n.getTime()) ? n : new Date();
}

/** Replace each "{name}" with vars[name]; unknown names stay as written. */
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

/** @param {unknown} w @returns {w is ResetWords} */
function isResetWords(w) {
  if (!w || typeof w !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (w);
  for (const k of ["today", "tomorrow", "onDate", "time", "timeWithMinute", "am", "pm", "midnightHour"]) {
    if (typeof o[k] !== "string") return false;
  }
  return Array.isArray(o.months) && o.months.length === 12 && o.months.every((m) => typeof m === "string");
}

/**
 * Read a 429 daily-limit body. The body crosses a wire (JSON cast in the API
 * client), so every field is checked here; a malformed field becomes null
 * while the "you hit today's cap" fact is kept.
 *
 * @param {unknown} body
 * @returns {{ kind: "inspection" | "repair" | null, limit: number | null, resetAt: string | null } | null}
 */
export function readDailyLimit(body) {
  if (!body || typeof body !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  if (b.error !== "daily_limit_reached") return null;
  const kind = b.kind === "inspection" || b.kind === "repair" ? b.kind : null;
  const limit = typeof b.limit === "number" && Number.isInteger(b.limit) && b.limit > 0 ? b.limit : null;
  const resetAt = isValidIso(b.resetAt) ? /** @type {string} */ (b.resetAt) : null;
  return { kind, limit, resetAt };
}

/**
 * Calendar parts of `date` as seen in `timeZone` (undefined = the runtime's
 * own zone, i.e. the reader's browser). Throws RangeError on an unknown zone.
 */
function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type) => Number(parts.find((p) => p.type === type)?.value);
  const hour = num("hour") % 24; // some engines print "24" for midnight under h23
  return { year: num("year"), month: num("month"), day: num("day"), hour, minute: num("minute") };
}

/** Clock time from numbers + dictionary words (12-hour; midnight's hour number is a word too). */
function clockTime(hour, minute, words) {
  const h12 = hour % 12;
  const h = h12 !== 0 ? String(h12) : hour === 0 ? words.midnightHour : "12";
  const template = minute === 0 ? words.time : words.timeWithMinute;
  return fill(template, {
    period: hour < 12 ? words.am : words.pm,
    hour: h,
    minute: String(minute),
    mm: String(minute).padStart(2, "0"),
  });
}

/**
 * Has this (valid) reset time already passed? Invalid/missing values are not
 * "passed" — they stay on the general sentence.
 *
 * @param {unknown} resetAt
 * @param {{ now?: Date }} [opts]
 * @returns {boolean}
 */
export function resetAtPassed(resetAt, opts = {}) {
  if (!isValidIso(resetAt)) return false;
  return new Date(/** @type {string} */ (resetAt)).getTime() <= nowFrom(opts).getTime();
}

/**
 * "When can I try again?" in the reader's language (dictionary words) and clock.
 *   ko → "내일 오전 9시 이후" · "오늘 오후 5시 이후" · "10월 1일 오전 9시 이후"
 *   en → "after 9 AM tomorrow" · "after 8 PM today" · "after 9 AM on Oct 1"
 * Returns null when resetAt is missing, malformed or already past, when the
 * time zone is unknown, or when `words` is not a usable dictionary section —
 * the caller then uses another sentence (see errorNoticeText).
 *
 * @param {unknown} resetAt ISO timestamp from the 429 body
 * @param {unknown} words t.visualChecks.resetWhen
 * @param {{ now?: Date, timeZone?: string }} [opts] now/timeZone are for tests; omit in the UI
 * @returns {string | null}
 */
export function formatResetAt(resetAt, words, opts = {}) {
  if (!isValidIso(resetAt) || !isResetWords(words)) return null;
  const at = new Date(/** @type {string} */ (resetAt));
  const now = nowFrom(opts);
  if (at.getTime() <= now.getTime()) return null;
  let a;
  let n;
  try {
    a = partsIn(at, opts.timeZone);
    n = partsIn(now, opts.timeZone);
  } catch {
    return null;
  }
  if (![a.year, a.month, a.day, a.hour, a.minute, n.year, n.month, n.day].every(Number.isFinite)) return null;
  const dayDiff = Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / DAY_MS,
  );
  const time = clockTime(a.hour, a.minute, words);
  if (dayDiff === 0) return fill(words.today, { time });
  if (dayDiff === 1) return fill(words.tomorrow, { time });
  return fill(words.onDate, { month: words.months[a.month - 1] ?? String(a.month), day: String(a.day), time });
}

/**
 * The sentence for an error notice. `errors` is a dictionary section
 * (t.visualChecks.runErrors or t.visualChecks.repair.errors); `words` is
 * t.visualChecks.resetWhen. For the daily cap:
 *   - resetAt already passed (the notice outlived it) → `dailyLimitCleared`
 *     ("you can check again now") — never "tomorrow" (#558 검증 P2-1)
 *   - a valid future resetAt → `dailyLimitReachedAt` with "{when}" filled
 *   - otherwise → the general `dailyLimitReached` sentence
 * Unknown keys fall back to `generic` — the UI never renders an empty callout.
 *
 * @param {Record<string, string>} errors
 * @param {string} key
 * @param {string | null | undefined} resetAt
 * @param {unknown} words
 * @param {{ now?: Date, timeZone?: string }} [opts]
 * @returns {string}
 */
export function errorNoticeText(errors, key, resetAt, words, opts) {
  if (key === "dailyLimitReached") {
    if (resetAtPassed(resetAt, opts) && typeof errors.dailyLimitCleared === "string" && errors.dailyLimitCleared) {
      return errors.dailyLimitCleared;
    }
    const when = formatResetAt(resetAt, words, opts);
    const template = errors.dailyLimitReachedAt;
    if (when && typeof template === "string" && template.includes("{when}")) {
      return template.replace("{when}", when);
    }
  }
  const s = errors[key];
  return typeof s === "string" && s.length > 0 ? s : errors.generic ?? "";
}
