/**
 * SI 티어 Train B — B-7: S 모드 호스팅 사업자 의무 (D-6 "프로젝트별 킬스위치·신고 링크·요청 상한·금지 콘텐츠
 * 규칙·자동 정지 로그. 없으면 pilot start approved 불가").
 * D-6의 "자동 정지 로그"는 여기서 **모든 정지·해제·플래그가 빠짐없이 자동으로 남는 로그**(hosting_suspension_log)로
 * 집행한다 — 스테이지 B7 정의("…·정지 로그", 완료 기준 "관리자 1클릭 정지 → 410")와 같다. 트래픽 자동 정지는 하지
 * 않는다(아래). D-6 문구를 "트래픽 자동 정지 필수"로 읽는다면 그것은 D-6 amend 사안이다(PR #575 코멘트).
 *
 * Simsa가 `<slug>.simsa.page`에 대신 올려 준 앱이 피싱·스팸·성인·악성코드·불법 콘텐츠로 쓰이면:
 *   - **정지**: 정지 목록(Workers KV `HOSTING_SUSPENDED`, 키 `suspended:<slug>`)에 올리면 호스팅 라우터
 *     (apps/hosting-dispatch)가 그 주소에 410을 낸다. **정지는 관리자만 한다**(아래 "자동 경로"),
 *     모든 정지·해제·플래그는 **같은 표(hosting_suspension_log, 0073)**에 남는다.
 *   - **신고**: report.<root> 폼·API → hosting_reports(0073). 신고자 IP는 네트워크 단위(IPv4 주소 전체 · IPv6 /64)
 *     비밀 키 HMAC(`v1:`)으로만, 원문 저장 없음. 실제로 Simsa가 올린 앱(build_jobs의 slug)만 받는다.
 *     접수는 HOSTING_REPORTS_ENABLED가 정확히 "on"일 때만(방침 고지 전엔 꺼 둔다). 보유 180일([PILOT]) 뒤 크론이 지운다.
 *   - **자동 경로 = 운영자 알림(플래그)만**: 라우터가 slug당 요청 상한을 넘길 때 분 단위 `strike:<slug>:<YYYYMMDDHHmm>`를
 *     KV에 남기고, 10분 크론이 최근 60분 중 10분 이상이면 **플래그 행(action=flag, source=auto_flag)을 남기고 운영자에게
 *     알린다. 정지하지 않는다.** (PR #575 검증 P1: 예전엔 여기서 자동 정지했고, 정지는 자동 해제가 없어서 **제3자가
 *     10분 동안 요청을 몰아넣기만 해도 남의 앱이 무기한 410**이 됐다. 트래픽 양만으로는 앱 소유자의 잘못과 남이
 *     몰아넣은 요청을 구분할 수 없다 — 판단은 사람이 한다.)
 *
 * 순서 원칙(정지 로그가 먼저): 로그 행(applied=0) → KV 반영 → applied=1. 로그를 못 쓰면 KV를 건드리지 않는다
 * (기록 없는 정지는 없다). KV가 실패하면 행이 applied=0으로 남아 "시도했지만 반영 안 됨"이 보인다.
 * 플래그는 KV를 건드리지 않으므로 행 하나가 전부다(applied=1).
 *
 * 즉시성의 정직한 한계: 쓴 지역은 즉시, 다른 지역은 라우터 KV 캐시(30초, KV 하한)·KV 전파로 **최대 약 60초**.
 * 더 확실한 차단이 필요하면 유저 Worker 삭제(hosting-provision.ts deleteUserWorker)를 병행한다 — 그것도 엣지
 * 전파 지연이 있다(2026-09-25 실측).
 *
 * 값·키는 apps/hosting-dispatch/src/route.ts와 **같아야 한다**(라우터 테스트가 이 모듈 dist와 대조한다).
 */
import { z } from "zod";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { TelegramClient } from "../telegram.js";
import { SLUG_RE } from "./hosting-provision.js";
import { RESERVED_SLUGS_FOR_HOSTING } from "./hosting-reserved.js";
import { ipRateLimitKey, serviceRateLimitKey } from "./rate-limit-key.js";
import { consumeDailyCaps, DAILY_SLOT_CONSUME_SQL } from "./rate-limit.js";

// ─── 값 (라우터와 락스텝) ─────────────────────────────────────────────────────────

/** 정지·신고 사유. 0073 CHECK 목록과 라우터 신고 폼 라디오 값과 같다(테스트 대조). */
export const SUSPENSION_REASONS = ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];
/** 정지 로그 행의 출처. 정지·해제는 admin만, 요청 몰림 알림은 auto_flag(정지 아님). 0073 CHECK와 같다. */
export const LOG_SOURCES = ["admin", "auto_flag"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const SUSPENDED_KEY_PREFIX = "suspended:";
export const STRIKE_KEY_PREFIX = "strike:";
export const REPORT_HOST_LABEL = "report";
export const RULES_PATH = "/rules";

/** 정지가 모든 지역에 보이기까지의 상한(초) — 응답에 그대로 싣는다(즉시라고 말하지 않는다). */
export const SUSPENSION_PROPAGATION_SECONDS = 60;

/**
 * [PILOT] 요청 몰림 플래그: 최근 windowMinutes분 중 minStrikeMinutes분 이상 상한 초과면 운영자에게 알리고 플래그 행을
 * 남긴다(정지 아님). 같은 앱은 reflagAfterHours 동안 다시 알리지 않는다(알림 폭주 방지).
 */
export const AUTO_FLAG = { windowMinutes: 60, minStrikeMinutes: 10, reflagAfterHours: 6, maxListPages: 20 } as const;

/**
 * [PILOT] 신고 남용 상한(UTC 하루).
 *  - perNetworkDaily: 같은 네트워크(IPv4 주소 · IPv6 /64) 10건 → 넘으면 거절(429 / error=limit).
 *  - perAppDaily: 같은 앱 50건 → 넘으면 거절(error=app_limit, "이미 많이 들어와 확인 중"). 저장량의 상한 —
 *    신고 대상이 실제로 올라간 앱(build_jobs)으로 좁혀져 있어 전체 저장량이 앱 수 × 50으로 묶인다.
 *    한 앱을 막아도 다른 앱 신고는 그대로 열려 있다(예전 서비스 전체 300건 거절은 누구나 하루 동안 신고 창구 전체를
 *    닫을 수 있었다 — PR #575 검증 P1).
 *  - serviceDailyNotice: 서비스 전체 300건 — **거절하지 않는다**. 저장은 계속하고, 운영자 알림 묶음에 "평소보다 많다"만 적는다.
 */
export const REPORT_CAPS = { perNetworkDaily: 10, perAppDaily: 50, serviceDailyNotice: 300 } as const;

/** [PILOT] hosting_reports 보유 기간(일). 방침 고지와 같은 값이어야 한다. 6시간 크론이 지난 행을 지운다. */
export const REPORT_RETENTION_DAYS = 180;

/**
 * 운영자 알림 묶음: 신고마다 DM을 보내지 않는다(신고 폭탄 = DM 폭탄이었다 — PR #575 검증 P1).
 * UTC 한 시간에 최대 한 통. 그 시간의 첫 신고는 바로 알리고, 나머지는 다음 시간의 10분 크론이 한 통으로 모아 보낸다.
 */
export const REPORT_DIGEST = { perHour: 1, maxSlugsListed: 10, excerptChars: 150, maxRowsRead: 200 } as const;

// ─── 순수 헬퍼 ────────────────────────────────────────────────────────────────────

export function normalizeRootDomain(rootDomain: string): string {
  return rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/** 유저 앱이 가질 수 있는 slug인가(라우터 규칙 = 정규식 && 예약어 아님). */
export function isHostableSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS_FOR_HOSTING.has(slug);
}

export function suspendedKey(slug: string): string {
  return `${SUSPENDED_KEY_PREFIX}${slug}`;
}

/** `strike:<slug>:<YYYYMMDDHHmm>` → { slug, minute }. 형식이 다르면 null. */
export function parseStrikeKey(key: string): { slug: string; minute: string } | null {
  if (!key.startsWith(STRIKE_KEY_PREFIX)) return null;
  const rest = key.slice(STRIKE_KEY_PREFIX.length);
  const i = rest.lastIndexOf(":");
  if (i <= 0) return null;
  const slug = rest.slice(0, i);
  const minute = rest.slice(i + 1);
  if (!SLUG_RE.test(slug) || !/^\d{12}$/.test(minute)) return null;
  return { slug, minute };
}

function minuteStartMs(minute: string): number {
  return Date.UTC(
    Number(minute.slice(0, 4)),
    Number(minute.slice(4, 6)) - 1,
    Number(minute.slice(6, 8)),
    Number(minute.slice(8, 10)),
    Number(minute.slice(10, 12)),
  );
}

/** 신고 사이트 origin — 폼 전송을 받는 유일한 Origin이자 303 복귀처. */
export function reportSiteOrigin(rootDomain: string): string {
  return `https://${REPORT_HOST_LABEL}.${normalizeRootDomain(rootDomain)}`;
}

/** 영수증·내 앱 카드·호스팅 약관이 가리킬 신고 주소. */
export function hostingReportUrl(slug: string, rootDomain: string): string {
  const base = `${reportSiteOrigin(rootDomain)}/`;
  return isHostableSlug(slug) ? `${base}?app=${slug}` : base;
}

/** 호스팅 이용 규칙 공개 주소(금지 콘텐츠·신고·정지·이의). */
export function hostingRulesUrl(rootDomain: string): string {
  return `${reportSiteOrigin(rootDomain)}${RULES_PATH}`;
}

/** 신고 접수가 켜져 있나 — 정확히 "on"일 때만(미설정·"true"·"1"·오타는 꺼짐). */
export function reportsOpen(env: Pick<Env, "HOSTING_REPORTS_ENABLED">): boolean {
  return env.HOSTING_REPORTS_ENABLED === "on";
}

/**
 * 신고 폼의 "앱 주소" 입력 → slug. slug 자체·`<slug>.<root>`·`https://<slug>.<root>/…` 모두 받는다.
 * 우리 호스팅 주소가 아니거나(다른 도메인·중첩·예약어) 한글 등 slug가 될 수 없는 값이면 null.
 */
export function normalizeReportedApp(input: string, rootDomain: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (isHostableSlug(raw)) return raw;
  let host: string;
  if (/^[a-z][a-z0-9+.-]*:/.test(raw)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname;
  } else {
    host = raw.split(/[/?#]/)[0] ?? "";
  }
  host = host.replace(/\.$/, "");
  const root = normalizeRootDomain(rootDomain);
  if (!root || !host.endsWith(`.${root}`)) return null;
  const label = host.slice(0, -(root.length + 1));
  return isHostableSlug(label) ? label : null;
}

function parseIpv4(s: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const b = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
  return b.every((x) => x <= 255) ? [b[0], b[1], b[2], b[3]] : null;
}

/** IPv6 문자열 → 16비트 그룹 8개(압축 `::`·끝의 점 표기 IPv4 포함). 형식이 틀리면 null. */
function parseIpv6(input: string): number[] | null {
  let s = input.split("%")[0] ?? "";
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted?.[1]) {
    const v4 = parseIpv4(dotted[1]);
    if (!v4) return null;
    s = `${s.slice(0, dotted.index)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string | undefined): string[] => (part ? part.split(":") : []);
  const left = toGroups(halves[0]);
  const right = toGroups(halves[1]);
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

/**
 * 신고자 "네트워크" — 남용 상한과 신고자 키의 단위(원문은 어디에도 저장·기록하지 않는다, 곧바로 HMAC).
 *  - IPv4: 주소 전체.
 *  - IPv6: 앞 64비트(/64). 한 가입자·한 기기는 보통 /64 하나를 통째로 받아 그 안에서 주소를 마음대로 바꿀 수 있다 —
 *    주소 전체를 키로 쓰면 주소만 바꿔 상한을 무한히 넘을 수 있었다(PR #575 검증 P1).
 *  - IPv4-mapped IPv6(`::ffff:a.b.c.d`)는 IPv4로 본다.
 *  - 비었거나 IP가 아니면 그 문자열 자체(cf-connecting-ip는 항상 IP다 — 로컬 개발의 "unknown" 등).
 */
export function reporterNetwork(ip: string): string {
  const raw = ip.trim().toLowerCase();
  const v4 = parseIpv4(raw);
  if (v4) return `v4:${v4.join(".")}`;
  if (raw.includes(":")) {
    const g = parseIpv6(raw);
    if (g) {
      const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
      if (mapped) {
        const hi = g[6] ?? 0;
        const lo = g[7] ?? 0;
        return `v4:${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      }
      return `v6:${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
    }
  }
  return `raw:${raw || "unknown"}`;
}

// ─── 외부 경계(Zod) ───────────────────────────────────────────────────────────────

const memoSchema = z.string().trim().max(1000);

export const SuspendBodySchema = z.object({ reason: z.enum(SUSPENSION_REASONS), memo: memoSchema.optional() }).strict();
export const UnsuspendBodySchema = z.object({ memo: memoSchema.optional() }).strict();
export const ReportBodySchema = z
  .object({
    app: z.string().trim().min(1).max(300),
    reason: z.enum(SUSPENSION_REASONS),
    description: z.string().trim().max(1000).optional(),
    contact: z.string().trim().max(200).optional(),
    lang: z.enum(["ko", "en"]).optional(),
  })
  .strict();
export type ReportBody = z.infer<typeof ReportBodySchema>;

// ─── SQL (0073) ───────────────────────────────────────────────────────────────────

export const SUSPENSION_LOG_INSERT_SQL =
  "INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, memo, applied, created_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)";
export const SUSPENSION_LOG_APPLIED_SQL = "UPDATE hosting_suspension_log SET applied = 1, applied_at = ? WHERE id = ?";
/** 플래그 = KV를 건드리지 않는 기록 한 줄(applied=1 — 기록한 것이 곧 전부다). Binds: (id, slug, actor, memo, at, at). */
export const FLAG_INSERT_SQL =
  "INSERT INTO hosting_suspension_log (id, slug, action, reason, source, actor, memo, applied, created_at, applied_at) VALUES (?, ?, 'flag', NULL, 'auto_flag', ?, ?, 1, ?, ?)";
const LAST_FLAG_SQL = "SELECT created_at FROM hosting_suspension_log WHERE slug = ? AND action = 'flag' ORDER BY created_at DESC LIMIT 1";
export const REPORT_INSERT_SQL =
  "INSERT INTO hosting_reports (id, slug, reason, description, contact, reporter_key, lang, app_verified, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)";
/** 관리자 정지가 그 앱의 열린 신고를 닫는다 — 닫은 정지 로그 id를 남긴다. Binds: (logId, slug). */
export const REPORTS_ACTIONED_SQL = "UPDATE hosting_reports SET status = 'actioned', actioned_log_id = ? WHERE slug = ? AND status = 'open'";
/** 해제가 정지로 닫혔던 신고를 다시 연다(운영자가 직접 닫은 dismissed는 그대로). Binds: (slug). */
export const REPORTS_REOPEN_SQL =
  "UPDATE hosting_reports SET status = 'open', actioned_log_id = NULL WHERE slug = ? AND status = 'actioned' AND actioned_log_id IS NOT NULL";
/** Simsa가 이 slug로 앱을 올렸나 — build_jobs가 유일한 프로비저닝 경로다(POST /workspace/build-jobs가 행을 먼저 쓴다). */
export const BUILD_JOB_SLUG_SQL = "SELECT 1 AS found FROM build_jobs WHERE slug = ? LIMIT 1";
export const SUSPENSION_LOG_RECENT_SQL =
  "SELECT id, action, reason, source, actor, memo, applied, created_at, applied_at FROM hosting_suspension_log WHERE slug = ? ORDER BY created_at DESC LIMIT 20";
export const REPORTS_RECENT_SQL =
  "SELECT id, reason, description, contact, status, app_verified, actioned_log_id, created_at FROM hosting_reports WHERE slug = ? ORDER BY created_at DESC LIMIT 20";
const DIGEST_PENDING_SQL =
  "SELECT slug, reason, description, app_verified FROM hosting_reports WHERE notified_at IS NULL AND created_at <= ? ORDER BY created_at LIMIT ?";
const DIGEST_PENDING_COUNT_SQL = "SELECT COUNT(*) AS n FROM hosting_reports WHERE notified_at IS NULL AND created_at <= ?";
const DIGEST_MARK_SQL = "UPDATE hosting_reports SET notified_at = ? WHERE notified_at IS NULL AND created_at <= ?";
const REPORTS_SINCE_COUNT_SQL = "SELECT COUNT(*) AS n FROM hosting_reports WHERE created_at >= ?";
/** Binds: (cutoffIso, batchLimit). */
export const HOSTING_REPORTS_PURGE_SQL = `DELETE FROM hosting_reports
 WHERE rowid IN (
   SELECT rowid FROM hosting_reports
    WHERE created_at <= ?
    LIMIT ?)`;

// ─── 로그·알림 ────────────────────────────────────────────────────────────────────

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

function logLine(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export type DutyDeps = { fetch?: FetchLike; now?: () => Date };

/** 알림이 신고 응답을 붙잡는 최대 시간 — Telegram이 멈춰도 신고자는 기다리지 않는다. */
export const NOTIFY_TIMEOUT_MS = 4000;

function telegramTarget(env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "FOUNDER_TG_CHAT_ID">): { token: string; chatId: number } | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = env.FOUNDER_TG_CHAT_ID?.trim();
  if (!token || !chat) return null;
  const chatId = Number.parseInt(chat, 10);
  return Number.isFinite(chatId) ? { token, chatId } : null;
}

/**
 * 운영자 알림 — 기존 창구(파운더 Telegram DM: TELEGRAM_BOT_TOKEN + FOUNDER_TG_CHAT_ID) 재사용.
 * 둘 중 하나라도 없으면 false(호출자는 JSON 로그 한 줄을 이미 남긴다). 실패·시간 초과는 삼킨다(신고 접수를 막지 않는다).
 */
export async function notifyOperator(env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "FOUNDER_TG_CHAT_ID">, text: string, fetchImpl?: FetchLike): Promise<boolean> {
  const target = telegramTarget(env);
  if (!target) return false;
  const base = fetchImpl ?? ((input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => fetch(input, init));
  const timed: FetchLike = (input, init) => base(input, { ...(init ?? {}), signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS) });
  try {
    const tg = new TelegramClient({ token: target.token, fetch: timed });
    await tg.sendMessage({ chatId: target.chatId, text: text.slice(0, 3500) });
    return true;
  } catch (e) {
    logLine({ event: "hosting_operator_notify_failed", message: errorMessage(e) });
    return false;
  }
}

/** 운영자가 정지·해제를 누르는 곳(Actions 워크플로 — 토큰은 repo secret에만 있다). */
export const HOSTING_DUTY_WORKFLOW_URL = "https://github.com/3SVS/simsa/actions/workflows/hosting-duty.yml";

// ─── 정지·해제 (관리자) ───────────────────────────────────────────────────────────

export type SuspensionOutcome =
  | {
      ok: true;
      action: "suspend" | "unsuspend";
      slug: string;
      logId: string;
      applied: true;
      /** false = KV 반영은 됐지만 applied=1 기록을 못 했다(로그 행은 남아 있음, JSON 로그에 흔적). */
      appliedRecorded: boolean;
      propagationSeconds: number;
    }
  | { ok: false; error: "invalid_slug" | "store_not_configured" | "log_unavailable" | "store_failed"; logId?: string };

type LogRow = {
  slug: string;
  action: "suspend" | "unsuspend";
  reason: SuspensionReason | null;
  actor: string;
  memo: string | null;
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function logThenApply(env: Env, row: LogRow, apply: (kv: KVNamespace, logId: string, at: string) => Promise<void>, now: Date): Promise<SuspensionOutcome> {
  if (!isHostableSlug(row.slug)) return { ok: false, error: "invalid_slug" };
  const kv = env.HOSTING_SUSPENDED;
  if (!kv) {
    logLine({ event: "hosting_suspension_not_applied", reason: "no_binding", slug: row.slug, action: row.action });
    return { ok: false, error: "store_not_configured" };
  }
  const logId = newId("hsl");
  const at = now.toISOString();
  try {
    await env.DB.prepare(SUSPENSION_LOG_INSERT_SQL).bind(logId, row.slug, row.action, row.reason, "admin", row.actor, row.memo, at).run();
  } catch (e) {
    logLine({ event: "hosting_suspension_not_applied", reason: "log_unavailable", slug: row.slug, action: row.action, message: errorMessage(e) });
    return { ok: false, error: "log_unavailable" };
  }
  try {
    await apply(kv, logId, at);
  } catch (e) {
    logLine({ event: "hosting_suspension_not_applied", reason: "store_failed", slug: row.slug, action: row.action, logId, message: errorMessage(e) });
    return { ok: false, error: "store_failed", logId };
  }
  let appliedRecorded = true;
  try {
    await env.DB.prepare(SUSPENSION_LOG_APPLIED_SQL).bind(new Date().toISOString(), logId).run();
  } catch (e) {
    appliedRecorded = false;
    logLine({ event: "hosting_suspension_applied_flag_failed", slug: row.slug, action: row.action, logId, message: errorMessage(e) });
  }
  logLine({ event: "hosting_suspension_applied", slug: row.slug, action: row.action, reason: row.reason, source: "admin", logId });
  return { ok: true, action: row.action, slug: row.slug, logId, applied: true, appliedRecorded, propagationSeconds: SUSPENSION_PROPAGATION_SECONDS };
}

export type SuspendInput = { slug: string; reason: SuspensionReason; actor: string; memo?: string | null };

/**
 * 정지 — **관리자만**(관리자 라우트 → Actions hosting-duty). 자동 경로는 이 함수를 부르지 않는다(플래그만).
 * 성공하면 그 앱의 열린 신고를 actioned로 닫고, 닫은 정지 로그 id를 신고 행에 남긴다(해제 때 되돌리려고).
 */
export async function suspendHostedApp(env: Env, input: SuspendInput, deps: DutyDeps = {}): Promise<SuspensionOutcome> {
  const now = deps.now?.() ?? new Date();
  const out = await logThenApply(
    env,
    { slug: input.slug, action: "suspend", reason: input.reason, actor: input.actor, memo: input.memo?.trim() || null },
    (kv, logId, at) => kv.put(suspendedKey(input.slug), JSON.stringify({ v: 1, reason: input.reason, source: "admin", at, logId })),
    now,
  );
  if (!out.ok) return out;
  await env.DB.prepare(REPORTS_ACTIONED_SQL)
    .bind(out.logId, input.slug)
    .run()
    .catch((e: unknown) => logLine({ event: "hosting_reports_actioned_failed", slug: input.slug, logId: out.logId, message: errorMessage(e) }));
  return out;
}

/** 해제 — KV 키 삭제 + 같은 표에 unsuspend 행 + 정지로 닫혔던 신고를 다시 연다. */
export async function unsuspendHostedApp(env: Env, input: { slug: string; actor: string; memo?: string | null }, deps: DutyDeps = {}): Promise<SuspensionOutcome> {
  const now = deps.now?.() ?? new Date();
  const out = await logThenApply(
    env,
    { slug: input.slug, action: "unsuspend", reason: null, actor: input.actor, memo: input.memo?.trim() || null },
    (kv) => kv.delete(suspendedKey(input.slug)),
    now,
  );
  if (!out.ok) return out;
  await env.DB.prepare(REPORTS_REOPEN_SQL)
    .bind(input.slug)
    .run()
    .catch((e: unknown) => logLine({ event: "hosting_reports_reopen_failed", slug: input.slug, logId: out.logId, message: errorMessage(e) }));
  return out;
}

// ─── 요청 몰림 플래그 스윕(10분 크론) — 정지하지 않는다 ────────────────────────────

export type StrikeSweepResult = {
  skipped?: "no_binding";
  scanned: number;
  candidates: string[];
  /** 이번에 플래그를 남기고 운영자에게 알린 앱. */
  flagged: string[];
  alreadySuspended: string[];
  /** reflagAfterHours 안에 이미 알린 앱(다시 알리지 않음). */
  recentlyFlagged: string[];
  failed: Array<{ slug: string; error: string }>;
  notified: boolean;
};

export async function sweepHostingRateStrikes(env: Env, now: Date = new Date(), deps: DutyDeps = {}): Promise<StrikeSweepResult> {
  const result: StrikeSweepResult = { scanned: 0, candidates: [], flagged: [], alreadySuspended: [], recentlyFlagged: [], failed: [], notified: false };
  const kv = env.HOSTING_SUSPENDED;
  if (!kv) return { ...result, skipped: "no_binding" };

  const windowStart = now.getTime() - AUTO_FLAG.windowMinutes * 60_000;
  const minutesBySlug = new Map<string, Set<string>>();
  let cursor: string | undefined;
  for (let page = 0; page < AUTO_FLAG.maxListPages; page++) {
    const listed = await kv.list(cursor ? { prefix: STRIKE_KEY_PREFIX, cursor } : { prefix: STRIKE_KEY_PREFIX });
    for (const k of listed.keys) {
      result.scanned++;
      const p = parseStrikeKey(k.name);
      if (!p) continue;
      const t = minuteStartMs(p.minute);
      if (t < windowStart || t > now.getTime()) continue;
      const set = minutesBySlug.get(p.slug) ?? new Set<string>();
      set.add(p.minute);
      minutesBySlug.set(p.slug, set);
    }
    if (listed.list_complete) break;
    cursor = listed.cursor;
  }

  const lines: string[] = [];
  for (const [slug, minutes] of minutesBySlug) {
    if (minutes.size < AUTO_FLAG.minStrikeMinutes) continue;
    result.candidates.push(slug);
    if ((await kv.get(suspendedKey(slug))) !== null) {
      result.alreadySuspended.push(slug);
      continue;
    }
    const last = await env.DB.prepare(LAST_FLAG_SQL)
      .bind(slug)
      .first<{ created_at: string }>()
      .catch(() => null);
    if (last && now.getTime() - Date.parse(last.created_at) < AUTO_FLAG.reflagAfterHours * 3_600_000) {
      result.recentlyFlagged.push(slug);
      continue;
    }
    const at = now.toISOString();
    const memo = `rate_limit_sustained: over the per-app request cap in ${minutes.size} of the last ${AUTO_FLAG.windowMinutes} minutes (not suspended)`;
    try {
      await env.DB.prepare(FLAG_INSERT_SQL).bind(newId("hsl"), slug, "auto:rate-limit", memo, at, at).run();
    } catch (e) {
      logLine({ event: "hosting_flag_not_recorded", slug, message: errorMessage(e) });
      result.failed.push({ slug, error: "log_unavailable" });
      continue;
    }
    result.flagged.push(slug);
    lines.push(`- ${slug}: 최근 ${AUTO_FLAG.windowMinutes}분 중 ${minutes.size}분 요청 상한 초과`);
  }

  if (lines.length > 0) {
    result.notified = await notifyOperator(
      env,
      `⚠️ Simsa 호스팅 요청 몰림 (정지하지 않았어요)\n${lines.join("\n")}\n\n` +
        `남이 몰아넣은 요청일 수도 있어 자동으로 정지하지 않았어요. 앱을 열어 보고 규칙 위반이면 정지: ${HOSTING_DUTY_WORKFLOW_URL} (action=suspend, slug=…)\n` +
        `방문자는 그동안 잠깐 '잠시 후 다시 시도해 주세요' 안내를 볼 수 있어요.`,
      deps.fetch,
    );
  }
  return result;
}

// ─── 신고 ─────────────────────────────────────────────────────────────────────────

export type HostedAppStatus = "known" | "unknown" | "unverified";

/**
 * 신고 대상이 Simsa가 실제로 올린 앱인가 — Worker가 가진 정보(build_jobs)로 판단한다.
 *  - known: build_jobs에 이 slug가 있다(앱을 만드는 유일한 경로 — 잡 행이 배포보다 먼저 생긴다).
 *  - unknown: 조회는 됐는데 없다 → 신고를 받지 않는다(없는 앱 이름으로 저장·알림을 채우지 못하게).
 *  - unverified: 조회 자체가 실패했다 → **받되 표시**(app_verified=0) — 우리 사정으로 진짜 신고를 버리지 않는다.
 */
export async function hostedAppStatus(env: Pick<Env, "DB">, slug: string): Promise<HostedAppStatus> {
  try {
    const row = await env.DB.prepare(BUILD_JOB_SLUG_SQL).bind(slug).first<{ found: number }>();
    return row ? "known" : "unknown";
  } catch (e) {
    logLine({ event: "hosting_report_app_unverified", slug, message: errorMessage(e) });
    return "unverified";
  }
}

export type ReportOutcome =
  | { ok: true; reportId: string; slug: string; appVerified: boolean; notified: boolean; digest: DigestResult["status"] }
  | { ok: false; error: "invalid_app"; slug: null }
  | { ok: false; error: "not_hosted"; slug: string }
  | { ok: false; error: "report_limit"; slug: string; retryAfterSeconds: number }
  | { ok: false; error: "app_report_limit"; slug: string; retryAfterSeconds: number }
  | { ok: false; error: "report_unavailable"; slug: string };

/**
 * 신고 저장. `body`는 ReportBodySchema를 통과한 값, `ip`는 cf-connecting-ip(저장·로그에 원문으로 가지 않는다).
 * 순서: 주소 정규화 → 실제로 올라간 앱인가 → 남용 상한(네트워크·앱, 원자적 일일 슬롯) → HMAC 신고자 키 →
 *       저장(실패 시 슬롯 환급) → 운영자 알림 묶음(시간당 한 통).
 * 스위치(HOSTING_REPORTS_ENABLED)는 라우트가 먼저 본다.
 * 신고만으로 자동 정지하지 않는다 — 신고 폭탄으로 남의 앱을 내리는 공격을 막기 위해 판단은 사람이 한다.
 */
export async function recordHostingReport(env: Env, body: ReportBody, ip: string, deps: DutyDeps = {}): Promise<ReportOutcome> {
  const now = deps.now?.() ?? new Date();
  const slug = normalizeReportedApp(body.app, env.HOSTING_ROOT_DOMAIN ?? "");
  if (!slug) return { ok: false, error: "invalid_app", slug: null };
  const appStatus = await hostedAppStatus(env, slug);
  if (appStatus === "unknown") {
    logLine({ event: "hosting_report_not_hosted", slug });
    return { ok: false, error: "not_hosted", slug };
  }

  const network = reporterNetwork(ip);
  const caps = await consumeDailyCaps(
    env,
    [
      { scope: "network", bucket: "hosting-report-daily-net", key: network, limit: REPORT_CAPS.perNetworkDaily },
      // 앱 이름은 사람에 대한 값이 아니다 — service 범위(고정 키 sha256)로 센다.
      { scope: "service", bucket: "hosting-report-daily-app", key: slug, limit: REPORT_CAPS.perAppDaily },
    ],
    now,
  );
  if (caps.limited) {
    logLine({ event: "hosting_report_limited", slug, scope: caps.scope });
    return caps.scope === "network"
      ? { ok: false, error: "report_limit", slug, retryAfterSeconds: caps.retryAfterSeconds }
      : { ok: false, error: "app_report_limit", slug, retryAfterSeconds: caps.retryAfterSeconds };
  }

  const reporterKey = await ipRateLimitKey(env, "hosting-report-reporter", network);
  const reportId = newId("hrp");
  const description = body.description ?? "";
  const contact = body.contact?.trim() ? body.contact.trim() : null;
  const appVerified = appStatus === "known";
  try {
    await env.DB.prepare(REPORT_INSERT_SQL)
      .bind(reportId, slug, body.reason, description, contact, reporterKey, body.lang ?? null, appVerified ? 1 : 0, now.toISOString())
      .run();
  } catch (e) {
    await caps.refund();
    logLine({ event: "hosting_report_not_saved", slug, message: errorMessage(e) });
    return { ok: false, error: "report_unavailable", slug };
  }

  const digest = await sendReportDigest(env, now, deps);
  logLine({ event: "hosting_report_received", slug, reason: body.reason, reportId, appVerified, digest: digest.status, hasContact: contact !== null });
  return { ok: true, reportId, slug, appVerified, notified: digest.status === "sent", digest: digest.status };
}

// ─── 운영자 알림 묶음(시간당 한 통) ────────────────────────────────────────────────

export type DigestResult = {
  status: "sent" | "nothing_pending" | "batched" | "not_configured" | "send_failed" | "read_failed";
  reports: number;
};

/** UTC 시간 키 "2026-09-30T14" — workspace_rate_limit의 시간 창 형식(48시간 뒤 rate-limit-retention이 지운다). */
function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/**
 * 이 UTC 시간의 알림 자리 하나를 원자적으로 잡는다(DAILY_SLOT_CONSUME_SQL을 시간 키로). 잡았으면 true.
 * D1 오류는 **못 잡은 것**으로 본다 — 알림이 폭주하는 쪽으로 실패하지 않는다(신고는 이미 저장됐고 다음 크론이 다시 본다).
 */
async function takeDigestSlot(env: Pick<Env, "DB">, now: Date): Promise<boolean> {
  try {
    const key = await serviceRateLimitKey("hosting-report-digest", "all");
    const nowIso = now.toISOString();
    const r: { meta?: { changes?: unknown } } | null | undefined = await env.DB.prepare(DAILY_SLOT_CONSUME_SQL)
      .bind(key, hourKey(now), nowIso, nowIso, REPORT_DIGEST.perHour)
      .run();
    const changes = r?.meta?.changes;
    return typeof changes === "number" && changes > 0;
  } catch (e) {
    logLine({ event: "hosting_report_digest_slot_failed", message: errorMessage(e) });
    return false;
  }
}

function summarize(rows: Array<{ slug: string; reason: string; description: string | null; app_verified: number | null }>): string[] {
  const bySlug = new Map<string, { n: number; reasons: Map<string, number>; excerpt: string; unverified: boolean }>();
  for (const r of rows) {
    const s = bySlug.get(r.slug) ?? { n: 0, reasons: new Map<string, number>(), excerpt: "", unverified: false };
    s.n++;
    s.reasons.set(r.reason, (s.reasons.get(r.reason) ?? 0) + 1);
    const d = (r.description ?? "").trim();
    if (!s.excerpt && d) s.excerpt = d.length > REPORT_DIGEST.excerptChars ? `${d.slice(0, REPORT_DIGEST.excerptChars)}…` : d;
    if (r.app_verified === 0) s.unverified = true;
    bySlug.set(r.slug, s);
  }
  const sorted = [...bySlug.entries()].sort((a, b) => b[1].n - a[1].n);
  const lines = sorted.slice(0, REPORT_DIGEST.maxSlugsListed).map(([slug, s]) => {
    const reasons = [...s.reasons.entries()].map(([k, v]) => `${k} ${v}`).join(", ");
    return `- ${slug}: ${s.n}건 (${reasons})${s.unverified ? " · 앱 확인 못 함" : ""}${s.excerpt ? ` — "${s.excerpt}"` : ""}`;
  });
  if (sorted.length > REPORT_DIGEST.maxSlugsListed) lines.push(`- …외 ${sorted.length - REPORT_DIGEST.maxSlugsListed}개 앱`);
  return lines;
}

/**
 * 아직 알리지 않은 신고를 한 통으로 묶어 보낸다 — UTC 한 시간에 한 통. 신고 저장 직후와 10분 크론이 부른다.
 * 연락처·IP·신고자 키는 싣지 않는다(연락처는 D1에만 — Cloudflare 대시보드 D1 콘솔에서 운영자가 본다).
 * 보내지 못하면(Telegram 미설정·실패) 신고는 "안 알림"으로 남아 다음 기회에 다시 묶인다.
 */
export async function sendReportDigest(env: Env, now: Date = new Date(), deps: DutyDeps = {}): Promise<DigestResult> {
  if (!telegramTarget(env)) return { status: "not_configured", reports: 0 };
  const cutoff = now.toISOString();
  let pending: number;
  try {
    const row = await env.DB.prepare(DIGEST_PENDING_COUNT_SQL).bind(cutoff).first<{ n: number }>();
    pending = Number(row?.n ?? 0);
  } catch (e) {
    logLine({ event: "hosting_report_digest_read_failed", message: errorMessage(e) });
    return { status: "read_failed", reports: 0 };
  }
  if (pending === 0) return { status: "nothing_pending", reports: 0 };
  if (!(await takeDigestSlot(env, now))) return { status: "batched", reports: pending };

  let rows: Array<{ slug: string; reason: string; description: string | null; app_verified: number | null }>;
  let today = 0;
  try {
    const res = await env.DB.prepare(DIGEST_PENDING_SQL).bind(cutoff, REPORT_DIGEST.maxRowsRead).all<{ slug: string; reason: string; description: string | null; app_verified: number | null }>();
    rows = res.results ?? [];
    const t = await env.DB.prepare(REPORTS_SINCE_COUNT_SQL).bind(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).first<{ n: number }>();
    today = Number(t?.n ?? 0);
  } catch (e) {
    logLine({ event: "hosting_report_digest_read_failed", message: errorMessage(e) });
    return { status: "read_failed", reports: pending };
  }
  const flood = today >= REPORT_CAPS.serviceDailyNotice ? ` — 평소보다 많아요(누군가 몰아넣는 중일 수 있어요. 받기는 계속해요)` : "";
  const text =
    `🚩 Simsa 호스팅 신고 ${pending}건 (지난 알림 이후)\n${summarize(rows).join("\n")}\n` +
    `오늘(UTC) 신고 ${today}건${flood}\n\n` +
    `정지: ${HOSTING_DUTY_WORKFLOW_URL} (action=suspend, slug=…) · 신고 전문·연락처: D1 콘솔 hosting_reports\n` +
    `알림은 한 시간에 한 번 묶어서 보내요.`;
  const sent = await notifyOperator(env, text, deps.fetch);
  if (!sent) return { status: "send_failed", reports: pending };
  await env.DB.prepare(DIGEST_MARK_SQL)
    .bind(now.toISOString(), cutoff)
    .run()
    .catch((e: unknown) => logLine({ event: "hosting_report_digest_mark_failed", message: errorMessage(e) }));
  return { status: "sent", reports: pending };
}

// ─── 보유 기간 청소(6시간 크론) ────────────────────────────────────────────────────

const PURGE_BATCH = 5_000;
const PURGE_MAX_BATCHES = 20;

export type ReportPurgeResult = { cutoff: string; deleted: number; batches: number; more: boolean; error?: string };

/**
 * REPORT_RETENTION_DAYS가 지난 신고 행을 지운다(연락처·자유 서술 포함 — 방침의 보유 기간 약속). 크론 관례는
 * rate-limit-retention.ts와 같다: rowid 부분 질의 + LIMIT로 잘게, 한 번에 최대 20×5,000, 남으면 다음 틱(`more`).
 * 던지지 않는다 — 청소 문제가 그 크론 틱을 깨지 않는다.
 */
export async function purgeExpiredHostingReports(env: Pick<Env, "DB">, now: Date = new Date()): Promise<ReportPurgeResult> {
  const cutoff = new Date(now.getTime() - REPORT_RETENTION_DAYS * 86_400_000).toISOString();
  let deleted = 0;
  let batches = 0;
  try {
    while (batches < PURGE_MAX_BATCHES) {
      const r: { meta?: { changes?: unknown } } | null | undefined = await env.DB.prepare(HOSTING_REPORTS_PURGE_SQL).bind(cutoff, PURGE_BATCH).run();
      batches++;
      const changes = r?.meta?.changes;
      const n = typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
      deleted += n;
      if (n < PURGE_BATCH) return { cutoff, deleted, batches, more: false };
    }
    return { cutoff, deleted, batches, more: true };
  } catch (e) {
    return { cutoff, deleted, batches, more: false, error: errorMessage(e) };
  }
}
