/**
 * workspace-visual-check-runs.ts — Stage 263 (+ Train C · C0/C2b/C4a, 2026-09-27)
 *
 * Cloud execution of Simsa visual completion checks. A dashboard/API client
 * asks "run inspection"; the Worker inserts a queued workspace_visual_checks
 * row (Stage 261 storage) and dispatches the job into the SimsaInspector
 * Cloudflare Container (Playwright + Chromium). The container uploads
 * evidence through the EXISTING Stage 261 evidence endpoint and reports the
 * result back here.
 *
 *   POST /workspace/projects/:id/visual-checks/run              — queue + dispatch a run
 *   POST /workspace/projects/:id/visual-checks/:runId/verdict   — C2b: human acceptance label
 *   POST /workspace/projects/:id/visual-checks/:runId/events    — C2b: fix-prompt copy telemetry
 *   POST /internal/visual-check-running                         — container ack: queued → running
 *   POST /internal/visual-check-done                            — container result: → done|failed
 *
 * SECURITY:
 *   - Ownership enforced (project belongs to userKey) — same pattern as the
 *     Stage 261 routes.
 *   - The Worker NEVER inspects arbitrary URLs. The target must be (or origin-
 *     match) one of the project's registered `website` sources; a project with
 *     no website source gets 400 website_source_required. A re-check
 *     (sourceCheckId) may reuse the ORIGIN run's target, which passed this gate
 *     when it was created and belongs to the same project + userKey.
 *   - /internal/* endpoints require Bearer INTERNAL_CALLBACK_TOKEN (mirrors
 *     /internal/job-done in saas.ts).
 *
 * Train C (재정렬 2026-09-27):
 *   - C0  (D-1 amend): "다시 확인"이 원 런의 intent·target을 물려받는다(sourceCheckId).
 *     intent가 없고 원 런도 없으면 프로젝트의 확정 의도(productSpec.oneLine)가 기본.
 *   - C2b (D-17·D-19 amend): user_verdict(사람 수용 라벨) + builderPrompt(채팅형 빌더용
 *     고침 지시 — 서버 콜백에서 생성해 report_json에 넣는다: 컨테이너 이미지 재빌드 없이
 *     배포되기 때문) + 복사 계측 이벤트.
 *   - C4a (D-8 amend, 0069): region·envelope_json은 insert 시, finding_codes_json은 콜백 시.
 *
 * Train W · W-2 (재정렬 D-7 amend [PILOT], 2026-09-28):
 *   - 킬스위치 INSPECTION_ENABLED — 판정은 dispatchInspection **안**(service-switches.ts 단일
 *     헬퍼)이라 라우트·verify-sweep·향후 자동 검수가 같은 게이트를 지난다. 라우트는 같은 헬퍼로
 *     행을 만들기 전에 묻고 503 `inspection_disabled`.
 *   - 일일 상한 검수 10/일(userKey, UTC 일) — 소유권·검증·409 뒤에서 차감, 행 저장 실패·
 *     디스패치 실패 시 환급. 초과 → 429 { error:"daily_limit_reached", kind:"inspection",
 *     limit, resetAt }. 시스템 재검수(verify-sweep)는 이 라우트를 거치지 않아 차감되지 않는다.
 *   - PR #561 검증 후속: userKey는 익명이라 같은 차감에 네트워크(30/일)·서비스 전체(300/일)
 *     버킷을 더했다(네트워크 초과 429 scope=network, 서비스 초과 503 reason=daily_capacity).
 *     차감은 버킷마다 문장 하나(원자적), 진행 중 1개 가드는 삽입 뒤 rowid 순으로 한 번 더 —
 *     동시에 들어온 요청이 상한·409를 함께 넘지 못한다.
 *
 * Graceful degradation: when the INSPECTOR DO binding / callback token is
 * absent or the container refuses the job (e.g. still provisioning), the row is
 * created, immediately marked failed (fail-fast — nothing consumes queued rows
 * later), and the response carries dispatched:false + note so the caller can
 * retry right away. The stuck sweep (stuck-cleanup.ts) remains a backstop for
 * runs that dispatched but died silently.
 */
import { acceptancePlanFromDevSpec, agentAcsFromDevSpec, devSpecAcSource, type AcceptanceScenario } from "../acceptance-plan.js";
import { BUILDERS, DEFECT_CLASSES, acsFromAgentReport, compareAgentRuns, type AcSource, type AgentAc } from "../agent-inspection.js";
import {
  TestCredentialsSchema,
  agentDailyBudgetReached,
  agentPublicOn,
  initAgentSpend,
  loadRunCredentials,
  loginUrlAllowed,
  mintRunToken,
  storeRunCredentials,
  verifyRunToken,
  type TestCredentials,
} from "../workspace/inspection-agent.js";
import { INSPECT_LLM_PATH } from "./inspect-llm-proxy.js";
import { internalBearerRejection } from "./admin-internal.js";
import { Hono } from "hono";
import { z } from "zod";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getProject, type DbProject } from "../workspace/db.js";
import { getProjectSourceById, listProjectSources } from "../workspace/project-sources-db.js";
import { buildRunEnvelope, regionFromRequest } from "../workspace/envelope.js";
import { opsMetaAllowedForRun, opsMetaRecordingAllowed } from "../workspace/privacy-prefs.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";
import { resolveRepairJobsByVerifyCheck } from "../workspace/repair-job-db.js";
import { INSPECTION_DISABLED, inspectionEnabled } from "../workspace/service-switches.js";
import { consumeDailyCaps } from "../workspace/rate-limit.js";
import { clientNetworkKey, dailyCapRejection, dailyCapsFor } from "../workspace/beta-limits.js";
import { entitlementsFor, type Entitlements } from "../workspace/entitlements.js";
import { resolveTier } from "../workspace/tier-resolve.js";
import { buildBuilderFixPrompt } from "../nondev-report.js";
import {
  USER_VERDICTS,
  discardQueuedVisualCheck,
  findActiveVisualCheckForProject,
  firstActiveVisualCheckIdForProject,
  getVisualCheckById,
  insertQueuedVisualCheck,
  markVisualCheckDone,
  markVisualCheckFailed,
  markVisualCheckRunning,
  setVisualCheckUserVerdict,
  type DbVisualCheck,
} from "../workspace/visual-check-db.js";

const MAX_INTENT_CHARS = 1000;
const MAX_TARGET_URL_CHARS = 500;
const MAX_REPORT_BYTES = 512 * 1024; // matches Stage 261 create route
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_ERROR_CHARS = 500;

/** Generic Korean intent used when the caller doesn't provide one (kept as-is: ko default + legacy import name). */
export const DEFAULT_INSPECTION_INTENT =
  "사용자가 앱을 열어 핵심 기능이 실제로 작동하는지 눈으로 확인할 수 있어야 한다";

const DEFAULT_INSPECTION_INTENT_EN =
  "A user should be able to open the app and see its core feature actually working";

/**
 * The generic intent in the RUN's language. The intent is echoed into the
 * report ("이 앱이 해야 하는 것 / What this app should do") and into the C2b
 * builder prompt, so an EN run must not carry the Korean sentence (PR #553
 * review P2: Hangul leaking into the EN builder prompt via this constant).
 */
export function defaultInspectionIntent(locale: "ko" | "en"): string {
  return locale === "en" ? DEFAULT_INSPECTION_INTENT_EN : DEFAULT_INSPECTION_INTENT;
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** True when `target` shares an origin with any registered website source. */
export function targetMatchesWebsiteSources(target: URL, references: string[]): boolean {
  for (const ref of references) {
    const src = parseHttpUrl(ref.trim());
    if (src && src.origin === target.origin) return true;
  }
  return false;
}

/**
 * C0 — the project's CONFIRMED intent: the one-line the user accepted on the
 * "맞나요?" card (productSpec.oneLine). Null when absent/blank, so the caller
 * falls back to the generic default rather than inventing one.
 */
export function confirmedIntentFromProject(project: Pick<DbProject, "productSpec"> | null): string | null {
  const spec = project?.productSpec;
  if (typeof spec !== "object" || spec === null) return null;
  const oneLine = (spec as { oneLine?: unknown }).oneLine;
  if (typeof oneLine !== "string") return null;
  const trimmed = oneLine.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_INTENT_CHARS) : null;
}

function requireInternalToken(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "callback_disabled" };
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || m[1] !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

// ─── agent 엔진(수용 기준 실행기) ─────────────────────────────────────────────

/** 로그인 세 갈래: 없음 · 시험 계정(암호화 보관 → 런 종료 시 삭제) · 직접 로그인해서 넘겨주기(라이브 브라우저). */
export const AGENT_LOGIN_MODES = ["none", "credentials", "handover"] as const;
export type AgentLoginMode = (typeof AGENT_LOGIN_MODES)[number];
export type AgentDispatch = {
  acs: AgentAc[];
  acSource: AcSource;
  loginMode: AgentLoginMode;
  /** 오픈 베타: 티어 상한(entitlements.agentRun). 없으면 기본(스태프 상한). */
  caps?: Entitlements["agentRun"];
  /** S2-min: 시험 데이터를 만들어도 된다는 동의가 없는 런 — 쓰기 행동을 하지 않는다. */
  readOnly?: boolean;
};

/** 오픈 베타: 이번 런이 agent 엔진 대신 기본 검수로 돈 이유(리포트에 그대로 안내). */
export const AGENT_FALLBACK_NOTES = {
  daily_budget: {
    ko: "오늘 무료 정밀 검사 한도가 다 찼어요 — 기본 검사로 확인했어요. 내일 다시 정밀 검사를 받으실 수 있어요.",
    en: "Today's free in-depth check budget is used up — we ran the basic check instead. The in-depth check is available again tomorrow.",
  },
} as const;

/** S2-min 동의 문구(요청 화면과 같은 문장 — 테스트 고정). */
export const WRITE_CONSENT_COPY = {
  ko: "이 앱은 제 것이고, 확인을 위해 시험 데이터(이름 '심사테스트')를 만들어도 괜찮아요",
  en: "This app is mine, and it's OK to create test data (name '심사테스트') to check it",
} as const;

/**
 * 이 런이 쓸 기준(AC). 순서: 원 런이 agent였으면 **그 AC 그대로**(재검수 = 같은 자) › 프로젝트 지시서의 AC
 * (유저 확인 표시 포함) › 없으면 빈 목록(컨테이너가 첫 화면을 보고 추정 — confirmed:false).
 */
export function agentAcsForRun(
  sourceCheck: Pick<DbVisualCheck, "reportJson"> | null,
  devSpec: unknown,
  entryPath?: string | null,
): { acs: AgentAc[]; acSource: AcSource } {
  const fromSource = sourceCheck ? acsFromAgentReport(sourceCheck.reportJson) : null;
  if (fromSource) return { acs: fromSource, acSource: "source_run" };
  const fromSpec = agentAcsFromDevSpec(devSpec);
  if (fromSpec.length > 0) return { acs: fromSpec, acSource: devSpecAcSource(devSpec, entryPath) };
  return { acs: [], acSource: "inferred_at_run" };
}

/** (G4) 이 런의 agent LLM 비용(원장 합산). 행동(싼)·판정(강한) 요청 모델별 호출 수도. */
export async function agentRunCostUsd(
  env: Env,
  runId: string,
): Promise<{ costUsd: number; llmCallsRecorded: number; unpricedCalls: number; callsByModel: Record<string, number> } | null> {
  const rows = await env.DB.prepare(
    `SELECT model_actual, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(unpriced), 0) AS unpriced
       FROM llm_usage WHERE job_kind = 'inspection' AND call_site = 'inspect_agent' AND job_id = ? GROUP BY model_actual`,
  )
    .bind(runId)
    .all<{ model_actual: string; n: number; usd: number; unpriced: number }>();
  const list = rows.results ?? [];
  if (list.length === 0) return null;
  return {
    costUsd: Math.round(list.reduce((s, r) => s + Number(r.usd), 0) * 10_000) / 10_000,
    llmCallsRecorded: list.reduce((s, r) => s + Number(r.n), 0),
    unpricedCalls: list.reduce((s, r) => s + Number(r.unpriced), 0),
    callsByModel: Object.fromEntries(list.map((r) => [String(r.model_actual ?? "?").slice(0, 60), Number(r.n)])),
  };
}

/** C13: 리포트의 agent.defects를 닫힌 어휘로만 저장(모르는 값은 버린다). */
export async function recordAgentDefects(env: Env, runId: string, report: Record<string, unknown>): Promise<number> {
  if (report["engine"] !== "agent") return 0;
  const agent = (report["agent"] && typeof report["agent"] === "object" ? report["agent"] : {}) as Record<string, unknown>;
  const builder = typeof agent["builder"] === "string" && (BUILDERS as readonly string[]).includes(agent["builder"]) ? agent["builder"] : "unknown";
  const defects = Array.isArray(agent["defects"]) ? (agent["defects"] as unknown[]) : [];
  const now = new Date().toISOString();
  const stmts = [];
  for (const d of defects.slice(0, 40)) {
    if (!d || typeof d !== "object") continue;
    const x = d as Record<string, unknown>;
    const cls = typeof x["defectClass"] === "string" && (DEFECT_CLASSES as readonly string[]).includes(x["defectClass"]) ? x["defectClass"] : "other";
    const acId = typeof x["acId"] === "string" ? x["acId"].slice(0, 40) : "";
    const priority = x["priority"] === "must" || x["priority"] === "should" || x["priority"] === "could" ? x["priority"] : "should";
    const status = x["status"] === "fail" ? "fail" : "not_verified";
    if (!acId) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO inspection_defects (run_id, ac_id, builder, defect_class, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, ac_id) DO NOTHING`,
      ).bind(runId, acId, builder, cls, priority, status, now),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

/** 원 런이 agent 엔진이었는가(재검수·자동 재검수가 엔진을 물려받는다). */
export function wasAgentRun(run: Pick<DbVisualCheck, "reportJson"> | null): boolean {
  if (!run?.reportJson) return false;
  try {
    const r = JSON.parse(run.reportJson) as { engine?: unknown } | null;
    return r !== null && typeof r === "object" && r.engine === "agent";
  } catch {
    return false;
  }
}

/**
 * Dispatch the queued run into the SimsaInspector container DO. Mirrors
 * spawnSandbox in saas.ts: fire-and-forget from the caller's perspective —
 * the container acks 202 and reports back via /internal/visual-check-*.
 *
 * Train W · W-2: the INSPECTION_ENABLED kill switch is enforced HERE (not in a
 * route), so every caller — the run route, the verify-sweep cron, any future
 * automatic inspection after a build — passes the same gate. `disabled: true`
 * tells a caller the service is switched off (as opposed to the container
 * being unavailable); callers that create rows ask inspectionEnabled() first.
 */
export async function dispatchInspection(
  env: Env,
  args: {
    runId: string;
    projectId: string;
    userKey: string;
    targetUrl: string;
    intent: string;
    locale: "ko" | "en";
    publicBaseUrl: string;
    /** 로그인 뒤 검수 동의(기본 false). 남의 앱에 계정을 만드는 일이라 자동으로 켜지지 않는다. */
    withSignup?: boolean;
    /** SI 티어 A5: 지시서의 수용 기준 시나리오(없으면 종전 — 핵심 흐름 하나). */
    acceptancePlan?: AcceptanceScenario[];
    /**
     * 2026-10-05 agent 엔진(수용 기준 실행기). 있으면 컨테이너가 결정론 플래너 대신 AC를 하나씩 실제로 해 본다.
     * acs가 비면 컨테이너가 첫 화면을 보고 추정한다(confirmed:false — "문제를 찾지 못했어요" 이상은 못 말한다).
     */
    agent?: AgentDispatch;
    /** 리포트 노트에 붙일 서버 안내(예: 하루 예산으로 기본 검수로 돈 이유). 컨테이너가 notes에 덧붙인다. */
    serverNotes?: string[];
  },
): Promise<{ dispatched: boolean; note?: string; disabled?: boolean }> {
  if (!inspectionEnabled(env)) {
    return { dispatched: false, note: INSPECTION_DISABLED, disabled: true };
  }
  if (!env.INSPECTOR) {
    return { dispatched: false, note: "inspector_unavailable" };
  }
  if (!env.INTERNAL_CALLBACK_TOKEN) {
    return { dispatched: false, note: "callback_token_missing" };
  }
  const base = args.publicBaseUrl.replace(/\/+$/, "");
  let agentPayload: Record<string, unknown> = {};
  if (args.agent) {
    const llmToken = await mintRunToken(env, "llm", args.runId);
    if (!llmToken) return { dispatched: false, note: "agent_token_unavailable" };
    try {
      const caps = args.agent.caps;
      // 런 예산·호출 수 = 티어 상한(행동 + 판정·재확인·추정 몫).
      await initAgentSpend(env, args.runId, caps ? { budgetUsd: caps.budgetUsd, maxCalls: caps.maxActions + caps.maxAcs * 3 + 6 } : undefined);
    } catch {
      return { dispatched: false, note: "agent_budget_unavailable" };
    }
    // 시험 계정: 이 순간에만 복호화해 이 런의 페이로드에 싣는다. 실패하면 평문 폴백 없이 디스패치하지 않는다.
    let credentials: TestCredentials | null = null;
    if (args.agent.loginMode === "credentials") {
      try {
        credentials = await loadRunCredentials(env, args.runId);
      } catch {
        credentials = null;
      }
      if (!credentials) return { dispatched: false, note: "credentials_unreadable" };
    }
    agentPayload = {
      engine: "agent",
      agent: {
        acs: args.agent.acs,
        acSource: args.agent.acSource,
        loginMode: args.agent.loginMode,
        ...(args.agent.caps ? { caps: args.agent.caps } : {}),
        ...(args.agent.readOnly ? { readOnly: true } : {}),
        llmUrl: `${base}${INSPECT_LLM_PATH}`,
        llmToken,
      },
      ...(credentials ? { credentials } : {}),
    };
  }
  const payload = {
    runId: args.runId,
    projectId: args.projectId,
    userKey: args.userKey,
    targetUrl: args.targetUrl,
    intent: args.intent,
    // The container builds the non-dev report prose at inspection time, so the
    // reader's locale has to travel WITH the job — the dashboard only renders
    // the stored report_json and cannot retranslate it afterwards.
    locale: args.locale,
    baseUrl: base,
    callbackUrl: `${base}/internal/visual-check-done`,
    runningUrl: `${base}/internal/visual-check-running`,
    callbackToken: env.INTERNAL_CALLBACK_TOKEN,
    // SI 티어 A5: 수용 기준 시나리오 — 컨테이너가 핵심 흐름 뒤에 예산 안에서 돌린다.
    ...(args.acceptancePlan && args.acceptancePlan.length > 0 ? { acceptancePlan: args.acceptancePlan } : {}),
    // ★로그인 뒤 검수 (2026-08-26) — **동의가 있고 메일 수신이 준비됐을 때만.**
    //
    //  남의 앱에 일회용 계정을 만드는 일이라 자동으로 켜지지 않는다. 그리고 메일
    //  받을 곳이 없으면 아예 보내지 않는다 — 확인 메일을 못 받으면 가입이 중간에서
    //  멈춰 **그 앱에 쓸모없는 계정만 남기** 때문이다.
    ...(args.withSignup && env.PROBE_MAIL_DOMAIN
      ? {
          signup: {
            enabled: true,
            mailDomain: env.PROBE_MAIL_DOMAIN,
            callbackBaseUrl: base,
            internalToken: env.INTERNAL_CALLBACK_TOKEN,
          },
        }
      : {}),
    ...agentPayload,
    ...(args.serverNotes && args.serverNotes.length > 0 ? { serverNotes: args.serverNotes.slice(0, 5) } : {}),
  };
  try {
    const id = env.INSPECTOR.idFromName(`vc-${args.runId}`);
    const stub = env.INSPECTOR.get(id);
    const r = await stub.fetch("http://inspector/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const tail = await r.text();
      return { dispatched: false, note: `container returned ${r.status}: ${tail.slice(0, 200)}` };
    }
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, note: `container fetch failed: ${(err as Error).message.slice(0, 200)}` };
  }
}

// ─── C2b: request bodies (Zod at the wire) ─────────────────────────────────────

const VerdictBodySchema = z.object({
  userKey: z.string().min(1),
  verdict: z.enum(USER_VERDICTS),
});

const FixPromptCopiedBodySchema = z.object({
  userKey: z.string().min(1),
  // Only this one event type is accepted here (a wider client→server event bus
  // is not this route's job).
  type: z.literal("fix_prompt_copied"),
  target: z.enum(["web_builder", "cli"]),
});

// ─── C2b/C4a: the container's report, as far as the callback needs to read it ──

/**
 * The callback only READS these fields (to build the builder prompt and to
 * collect finding codes); the report object itself is stored as the container
 * sent it, plus `builderPrompt`. Anything the schema does not know passes
 * through untouched (`passthrough`), so a newer container never loses data.
 */
const ReportFindingSchema = z
  .object({
    severity: z.string(),
    what: z.string(),
    why: z.string().optional(),
    how: z.string().optional(),
    evidence: z.string().nullable().optional(),
    code: z.string().optional(),
  })
  .passthrough();

const ReportForCallbackSchema = z
  .object({
    target: z.string().optional(),
    intent: z.string().optional(),
    verdict: z.string().optional(),
    oneLine: z.string().optional(),
    works: z.boolean().nullable().optional(),
    findings: z.array(ReportFindingSchema),
    builderPrompt: z.string().optional(),
  })
  .passthrough();

type FindingSeverity = "high" | "medium" | "low" | "info";

/** Unknown severity strings (a newer container) are treated as fixable, not as noise. */
function normalizeSeverity(s: string): FindingSeverity {
  return s === "high" || s === "medium" || s === "low" || s === "info" ? s : "medium";
}

/**
 * Enrich the container's report for storage: add `builderPrompt` (C2b, in the
 * run's locale) and pull `finding_codes` (C4a). Returns the object to serialize
 * and the codes JSON. A report that is not a NonDevReport (legacy shape, error
 * blob) is returned untouched with codes = null ("not recorded").
 */
export function enrichReportForStorage(
  report: Record<string, unknown>,
  locale: "ko" | "en",
): { report: Record<string, unknown>; findingCodesJson: string | null; builderPromptAdded: boolean } {
  const parsed = ReportForCallbackSchema.safeParse(report);
  if (!parsed.success) return { report, findingCodesJson: null, builderPromptAdded: false };
  const r = parsed.data;

  // Finding codes: [] when nothing was found (measured), null when findings exist
  // but the container image predates codes (legacy — unknown, not "none").
  const codes = r.findings.map((f) => f.code).filter((c): c is string => typeof c === "string" && c.length > 0);
  const findingCodesJson = r.findings.length === 0 ? "[]" : codes.length > 0 ? JSON.stringify(codes) : null;

  // Builder prompt: generated here (server) rather than in the container so it
  // ships without an image rebuild. Never overwrite one the container sent.
  if (typeof r.builderPrompt === "string" && r.builderPrompt.length > 0) {
    return { report, findingCodesJson, builderPromptAdded: false };
  }
  const builderPrompt = buildBuilderFixPrompt(
    {
      findings: r.findings.map((f) => ({
        severity: normalizeSeverity(f.severity),
        what: f.what,
        why: f.why ?? "",
        how: f.how ?? "",
        evidence: f.evidence ?? null,
      })),
      ...(r.target !== undefined ? { target: r.target } : {}),
      ...(r.intent !== undefined ? { intent: r.intent } : {}),
      ...(r.verdict !== undefined ? { verdict: r.verdict } : {}),
      ...(r.oneLine !== undefined ? { oneLine: r.oneLine } : {}),
      ...(r.works !== undefined ? { works: r.works } : {}),
    },
    locale,
  );
  return builderPrompt
    ? { report: { ...report, builderPrompt }, findingCodesJson, builderPromptAdded: true }
    : { report, findingCodesJson, builderPromptAdded: false };
}

/** Shared ownership chain for the per-run C2b routes: project → userKey, run → project + userKey. */
async function requireOwnedRun(
  env: Env,
  projectId: string,
  runId: string,
  userKey: string,
): Promise<{ ok: true; run: DbVisualCheck } | { ok: false; status: 403 | 404; error: string }> {
  const project = await getProject(env, projectId);
  if (!project) return { ok: false, status: 404, error: "project_not_found" };
  if (project.userKey !== userKey) return { ok: false, status: 403, error: "forbidden" };
  const run = await getVisualCheckById(env, runId);
  if (!run || run.projectId !== projectId || run.userKey !== userKey) {
    return { ok: false, status: 404, error: "run_not_found" };
  }
  return { ok: true, run };
}

export function createWorkspaceVisualCheckRunRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── POST /workspace/projects/:id/visual-checks/run ─────────────────────────
  app.post("/workspace/projects/:id/visual-checks/run", async (c) => {
    const projectId = c.req.param("id");

    let body: {
      userKey?: unknown;
      sourceId?: unknown;
      targetUrl?: unknown;
      intent?: unknown;
      locale?: unknown;
      sourceCheckId?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    // Ownership — identical pattern to the Stage 261 routes.
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    // Train W · W-2 — kill switch, asked BEFORE any row exists (same helper
    // dispatchInspection enforces). After ownership: a stranger still gets 403.
    if (!inspectionEnabled(c.env)) {
      return c.json({ ok: false, error: INSPECTION_DISABLED }, 503);
    }

    // Report language. Same shape as every other workspace route
    // (workspace-document-intake, workspace-github): unknown → "ko".
    const locale: "ko" | "en" = body.locale === "en" ? "en" : "ko";

    // C0 — re-check of an earlier run. The origin must be THIS project's run
    // owned by THIS user; anything else is 400 (no existence oracle across
    // users: same code for foreign / unknown / malformed).
    // `null` means "absent" (contract: optional string) — a client that
    // serializes `sourceCheckId: null` for an ordinary run must not break
    // every run (PR #553 review P2). Everything else non-string is rejected.
    let sourceCheck: DbVisualCheck | null = null;
    if (body.sourceCheckId !== undefined && body.sourceCheckId !== null) {
      const sourceCheckId = typeof body.sourceCheckId === "string" ? body.sourceCheckId.trim() : "";
      sourceCheck = sourceCheckId ? await getVisualCheckById(c.env, sourceCheckId) : null;
      if (!sourceCheck || sourceCheck.projectId !== projectId || sourceCheck.userKey !== userKey) {
        return c.json({ ok: false, error: "invalid_source_check" }, 400);
      }
    }

    // Intent: explicit (≤1000 chars) › inherited from the origin run › the
    // project's confirmed one-line › generic default. The user's own words win
    // over inheritance; inheritance wins over the project's line because a
    // re-check is about THAT earlier run.
    let intent: string;
    if (body.intent !== undefined) {
      if (typeof body.intent !== "string" || body.intent.trim().length === 0 || body.intent.length > MAX_INTENT_CHARS) {
        return c.json({ ok: false, error: "invalid_intent" }, 400);
      }
      intent = body.intent.trim();
    } else if (sourceCheck) {
      intent = sourceCheck.intent;
    } else {
      intent = confirmedIntentFromProject(project) ?? defaultInspectionIntent(locale);
    }

    // Resolve the inspection target. NEVER an arbitrary URL: it must come
    // from — or origin-match — a registered website source of THIS project.
    // Order: sourceId › targetUrl › origin run's target (C0) › latest website.
    let targetUrl: string;
    if (body.sourceId !== undefined) {
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      const source = sourceId ? await getProjectSourceById(c.env, sourceId) : null;
      if (!source || source.projectId !== projectId || source.userKey !== userKey || source.type !== "website") {
        return c.json({ ok: false, error: "invalid_source" }, 400);
      }
      const parsed = parseHttpUrl(source.reference.trim());
      if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
      targetUrl = parsed.toString();
    } else if (body.targetUrl === undefined && sourceCheck) {
      // C0: the origin run's target passed the registered-source gate when it
      // was created and belongs to the same project + user (verified above).
      const parsed = parseHttpUrl(sourceCheck.targetUrl.trim());
      if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
      targetUrl = parsed.toString();
    } else {
      const sources = await listProjectSources(c.env, projectId);
      const websites = sources.filter((s) => s.type === "website");
      if (websites.length === 0) return c.json({ ok: false, error: "website_source_required" }, 400);

      if (body.targetUrl !== undefined) {
        const raw = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
        if (!raw || raw.length > MAX_TARGET_URL_CHARS) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        const parsed = parseHttpUrl(raw);
        if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        if (!targetMatchesWebsiteSources(parsed, websites.map((w) => w.reference))) {
          return c.json({ ok: false, error: "target_url_not_registered" }, 400);
        }
        targetUrl = parsed.toString();
      } else {
        // Convenience: no explicit target → most recent website source.
        const latest = websites[0]!;
        const parsed = parseHttpUrl(latest.reference.trim());
        if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        targetUrl = parsed.toString();
      }
    }

    // Concurrency guard: one active cloud run per project.
    const active = await findActiveVisualCheckForProject(c.env, projectId);
    if (active) {
      return c.json({ ok: false, error: "run_already_active", activeRunId: active.id }, 409);
    }

    // Train W · W-2 — daily caps (D-7 amend [PILOT]): this user 10 · this network
    // 30 · the whole service 300 (beta-limits.ts — userKey is anonymous, so the
    // user cap alone is not a cost ceiling; PR #561 review P1). Charged only
    // here, after ownership + validation + the one-active-run guard (a 409 never
    // costs a slot), one atomic statement per bucket (no read-then-increment
    // window), and handed back below when the job never starts (row not saved /
    // lost a concurrent start / container refused).
    // D-24 T-5 — 로그인 뒤 검수(L2)는 베이직 이상. 상한 슬롯보다 **먼저** 본다(402는 몫을 쓰지 않는다).
    // 서버가 집행한다 — UI가 체크박스를 숨기는 것만으로 게이팅하지 않는다(RC-4 협의체와 같은 원칙).
    const tier = await resolveTier(c.env, userKey);

    // 2026-10-05 agent 엔진(수용 기준 실행기) — **스태프 티어만**(서버 집행). 상한 슬롯보다 먼저 판정한다.
    const bodyRec = body as Record<string, unknown>;
    const requestedEngine = bodyRec["engine"];
    if (requestedEngine !== undefined && requestedEngine !== "agent" && requestedEngine !== "classic") {
      return c.json({ ok: false, error: "invalid_engine" }, 400);
    }
    const isStaff = tier === "staff";
    // 오픈 베타: 공개 스위치가 켜지면 모든 사용자의 기본 검수가 agent 엔진(스태프는 늘 켜짐).
    const agentAllowed = isStaff || agentPublicOn(c.env);
    if (requestedEngine === "agent" && !agentAllowed) {
      return c.json({ ok: false, error: "engine_staff_only", tier }, 403);
    }
    let useAgent =
      agentAllowed &&
      requestedEngine !== "classic" &&
      (requestedEngine === "agent" || wasAgentRun(sourceCheck) || agentPublicOn(c.env) || (isStaff && c.env.INSPECTION_ENGINE === "agent"));
    // 서비스 하루 예산: 다 쓰면 스태프가 아닌 새 런은 기본 검수로(정직한 안내 — 조용한 실패 없음).
    let fallbackNote: string | null = null;
    if (useAgent && !isStaff && (await agentDailyBudgetReached(c.env))) {
      useAgent = false;
      fallbackNote = AGENT_FALLBACK_NOTES.daily_budget[locale];
    }
    // S2-min: 스태프가 아니면 시험 데이터 동의가 있어야 쓰기 행동(입력·제출)을 한다. 없으면 읽기 전용 런.
    const readOnly = useAgent && !isStaff && bodyRec["writeConsent"] !== true;
    // 로그인 세 갈래. 기본은 없음 — 남의 앱에 들어가는 일이라 명시 동의 없이는 켜지지 않는다.
    const rawLoginMode = bodyRec["loginMode"];
    if (rawLoginMode !== undefined && !(AGENT_LOGIN_MODES as readonly unknown[]).includes(rawLoginMode)) {
      return c.json({ ok: false, error: "invalid_login_mode" }, 400);
    }
    const loginMode: AgentLoginMode =
      (rawLoginMode as AgentLoginMode | undefined) ?? (bodyRec["testCredentials"] !== undefined ? "credentials" : "none");
    if (loginMode !== "none" && !useAgent) {
      return c.json({ ok: false, error: "login_mode_requires_agent_engine" }, 400);
    }
    let testCredentials: TestCredentials | null = null;
    if (loginMode === "credentials") {
      const raw = bodyRec["testCredentials"];
      const consent = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["consent"] : undefined;
      if (consent !== true) return c.json({ ok: false, error: "consent_required" }, 400);
      const parsedCreds = TestCredentialsSchema.safeParse(raw);
      if (!parsedCreds.success) return c.json({ ok: false, error: "invalid_test_credentials" }, 400);
      if (!loginUrlAllowed(parsedCreds.data.loginUrl, targetUrl)) return c.json({ ok: false, error: "invalid_login_url" }, 400);
      if (!c.env.CONCLAVE_TOKEN_KEK) return c.json({ ok: false, error: "credentials_unavailable" }, 503);
      testCredentials = {
        username: parsedCreds.data.username,
        password: parsedCreds.data.password,
        ...(parsedCreds.data.loginUrl ? { loginUrl: parsedCreds.data.loginUrl } : {}),
      };
    }
    if (loginMode === "handover" && bodyRec["handoverConsent"] !== true) {
      return c.json({ ok: false, error: "consent_required" }, 400);
    }
    if (loginMode !== "none" && !entitlementsFor(tier).loginBehindInspection) {
      return c.json({ ok: false, error: "plan_required", feature: "login_behind_inspection", tier }, 402);
    }

    if ((body as Record<string, unknown>)["withSignup"] === true && !entitlementsFor(tier).loginBehindInspection) {
      const en = locale === "en";
      return c.json(
        {
          ok: false,
          error: "plan_required",
          feature: "login_behind_inspection",
          tier,
          message: en
            ? "Checking the screens behind sign-in is available on the Basic plan and above. On your current plan you can check the public screens."
            : "로그인 뒤 화면 확인은 베이직 플랜부터 쓸 수 있어요. 지금 플랜에서는 공개된 화면을 확인할 수 있어요.",
        },
        402,
      );
    }

    // D-24 T-4 — the user's own daily cap is now the tier's number (free 3 · basic 10 · pro 50).
    const caps = await consumeDailyCaps(
      c.env,
      dailyCapsFor("inspection", c.env, userKey, clientNetworkKey(c.req.raw), tier),
    );
    if (caps.limited) {
      const rejection = dailyCapRejection("inspection", caps, tier);
      c.header("Retry-After", String(rejection.retryAfterSeconds));
      return c.json(rejection.body, rejection.status);
    }
    const refundSlot = caps.refund;

    // C4a (0069): the envelope is stamped at insert — that is when the edge
    // country and the project snapshot are in hand. Nothing here is invented:
    // absent values are null.
    // Train K · K-1 (0071): only when this person's ops-meta recording is on (explicit choice, else the
    // country default — EU/EEA·GB·CH off). Off → both columns NULL; the run itself is unaffected.
    const edgeRegion = regionFromRequest(c.req.raw);
    const opsOn = await opsMetaRecordingAllowed(c.env, userKey, edgeRegion, "inspection-run");
    const region = opsOn ? edgeRegion : null;
    const envelopeJson = opsOn ? JSON.stringify(buildRunEnvelope(project, locale, intent)) : null;

    let run;
    try {
      // 0065: 런 행에 locale 저장 — verify-sweep 자동 재검수가 원 런의 언어를 따른다.
      run = await insertQueuedVisualCheck(c.env, {
        projectId,
        userKey,
        targetUrl,
        intent,
        locale,
        region,
        envelopeJson,
        sourceCheckId: sourceCheck?.id ?? null,
      });
    } catch (err) {
      console.error("[visual-check-runs POST run] insert failed:", err);
      await refundSlot();
      return c.json({ ok: false, error: "save_failed" }, 500);
    }

    // One active run per project, under concurrency (PR #561 review P2). The
    // 409 check above is read-then-insert: requests that arrive together all
    // pass it. Now that our row exists, the in-flight row inserted FIRST wins;
    // any later one (ours included) backs out — row removed, slots returned,
    // the same 409 as the check above. A D1 error here keeps going (fail-open,
    // exactly like the read before it).
    const firstActiveId = await firstActiveVisualCheckIdForProject(c.env, projectId).catch(() => null);
    if (firstActiveId !== null && firstActiveId !== run.id) {
      const runId = run.id;
      await discardQueuedVisualCheck(c.env, runId).catch(async (err) => {
        // Never leave a queued row nothing will pick up (it would wedge this
        // guard until the stuck sweep) — fall back to a final state.
        console.error("[visual-check-runs POST run] discard after lost start failed:", err);
        await markVisualCheckFailed(c.env, runId, "superseded_by_concurrent_run").catch(() => undefined);
      });
      await refundSlot();
      return c.json({ ok: false, error: "run_already_active", activeRunId: firstActiveId }, 409);
    }

    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
    // 로그인 뒤 검수는 **요청에 명시된 경우에만.** 남의 앱에 일회용 계정을 만드는
    // 일이므로 기본값이 켜짐이 되어서는 안 된다(서버가 기본을 강제한다 — UI가
    // 체크박스를 빠뜨려도 켜지지 않는다).
    const withSignup = (body as Record<string, unknown>)["withSignup"] === true;
    // SI 티어 A5: 지시서가 있으면 그 테스트 계획이 검수의 자(尺)가 된다.
    const acceptancePlan = acceptancePlanFromDevSpec(project.devSpec);
    // agent 엔진: 재검수면 원 런의 AC 그대로, 아니면 지시서(유저 확인 표시 포함), 둘 다 없으면 런에서 추정.
    const agentDispatch: AgentDispatch | null = useAgent
      ? { ...agentAcsForRun(sourceCheck, project.devSpec, project.entryPath), loginMode, caps: entitlementsFor(tier).agentRun, ...(readOnly ? { readOnly: true } : {}) }
      : null;
    if (testCredentials) {
      try {
        await storeRunCredentials(c.env, run.id, testCredentials);
      } catch (err) {
        console.error(JSON.stringify({ at: "visual-check-runs POST run", runId: run.id, note: "credential store failed", error: String((err as Error)?.message ?? err).slice(0, 80) }));
        await refundSlot();
        await markVisualCheckFailed(c.env, run.id, "credentials_store_failed").catch(() => undefined);
        return c.json({ ok: false, error: "credentials_store_failed" }, 500);
      }
    }
    const dispatch = await dispatchInspection(c.env, {
      runId: run.id,
      projectId,
      userKey,
      targetUrl,
      intent,
      acceptancePlan,
      locale,
      publicBaseUrl,
      ...(withSignup ? { withSignup: true } : {}),
      ...(agentDispatch ? { agent: agentDispatch } : {}),
      ...(fallbackNote ? { serverNotes: [fallbackNote] } : {}),
    });
    // 직접 로그인해서 넘겨주기: 이 런의 라이브 화면 토큰(소유자에게만 응답으로 준다 — userKey 확인을 이미 지났다).
    const liveToken = agentDispatch?.loginMode === "handover" && dispatch.dispatched ? await mintRunToken(c.env, "live", run.id) : null;

    // Fail fast when the dispatch didn't take: nothing ever picks a queued row
    // up later (dispatch is fire-once), so leaving it 'queued' would wedge the
    // one-active-run guard for 30 min until the stuck sweep. A failed row is
    // honest and lets the user retry immediately (live finding, Stage 263.1).
    let status = run.status;
    if (!dispatch.dispatched) {
      // W-2: nothing ran — the user's slot goes back.
      await refundSlot();
      try {
        await markVisualCheckFailed(c.env, run.id, dispatch.note ?? "dispatch_failed");
        status = "failed";
      } catch (err) {
        console.error("[visual-check-runs POST run] fail-fast mark failed:", err);
      }
    }

    return c.json(
      {
        ok: true,
        check: {
          id: run.id,
          projectId,
          targetUrl: run.targetUrl,
          intent: run.intent,
          decision: run.decision,
          works: run.works,
          status,
          executor: run.executor,
          sourceCheckId: run.sourceCheckId,
          createdAt: run.createdAt,
        },
        dispatched: dispatch.dispatched,
        engine: agentDispatch ? "agent" : "classic",
        ...(fallbackNote ? { engineFallback: "daily_budget", engineFallbackNote: fallbackNote } : {}),
        ...(agentDispatch?.readOnly ? { readOnly: true } : {}),
        ...(agentDispatch ? { acSource: agentDispatch.acSource, acCount: agentDispatch.acs.length, loginMode: agentDispatch.loginMode } : {}),
        ...(liveToken ? { liveToken } : {}),
        ...(dispatch.note ? { note: dispatch.note } : {}),
      },
      202,
    );
  });

  // ── GET /admin/defect-stats (C13) — 빌더 × 결함 분류 개수. 내부 토큰만. ?since=ISO(기본 90일) ──
  app.get("/admin/defect-stats", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;
    const sinceRaw = c.req.query("since");
    const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 90 * 86400_000).toISOString();
    const rows = await c.env.DB.prepare(
      `SELECT builder, defect_class, status, COUNT(*) AS n, COUNT(DISTINCT run_id) AS runs FROM inspection_defects
        WHERE created_at >= ? GROUP BY builder, defect_class, status ORDER BY builder, n DESC`,
    )
      .bind(since)
      .all<{ builder: string; defect_class: string; status: string; n: number; runs: number }>()
      .catch(() => ({ results: [] as Array<{ builder: string; defect_class: string; status: string; n: number; runs: number }> }));
    return c.json({ ok: true, since, rows: rows.results ?? [] });
  });

  // ── 직접 로그인해서 넘겨주기(라이브 브라우저) ─────────────────────────────────
  // 카카오·구글·문자 인증처럼 우리가 대신 들어갈 수 없는 로그인을 **사용자가 직접** 한다. 화면은 이 런의 검수
  // 컨테이너 안 Chromium이고, Worker가 그 화면(JPEG)과 입력(클릭·글자·키)을 중계한다. 인증 두 겹:
  //   ① userKey가 이 런의 소유자 ② ilt1 런 토큰(런 생성 응답으로 소유자에게만 준다).
  // 입력한 글자(비밀번호 포함)는 로그에도 저장에도 남지 않는다 — 컨테이너로 바로 넘긴다. 로그인이 끝나면 컨테이너가
  // 그 브라우저 상태(쿠키·저장소)를 **메모리에서만** 이 런에 쓰고 런이 끝나면 버린다(디스크·D1·LLM 어디에도 안 간다).
  const LiveInputSchema = z
    .object({
      userKey: z.string().min(1),
      token: z.string().min(1).max(200),
      kind: z.enum(["click", "type", "key", "scroll"]),
      x: z.number().min(0).max(4000).optional(),
      y: z.number().min(0).max(4000).optional(),
      text: z.string().max(200).optional(),
      key: z.enum(["Enter", "Tab", "Backspace", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]).optional(),
      deltaY: z.number().min(-4000).max(4000).optional(),
    })
    .strict();

  async function liveGate(
    env: Env,
    projectId: string,
    runId: string,
    userKey: string,
    token: string,
  ): Promise<{ ok: true; stub: { fetch: (url: string, init?: RequestInit) => Promise<Response> } } | { ok: false; status: 401 | 403 | 404 | 409 | 503; error: string }> {
    const owned = await requireOwnedRun(env, projectId, runId, userKey);
    if (!owned.ok) return owned;
    const v = await verifyRunToken(env, "live", token);
    if (!v.ok || v.runId !== runId) return { ok: false, status: 401, error: "invalid_live_token" };
    if (owned.run.status !== "queued" && owned.run.status !== "running") return { ok: false, status: 409, error: "run_not_active" };
    if (!env.INSPECTOR) return { ok: false, status: 503, error: "inspector_unavailable" };
    const stub = env.INSPECTOR.get(env.INSPECTOR.idFromName(`vc-${runId}`));
    return { ok: true, stub };
  }

  app.get("/workspace/projects/:id/visual-checks/:runId/live/:what", async (c) => {
    const what = c.req.param("what");
    if (what !== "frame" && what !== "state") return c.json({ ok: false, error: "not_found" }, 404);
    const runId = c.req.param("runId");
    const gate = await liveGate(c.env, c.req.param("id"), runId, c.req.query("userKey") ?? "", c.req.query("token") ?? "");
    if (!gate.ok) return c.json({ ok: false, error: gate.error }, gate.status);
    try {
      const r = await gate.stub.fetch(`http://inspector/live/${what}?runId=${encodeURIComponent(runId)}`);
      return new Response(r.body, {
        status: r.status,
        headers: { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
      });
    } catch {
      return c.json({ ok: false, error: "inspector_unreachable" }, 502);
    }
  });

  app.post("/workspace/projects/:id/visual-checks/:runId/live/:what", async (c) => {
    const what = c.req.param("what");
    if (what !== "input" && what !== "done") return c.json({ ok: false, error: "not_found" }, 404);
    const runId = c.req.param("runId");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const rec = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const userKey = typeof rec["userKey"] === "string" ? rec["userKey"] : "";
    const token = typeof rec["token"] === "string" ? rec["token"] : "";
    let forward: Record<string, unknown> = { runId };
    if (what === "input") {
      const parsed = LiveInputSchema.safeParse(raw);
      if (!parsed.success) return c.json({ ok: false, error: "invalid_request" }, 400);
      const { userKey: _u, token: _t, ...input } = parsed.data;
      forward = { runId, ...input };
    }
    const gate = await liveGate(c.env, c.req.param("id"), runId, userKey, token);
    if (!gate.ok) return c.json({ ok: false, error: gate.error }, gate.status);
    try {
      const r = await gate.stub.fetch(`http://inspector/live/${what}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(forward),
      });
      return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch {
      return c.json({ ok: false, error: "inspector_unreachable" }, 502);
    }
  });

  // ── POST /workspace/projects/:id/visual-checks/:runId/verdict ──────────────
  // C2b — the human acceptance label. This is the north star (D-19 amend):
  // "as_intended" closes the loop; the other three tell us where the loop broke.
  // Resubmission overwrites — the user's latest word stands.
  app.post("/workspace/projects/:id/visual-checks/:runId/verdict", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = VerdictBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ ok: false, error: "invalid_request" }, 400);
    const { userKey, verdict } = parsed.data;

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    const at = new Date().toISOString();
    try {
      await setVisualCheckUserVerdict(c.env, runId, verdict, at);
    } catch (err) {
      console.error("[visual-check-runs POST verdict] update failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_visual_check_verdict",
      metadata: { runId, verdict },
    }).catch(() => undefined);

    return c.json({ ok: true, verdict, at });
  });

  // ── POST /workspace/projects/:id/visual-checks/:runId/events ───────────────
  // C2b — copy telemetry for the fix prompt (which format the user actually
  // took: builder chat vs CLI agent). Record-only; a failure here never blocks
  // the UI (the dashboard fires and forgets).
  app.post("/workspace/projects/:id/visual-checks/:runId/events", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const parsed = FixPromptCopiedBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ ok: false, error: "invalid_request" }, 400);
    const { userKey, target } = parsed.data;

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_fix_prompt_copied",
      metadata: { runId, target },
    }).catch(() => undefined);
    return c.json({ ok: true });
  });

  // ── POST /internal/visual-check-running ────────────────────────────────────
  // Container ack: the job actually started executing (queued → running).
  // Bearer INTERNAL_CALLBACK_TOKEN required, mirroring /internal/job-done.
  app.post("/internal/visual-check-running", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as { runId?: string } | null;
    if (!body || typeof body.runId !== "string" || !body.runId) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const run = await getVisualCheckById(c.env, body.runId);
    if (!run) return c.json({ error: "not_found" }, 404);

    const transitioned = await markVisualCheckRunning(c.env, body.runId);
    return c.json({ ok: true, transitioned });
  });

  // ── POST /internal/visual-check-done ───────────────────────────────────────
  // Container result callback. Evidence files were already uploaded via the
  // Stage 261 evidence endpoint (which validates names/sizes) — this endpoint
  // only finalizes the row.
  app.post("/internal/visual-check-done", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as
      | {
          runId?: string;
          ok?: boolean;
          decision?: string;
          works?: boolean | null;
          report?: unknown;
          agentPrompt?: string;
          error?: string;
        }
      | null;
    if (!body || typeof body.runId !== "string" || !body.runId || typeof body.ok !== "boolean") {
      return c.json({ error: "invalid_request" }, 400);
    }

    const run = await getVisualCheckById(c.env, body.runId);
    if (!run) return c.json({ error: "not_found" }, 404);

    if (!body.ok) {
      const error = typeof body.error === "string" && body.error ? body.error : "inspection failed";
      await markVisualCheckFailed(c.env, body.runId, error.slice(0, MAX_ERROR_CHARS));
      return c.json({ ok: true, status: "failed" });
    }

    const decision = typeof body.decision === "string" && body.decision.trim() && body.decision.length <= 64
      ? body.decision.trim()
      : "Not Judged";
    const works = body.works === true ? true : body.works === false ? false : null;

    let reportJson = "{}";
    let findingCodesJson: string | null = null;
    if (body.report !== undefined && body.report !== null && typeof body.report === "object" && !Array.isArray(body.report)) {
      // C2b/C4a — builderPrompt in the RUN's locale (the report prose is already
      // in that language) + finding codes for the failure map.
      // (G4) agent 런의 실제 LLM 비용 — 원장(llm_usage, 실제로 답한 모델의 단가)에서 합산해 리포트에 싣는다(벤치 결과에 그대로).
      if ((body.report as Record<string, unknown>)["engine"] === "agent") {
        const agentPart = (body.report as Record<string, unknown>)["agent"];
        const cost = await agentRunCostUsd(c.env, body.runId).catch(() => null);
        if (cost && agentPart && typeof agentPart === "object") Object.assign(agentPart as Record<string, unknown>, cost);
      }
      // B6: agent 재검수는 원 런과 AC별로 비교해 "새로 깨진 것"을 리포트에 싣는다.
      if (run.sourceCheckId && (body.report as Record<string, unknown>)["engine"] === "agent") {
        const origin = await getVisualCheckById(c.env, run.sourceCheckId).catch(() => null);
        const cmp = compareAgentRuns(origin?.reportJson, body.report as { acTable?: unknown });
        if (cmp) (body.report as Record<string, unknown>)["agentComparison"] = { sourceCheckId: run.sourceCheckId, ...cmp };
      }
      const enriched = enrichReportForStorage(body.report as Record<string, unknown>, run.locale ?? "ko");
      findingCodesJson = enriched.findingCodesJson;
      let serialized = JSON.stringify(enriched.report);
      if (serialized.length > MAX_REPORT_BYTES && enriched.builderPromptAdded) {
        // The container already sized its report to the cap; the SERVER-added
        // builderPrompt must never be what rejects it (PR #553 review P2 — the
        // old code stored this report; a 400 here leaves the run `running`).
        // Drop the enrichment, keep the container's report byte-for-byte.
        serialized = JSON.stringify(body.report);
        console.warn(JSON.stringify({ at: "visual-check-done", runId: body.runId, note: "builderPrompt dropped: enriched report over cap" }));
      }
      if (serialized.length > MAX_REPORT_BYTES) return c.json({ error: "report_too_large" }, 400);
      reportJson = serialized;
    }
    const agentPrompt = typeof body.agentPrompt === "string" && body.agentPrompt ? body.agentPrompt : undefined;
    if (agentPrompt && agentPrompt.length > MAX_PROMPT_BYTES) {
      return c.json({ error: "agent_prompt_too_large" }, 400);
    }

    // Train K · K-1 (0071): finding codes are ops meta. No request here (container callback) → the
    // person's explicit choice, else the default for the country recorded on the run (opsMetaAllowedForRun —
    // a pre-0071 EU run recorded 'DE' without the gate, and 'DE' is off by default).
    if (findingCodesJson !== null && !(await opsMetaAllowedForRun(c.env, run, "inspection-done"))) {
      findingCodesJson = null;
    }

    await markVisualCheckDone(c.env, body.runId, {
      decision,
      works,
      reportJson,
      findingCodesJson,
      ...(agentPrompt ? { agentPrompt } : {}),
    });

    // C13: agent 런의 결함 분류(빌더 × 분류) — 운영 정보 기록이 켜진 런만(finding codes와 같은 게이트).
    if (findingCodesJson !== null && body.report && typeof body.report === "object") {
      await recordAgentDefects(c.env, body.runId, body.report as Record<string, unknown>).catch((err) => {
        console.error("[visual-check-runs done] defect record failed:", err);
      });
    }

    // C2a (0069): a re-inspection closing a repair loop → stamp `resolved` on the
    // repair job(s) that pointed at this run. Original runs (no source) have no
    // repair to resolve, so no query is issued.
    if (run.sourceCheckId) {
      await resolveRepairJobsByVerifyCheck(c.env, run.id, works).catch((err) => {
        console.error("[visual-check-runs done] resolve repair jobs failed:", err);
      });
    }
    return c.json({ ok: true, status: "done" });
  });

  return app;
}
