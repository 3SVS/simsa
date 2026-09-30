/**
 * SI 티어 Train B — B-7: S 모드 호스팅 사업자 의무 (D-6 "프로젝트별 킬스위치·신고 링크·요청 상한·금지 콘텐츠
 * 규칙·자동 정지 로그. 없으면 pilot start approved 불가").
 *
 * Simsa가 `<slug>.simsa.page`에 대신 올려 준 앱이 피싱·스팸·성인·악성코드·불법 콘텐츠로 쓰이면:
 *   - **정지**: 정지 목록(Workers KV `HOSTING_SUSPENDED`, 키 `suspended:<slug>`)에 올리면 호스팅 라우터
 *     (apps/hosting-dispatch)가 그 주소에 410을 낸다. 관리자 정지·자동 정지 모두 **이 파일의 같은 함수**가 하고,
 *     **같은 표(hosting_suspension_log, 0073)**에 남긴다.
 *   - **신고**: report.<root> 폼·API → hosting_reports(0073). 신고자 IP는 비밀 키 HMAC(`v1:`)으로만, 원문 저장 없음.
 *   - **자동 정지**: 라우터가 slug당 요청 상한을 넘길 때 분 단위 `strike:<slug>:<YYYYMMDDHHmm>`를 KV에 남기고,
 *     10분 크론이 최근 60분 중 10분 이상이면 자동 정지한다([PILOT] 수치). 관리자가 24시간 안에 해제한 앱은
 *     다시 자동 정지하지 않는다(해제 ↔ 자동 정지 핑퐁 방지).
 *
 * 순서 원칙(정지 로그가 먼저): 로그 행(applied=0) → KV 반영 → applied=1. 로그를 못 쓰면 KV를 건드리지 않는다
 * (기록 없는 정지는 없다). KV가 실패하면 행이 applied=0으로 남아 "시도했지만 반영 안 됨"이 보인다.
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
import { ipRateLimitKey } from "./rate-limit-key.js";
import { consumeDailyCaps } from "./rate-limit.js";

// ─── 값 (라우터와 락스텝) ─────────────────────────────────────────────────────────

/** 정지·신고 사유. 0073 CHECK 목록과 라우터 신고 폼 라디오 값과 같다(테스트 대조). */
export const SUSPENSION_REASONS = ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];
export type SuspensionSource = "admin" | "auto";

export const SUSPENDED_KEY_PREFIX = "suspended:";
export const STRIKE_KEY_PREFIX = "strike:";
export const REPORT_HOST_LABEL = "report";
export const RULES_PATH = "/rules";

/** 정지가 모든 지역에 보이기까지의 상한(초) — 응답에 그대로 싣는다(즉시라고 말하지 않는다). */
export const SUSPENSION_PROPAGATION_SECONDS = 60;

/** [PILOT] 자동 정지: 최근 windowMinutes분 중 minStrikeMinutes분 이상 상한 초과면 정지. 해제 뒤 graceHours 동안은 자동 정지 안 함. */
export const AUTO_SUSPEND = { windowMinutes: 60, minStrikeMinutes: 10, graceAfterUnsuspendHours: 24, maxListPages: 20 } as const;

/** [PILOT] 신고 남용 상한(UTC 하루): 같은 네트워크 10건 · 서비스 전체 300건. */
export const REPORT_CAPS = { perNetworkDaily: 10, serviceDaily: 300 } as const;

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

/** 영수증·내 앱 카드·호스팅 약관이 가리킬 신고 주소. */
export function hostingReportUrl(slug: string, rootDomain: string): string {
  const base = `https://${REPORT_HOST_LABEL}.${normalizeRootDomain(rootDomain)}/`;
  return isHostableSlug(slug) ? `${base}?app=${slug}` : base;
}

/** 호스팅 이용 규칙 공개 주소(금지 콘텐츠·신고·정지·이의). */
export function hostingRulesUrl(rootDomain: string): string {
  return `https://${REPORT_HOST_LABEL}.${normalizeRootDomain(rootDomain)}${RULES_PATH}`;
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
export const REPORT_INSERT_SQL =
  "INSERT INTO hosting_reports (id, slug, reason, description, contact, reporter_key, lang, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)";
const REPORTS_ACTIONED_SQL = "UPDATE hosting_reports SET status = 'actioned' WHERE slug = ? AND status = 'open'";
const LAST_UNSUSPEND_SQL =
  "SELECT created_at FROM hosting_suspension_log WHERE slug = ? AND action = 'unsuspend' AND applied = 1 ORDER BY created_at DESC LIMIT 1";
const REPORT_COUNT_SINCE_SQL = "SELECT COUNT(*) AS n FROM hosting_reports WHERE slug = ? AND created_at > ?";
export const SUSPENSION_LOG_RECENT_SQL =
  "SELECT id, action, reason, source, actor, memo, applied, created_at, applied_at FROM hosting_suspension_log WHERE slug = ? ORDER BY created_at DESC LIMIT 20";
export const REPORTS_RECENT_SQL =
  "SELECT id, reason, description, contact, status, created_at FROM hosting_reports WHERE slug = ? ORDER BY created_at DESC LIMIT 20";

// ─── 로그·알림 ────────────────────────────────────────────────────────────────────

const errorMessage = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

function logLine(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(fields));
}

export type DutyDeps = { fetch?: FetchLike; now?: () => Date };

/** 알림이 신고 응답을 붙잡는 최대 시간 — Telegram이 멈춰도 신고자는 기다리지 않는다. */
export const NOTIFY_TIMEOUT_MS = 4000;

/**
 * 운영자 알림 — 기존 창구(파운더 Telegram DM: TELEGRAM_BOT_TOKEN + FOUNDER_TG_CHAT_ID) 재사용.
 * 둘 중 하나라도 없으면 false(호출자는 JSON 로그 한 줄을 이미 남긴다). 실패·시간 초과는 삼킨다(신고 접수를 막지 않는다).
 */
export async function notifyOperator(env: Pick<Env, "TELEGRAM_BOT_TOKEN" | "FOUNDER_TG_CHAT_ID">, text: string, fetchImpl?: FetchLike): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = env.FOUNDER_TG_CHAT_ID?.trim();
  if (!token || !chat) return false;
  const chatId = Number.parseInt(chat, 10);
  if (!Number.isFinite(chatId)) return false;
  const base = fetchImpl ?? ((input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => fetch(input, init));
  const timed: FetchLike = (input, init) => base(input, { ...(init ?? {}), signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS) });
  try {
    const tg = new TelegramClient({ token, fetch: timed });
    await tg.sendMessage({ chatId, text: text.slice(0, 3500) });
    return true;
  } catch (e) {
    logLine({ event: "hosting_operator_notify_failed", message: errorMessage(e) });
    return false;
  }
}

/** 운영자가 정지·해제를 누르는 곳(Actions 워크플로 — 토큰은 repo secret에만 있다). */
export const HOSTING_DUTY_WORKFLOW_URL = "https://github.com/3SVS/simsa/actions/workflows/hosting-duty.yml";

// ─── 정지·해제 (관리자·자동 공용) ─────────────────────────────────────────────────

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
  source: SuspensionSource;
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
    logLine({ event: "hosting_suspension_not_applied", reason: "no_binding", slug: row.slug, action: row.action, source: row.source });
    return { ok: false, error: "store_not_configured" };
  }
  const logId = newId("hsl");
  const at = now.toISOString();
  try {
    await env.DB.prepare(SUSPENSION_LOG_INSERT_SQL).bind(logId, row.slug, row.action, row.reason, row.source, row.actor, row.memo, at).run();
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
  logLine({ event: "hosting_suspension_applied", slug: row.slug, action: row.action, reason: row.reason, source: row.source, logId });
  return { ok: true, action: row.action, slug: row.slug, logId, applied: true, appliedRecorded, propagationSeconds: SUSPENSION_PROPAGATION_SECONDS };
}

export type SuspendInput = { slug: string; reason: SuspensionReason; source: SuspensionSource; actor: string; memo?: string | null };

/** 정지 — 관리자 라우트와 자동 정지 크론이 **둘 다 이 함수**를 부른다. */
export async function suspendHostedApp(env: Env, input: SuspendInput, deps: DutyDeps = {}): Promise<SuspensionOutcome> {
  const now = deps.now?.() ?? new Date();
  const out = await logThenApply(
    env,
    { slug: input.slug, action: "suspend", reason: input.reason, source: input.source, actor: input.actor, memo: input.memo?.trim() || null },
    (kv, logId, at) => kv.put(suspendedKey(input.slug), JSON.stringify({ v: 1, reason: input.reason, source: input.source, at, logId })),
    now,
  );
  if (!out.ok) return out;
  await env.DB.prepare(REPORTS_ACTIONED_SQL)
    .bind(input.slug)
    .run()
    .catch((e: unknown) => logLine({ event: "hosting_reports_actioned_failed", slug: input.slug, message: errorMessage(e) }));
  if (input.source === "auto") {
    await notifyOperator(
      env,
      `⛔ Simsa 호스팅 자동 정지: ${input.slug}\n사유: ${input.reason}\n${input.memo ?? ""}\n\n잘못된 정지면 해제: ${HOSTING_DUTY_WORKFLOW_URL} (action=unsuspend, slug=${input.slug})`,
      deps.fetch,
    );
  }
  return out;
}

/** 해제 — KV 키 삭제 + 같은 표에 unsuspend 행. */
export async function unsuspendHostedApp(env: Env, input: { slug: string; actor: string; memo?: string | null }, deps: DutyDeps = {}): Promise<SuspensionOutcome> {
  const now = deps.now?.() ?? new Date();
  return logThenApply(
    env,
    { slug: input.slug, action: "unsuspend", reason: null, source: "admin", actor: input.actor, memo: input.memo?.trim() || null },
    (kv) => kv.delete(suspendedKey(input.slug)),
    now,
  );
}

// ─── 자동 정지 스윕(10분 크론) ─────────────────────────────────────────────────────

export type StrikeSweepResult = {
  skipped?: "no_binding";
  scanned: number;
  candidates: string[];
  suspended: string[];
  graced: string[];
  alreadySuspended: string[];
  failed: Array<{ slug: string; error: string }>;
};

export async function sweepHostingRateStrikes(env: Env, now: Date = new Date(), deps: DutyDeps = {}): Promise<StrikeSweepResult> {
  const result: StrikeSweepResult = { scanned: 0, candidates: [], suspended: [], graced: [], alreadySuspended: [], failed: [] };
  const kv = env.HOSTING_SUSPENDED;
  if (!kv) return { ...result, skipped: "no_binding" };

  const windowStart = now.getTime() - AUTO_SUSPEND.windowMinutes * 60_000;
  const minutesBySlug = new Map<string, Set<string>>();
  let cursor: string | undefined;
  for (let page = 0; page < AUTO_SUSPEND.maxListPages; page++) {
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

  for (const [slug, minutes] of minutesBySlug) {
    if (minutes.size < AUTO_SUSPEND.minStrikeMinutes) continue;
    result.candidates.push(slug);
    if ((await kv.get(suspendedKey(slug))) !== null) {
      result.alreadySuspended.push(slug);
      continue;
    }
    const last = await env.DB.prepare(LAST_UNSUSPEND_SQL)
      .bind(slug)
      .first<{ created_at: string }>()
      .catch(() => null);
    if (last && now.getTime() - Date.parse(last.created_at) < AUTO_SUSPEND.graceAfterUnsuspendHours * 3_600_000) {
      result.graced.push(slug);
      continue;
    }
    const out = await suspendHostedApp(
      env,
      {
        slug,
        reason: "abuse_other",
        source: "auto",
        actor: "auto:rate-limit",
        memo: `rate_limit_sustained: over the per-app request cap in ${minutes.size} of the last ${AUTO_SUSPEND.windowMinutes} minutes`,
      },
      { ...deps, now: () => now },
    );
    if (out.ok) result.suspended.push(slug);
    else result.failed.push({ slug, error: out.error });
  }
  return result;
}

// ─── 신고 ─────────────────────────────────────────────────────────────────────────

export type ReportOutcome =
  | { ok: true; reportId: string; slug: string; notified: boolean }
  | { ok: false; error: "invalid_app"; slug: null }
  | { ok: false; error: "report_limit"; slug: string; retryAfterSeconds: number }
  | { ok: false; error: "report_unavailable"; slug: string };

/**
 * 신고 저장. `body`는 ReportBodySchema를 통과한 값, `ip`는 cf-connecting-ip(저장·로그에 원문으로 가지 않는다).
 * 순서: 주소 정규화 → 남용 상한(원자적 일일 슬롯) → HMAC 신고자 키 → 저장(실패 시 슬롯 환급) → 운영자 알림.
 * 신고만으로 자동 정지하지 않는다 — 신고 폭탄으로 남의 앱을 내리는 공격을 막기 위해 판단은 사람이 한다.
 */
export async function recordHostingReport(env: Env, body: ReportBody, ip: string, deps: DutyDeps = {}): Promise<ReportOutcome> {
  const now = deps.now?.() ?? new Date();
  const slug = normalizeReportedApp(body.app, env.HOSTING_ROOT_DOMAIN ?? "");
  if (!slug) return { ok: false, error: "invalid_app", slug: null };

  const caps = await consumeDailyCaps(
    env,
    [
      { scope: "network", bucket: "hosting-report-daily-ip", key: ip, limit: REPORT_CAPS.perNetworkDaily },
      { scope: "service", bucket: "hosting-report-daily", key: "all", limit: REPORT_CAPS.serviceDaily },
    ],
    now,
  );
  if (caps.limited) {
    logLine({ event: "hosting_report_limited", slug, scope: caps.scope });
    return { ok: false, error: "report_limit", slug, retryAfterSeconds: caps.retryAfterSeconds };
  }

  const reporterKey = await ipRateLimitKey(env, "hosting-report-reporter", ip);
  const reportId = newId("hrp");
  const description = body.description ?? "";
  const contact = body.contact?.trim() ? body.contact.trim() : null;
  try {
    await env.DB.prepare(REPORT_INSERT_SQL).bind(reportId, slug, body.reason, description, contact, reporterKey, body.lang ?? null, now.toISOString()).run();
  } catch (e) {
    await caps.refund();
    logLine({ event: "hosting_report_not_saved", slug, message: errorMessage(e) });
    return { ok: false, error: "report_unavailable", slug };
  }

  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const count = await env.DB.prepare(REPORT_COUNT_SINCE_SQL)
    .bind(slug, since)
    .first<{ n: number }>()
    .catch(() => null);
  const excerpt = description.length > 300 ? `${description.slice(0, 300)}…` : description;
  // 연락처·IP는 알림에 싣지 않는다(연락처는 D1에만 — Cloudflare 대시보드 D1 콘솔에서 운영자가 본다).
  const notified = await notifyOperator(
    env,
    `🚩 Simsa 호스팅 신고: ${slug}\n사유: ${body.reason}\n최근 24시간 신고: ${count?.n ?? "?"}건\n${excerpt ? `내용: ${excerpt}\n` : ""}연락처: ${contact ? "있음" : "없음"} · 신고 id ${reportId}\n\n정지: ${HOSTING_DUTY_WORKFLOW_URL} (action=suspend, slug=${slug})`,
    deps.fetch,
  );
  logLine({ event: "hosting_report_received", slug, reason: body.reason, reportId, notified, hasContact: contact !== null });
  return { ok: true, reportId, slug, notified };
}
