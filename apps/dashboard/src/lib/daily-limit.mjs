// Train W — W-2 client (재정렬 D-7 amend [PILOT]: 검수 10/일 · 수리 5/일, UTC 일 기준).
//
// PURE — no network, no timers, no storage. The server answers a capped
// request with
//   429 { ok:false, error:"daily_limit_reached", kind:"inspection"|"repair", limit:<n>, resetAt:"<ISO>" }
// and the dashboard turns resetAt into the reader's own clock ("내일 오전 9시 이후",
// "after 8 PM today"). All sentence copy stays in the dictionary; this module
// only builds the "{when}" fragment and picks between the two templates.
//
// ★Why "today/tomorrow" is computed, not written: the reset is UTC midnight.
//  That is 09:00 the NEXT day in Seoul but 20:00 the SAME day in New York — a
//  hard-coded "tomorrow" would be false for half the readers.
//
// ★Locale-data independent: Korean/English hour words are assembled here from
//  numeric parts (formatToParts with hourCycle h23). ICU builds differ (Node on
//  Windows prints "AM 9시" for ko-KR where browsers print "오전 9시"); only the
//  time-zone conversion is delegated to Intl.

const DAY_MS = 86_400_000;
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isValidIso(v) {
  return typeof v === "string" && v.trim().length > 0 && !Number.isNaN(Date.parse(v));
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

function koTime(hour, minute) {
  const period = hour < 12 ? "오전" : "오후";
  const h = hour < 12 ? hour : hour === 12 ? 12 : hour - 12;
  return minute === 0 ? `${period} ${h}시` : `${period} ${h}시 ${minute}분`;
}

function enTime(hour, minute) {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h} ${suffix}` : `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * "When can I try again?" in the reader's language and clock.
 *   ko → "내일 오전 9시 이후" · "오늘 오후 5시 이후" · "10월 1일 오전 9시 이후"
 *   en → "after 9 AM tomorrow" · "after 8 PM today" · "after 9 AM on Oct 1"
 * Returns null when resetAt is missing, malformed or already past, or when the
 * time zone is unknown — the caller then falls back to the general sentence.
 *
 * @param {unknown} resetAt ISO timestamp from the 429 body
 * @param {"ko" | "en"} locale
 * @param {{ now?: Date, timeZone?: string }} [opts] now/timeZone are for tests; omit in the UI
 * @returns {string | null}
 */
export function formatResetAt(resetAt, locale, opts = {}) {
  if (!isValidIso(resetAt)) return null;
  const at = new Date(/** @type {string} */ (resetAt));
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
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
  if (locale === "ko") {
    const day = dayDiff === 0 ? "오늘" : dayDiff === 1 ? "내일" : `${a.month}월 ${a.day}일`;
    return `${day} ${koTime(a.hour, a.minute)} 이후`;
  }
  const day = dayDiff === 0 ? "today" : dayDiff === 1 ? "tomorrow" : `on ${EN_MONTHS[a.month - 1]} ${a.day}`;
  return `after ${enTime(a.hour, a.minute)} ${day}`;
}

/**
 * The sentence for an error notice. `errors` is a dictionary section
 * (t.visualChecks.runErrors or t.visualChecks.repair.errors). For the daily
 * cap, a valid future resetAt fills `dailyLimitReachedAt`'s "{when}";
 * otherwise the general `dailyLimitReached` sentence is used. Unknown keys
 * fall back to `generic` — the UI never renders an empty callout.
 *
 * @param {Record<string, string>} errors
 * @param {string} key
 * @param {string | null | undefined} resetAt
 * @param {"ko" | "en"} locale
 * @param {{ now?: Date, timeZone?: string }} [opts]
 * @returns {string}
 */
export function errorNoticeText(errors, key, resetAt, locale, opts) {
  if (key === "dailyLimitReached") {
    const when = formatResetAt(resetAt, locale, opts);
    const template = errors.dailyLimitReachedAt;
    if (when && typeof template === "string" && template.includes("{when}")) {
      return template.replace("{when}", when);
    }
  }
  const s = errors[key];
  return typeof s === "string" && s.length > 0 ? s : errors.generic ?? "";
}
