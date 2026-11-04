/**
 * routes/admin-labeler.ts — 라벨링 에이전트를 프로덕션에서 돌린다 (train L3, 2026-11-02).
 *
 *   POST /admin/labeler-runs        { runId, passes, retry? }  내부 토큰. 끝난 v2 직원 런 하나를 패스마다 다시 해 본다
 *   POST /internal/labeler-done     컨테이너 완료 콜백 → labeler_agent 행(0076, 닫힌 어휘만)
 *   GET  /admin/labeler-runs?runId= 패스별 상태 + 일치도(숫자만)
 *   GET  /admin/labeler-agreement?since=  직원 런 전체의 일치도(숫자만 — 공개 Actions 로그로 읽는다)
 *
 * 범위: **직원(벤치) 런만.** 사용자 앱을 다른 벤더에 다시 보이는 일은 동의 문구를 정리한 뒤 별도 승인.
 * 블라인드(§5-1): 컨테이너에는 주소·의도·기준만 보낸다 — 원 런의 리포트·계획·판정은 보내지 않는다.
 * 잡 상태: visual_check 행을 만들지 않는다(사용자 화면·재검수·과금과 안 섞인다). 예산 행 + 라벨 행 + KV 메모(실패 사유 분류)가 전부.
 */
import { Hono } from "hono";
import { z } from "zod";
import { comparePasses, type AgreementReport, type PassLabels } from "../dataset/agreement.js";
import { refineEventsWithLabeler, labelerRowsFromV2Report } from "../dataset/labeler.js";
import { appIdFor, builderOfReport, insertLabelRows } from "../dataset/record.js";
import type { AcLabel, FailureEvent } from "../dataset/labels.js";
import type { Env } from "../env.js";
import type { FetchLike } from "../github.js";
import { initAgentSpend, mintRunToken } from "../workspace/inspection-agent.js";
import { LABELER_PASSES, LABELER_PASS_BUDGET_USD, LABELER_PASS_MAX_CALLS, labelerJobId, labelerLlmCall, parseLabelerJobId, type LabelerPassId } from "../workspace/labeler-llm.js";
import { opsMetaAllowedForRun } from "../workspace/privacy-prefs.js";
import { inspectionEnabled, INSPECTION_DISABLED } from "../workspace/service-switches.js";
import { resolveTier } from "../workspace/tier-resolve.js";
import { getVisualCheckById } from "../workspace/visual-check-db.js";
import { internalBearerRejection } from "./admin-internal.js";
import { INSPECT_LLM_PATH } from "./inspect-llm-proxy.js";

const RunBody = z
  .object({
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),
    passes: z.array(z.enum(["A", "B", "C"])).min(1).max(3),
    /** 라벨 없이 끝난 패스만 다시(예산 행을 새로). 라벨이 있으면 거절한다(append-only). */
    retry: z.boolean().optional(),
  })
  .strict();
const DoneBody = z.object({ runId: z.string(), ok: z.boolean(), report: z.record(z.unknown()).optional(), error: z.string().optional() }).passthrough();

const AC_FIELDS = ["id", "title", "given", "when", "then", "priority", "confirmed", "steps", "origin"] as const;
/** 기준만 옮긴다 — 어떤 판정·분석 칸도 따라가지 않게 허용 목록으로. */
function blindAcs(report: Record<string, unknown>): Array<Record<string, unknown>> {
  const agent = report["agent"] as { acs?: unknown } | undefined;
  const acs = Array.isArray(agent?.acs) ? (agent.acs as Array<Record<string, unknown>>) : [];
  return acs.map((a) => Object.fromEntries(AC_FIELDS.filter((f) => a[f] !== undefined).map((f) => [f, a[f]])));
}

function parseReport(json: string): Record<string, unknown> | null {
  try {
    const r = JSON.parse(json) as unknown;
    return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 공개 로그로 읽는 값이라 분류만 — 원문(주소가 섞일 수 있다)은 console에만. */
function failureClass(message: string): string {
  if (/timed out/i.test(message)) return "timeout";
  if (/inspect_llm_402|budget/i.test(message)) return "budget";
  if (/inspect_llm_/i.test(message)) return "llm";
  return "other";
}
/** 잡 닫기: 예약 조건(spent < budget)이 다시는 참이 안 되게 맞춘다. budget_usd > 0 제약 때문에 쓴 돈이 0이어도 최소값을 둔다. */
async function closeJob(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(`UPDATE inspection_agent_spend SET spent_usd = MAX(spent_usd, 0.000001), budget_usd = MAX(spent_usd, 0.000001) WHERE run_id = ?`).bind(jobId).run();
}

async function labelCounts(env: Env, runId: string, pass: LabelerPassId): Promise<{ acLabels: number; failures: number }> {
  const producer = `labeler-v1:${pass}`;
  const a = await env.DB.prepare(`SELECT COUNT(*) AS n FROM label_ac_verdicts WHERE run_id = ? AND source = 'labeler_agent' AND producer = ?`).bind(runId, producer).first<{ n: number }>();
  const f = await env.DB.prepare(`SELECT COUNT(*) AS n FROM label_failure_events WHERE run_id = ? AND source = 'labeler_agent' AND producer = ?`).bind(runId, producer).first<{ n: number }>();
  return { acLabels: Number(a?.n ?? 0), failures: Number(f?.n ?? 0) };
}

/** 저장된 행 → 패스 라벨. 런을 앱 자리에 둬서 런 × 기준으로 짝짓는다(같은 앱을 다시 재도 다른 표본). */
async function loadPass(env: Env, pass: LabelerPassId, filter: { runId?: string; since?: string }): Promise<PassLabels> {
  const where = filter.runId ? "run_id = ?" : "created_at >= ?";
  const value = filter.runId ?? filter.since ?? "";
  const producer = `labeler-v1:${pass}`;
  const ac = await env.DB.prepare(`SELECT run_id, ac_id, h1 FROM label_ac_verdicts WHERE source = 'labeler_agent' AND producer = ? AND supersedes IS NULL AND ${where}`)
    .bind(producer, value)
    .all<{ run_id: string; ac_id: string; h1: string }>();
  const ev = await env.DB.prepare(`SELECT run_id, ac_id, w1, y, c, s, a FROM label_failure_events WHERE source = 'labeler_agent' AND producer = ? AND supersedes IS NULL AND ${where}`)
    .bind(producer, value)
    .all<{ run_id: string; ac_id: string; w1: string; y: string; c: string; s: string; a: string }>();
  return {
    passId: pass,
    vendor: LABELER_PASSES[pass].vendor,
    acLabels: (ac.results ?? []).map((r) => ({ appId: r.run_id, acId: r.ac_id, h1: r.h1 }) as unknown as AcLabel),
    failureEvents: (ev.results ?? []).map((r) => ({ appId: r.run_id, acId: r.ac_id, w1: r.w1, y: r.y, c: r.c, s: r.s, a: r.a }) as unknown as FailureEvent),
  };
}

/** 숫자만 — 어떤 런의 어떤 기준이 갈렸는지는 내지 않는다(공개 로그). */
function agreementNumbers(r: AgreementReport) {
  const disputes = { askUser: r.disputes.filter((d) => d.next === "ask_user").length, thirdPass: r.disputes.filter((d) => d.next === "third_pass").length };
  return { pairedAcs: r.pairedAcs, sameVendor: r.sameVendor, h1Kappa: r.h1.kappa, w1: r.w1, yKappa: r.y.kappa, sKappa: r.s.kappa, aKappa: r.a.kappa, cKappa: r.c.kappa, meetsTargets: r.meetsTargets, disputes };
}

export function createAdminLabelerRoutes(fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/admin/labeler-runs", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;
    const env = c.env;
    const parsed = RunBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "invalid_request" }, 400);
    if (!inspectionEnabled(env)) return c.json({ ok: false, error: INSPECTION_DISABLED }, 503);
    if (!env.INSPECTOR || !env.INTERNAL_CALLBACK_TOKEN) return c.json({ ok: false, error: "inspector_unavailable" }, 503);

    const run = await getVisualCheckById(env, parsed.data.runId);
    if (!run) return c.json({ ok: false, error: "run_not_found" }, 404);
    if (run.status !== "done") return c.json({ ok: false, error: "run_not_done" }, 409);
    if ((await resolveTier(env, run.userKey)) !== "staff") return c.json({ ok: false, error: "staff_runs_only" }, 403);
    if (!(await opsMetaAllowedForRun(env, run, "labeler-run"))) return c.json({ ok: false, error: "ops_meta_off" }, 403);
    const report = parseReport(run.reportJson);
    const v2 = report?.["v2"] as { profile?: string } | undefined;
    if (!report || report["engineVersion"] !== "v2" || v2?.profile === "labeler") return c.json({ ok: false, error: "not_v2_run" }, 409);
    const acs = blindAcs(report);
    if (acs.length === 0) return c.json({ ok: false, error: "no_acs" }, 409);

    const base = (env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const passes: Array<{ pass: LabelerPassId; status: string }> = [];
    for (const pass of [...new Set(parsed.data.passes)]) {
      const jobId = labelerJobId(run.id, pass);
      const exists = await env.DB.prepare(`SELECT run_id FROM inspection_agent_spend WHERE run_id = ?`).bind(jobId).first();
      if (exists) {
        if (!parsed.data.retry) {
          passes.push({ pass, status: "already_started" });
          continue;
        }
        if ((await labelCounts(env, run.id, pass)).acLabels > 0) {
          passes.push({ pass, status: "already_labeled" });
          continue;
        }
        await env.DB.prepare(`DELETE FROM inspection_agent_spend WHERE run_id = ?`).bind(jobId).run();
      }
      const llmToken = await mintRunToken(env, "labeler", jobId);
      if (!llmToken) {
        passes.push({ pass, status: "token_unavailable" });
        continue;
      }
      await initAgentSpend(env, jobId, { budgetUsd: LABELER_PASS_BUDGET_USD, maxCalls: LABELER_PASS_MAX_CALLS });
      const payload = {
        runId: jobId,
        projectId: run.projectId,
        userKey: run.userKey,
        targetUrl: run.targetUrl,
        intent: run.intent,
        locale: run.locale === "en" ? "en" : "ko",
        baseUrl: base,
        callbackUrl: `${base}/internal/labeler-done`,
        callbackToken: env.INTERNAL_CALLBACK_TOKEN,
        engine: "agent",
        agent: { version: "v2", profile: "labeler", reproRuns: 3, acs, acSource: "confirmed_inferred", llmUrl: `${base}${INSPECT_LLM_PATH}`, llmToken },
      };
      try {
        const r = await env.INSPECTOR.get(env.INSPECTOR.idFromName(`vc-${jobId}`)).fetch("http://inspector/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        passes.push({ pass, status: r.ok ? "dispatched" : "dispatch_failed" });
        if (!r.ok) await closeJob(env, jobId);
      } catch {
        passes.push({ pass, status: "dispatch_failed" });
        await closeJob(env, jobId);
      }
    }
    return c.json({ ok: true, passes });
  });

  app.post("/internal/labeler-done", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;
    const env = c.env;
    const parsed = DoneBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: "invalid_request" }, 400);
    const jobId = parsed.data.runId;
    const job = parseLabelerJobId(jobId);
    if (!job) return c.json({ ok: false, error: "not_labeler_job" }, 400);
    const spend = await env.DB.prepare(`SELECT run_id FROM inspection_agent_spend WHERE run_id = ?`).bind(jobId).first();
    const run = spend ? await getVisualCheckById(env, job.runId) : null;
    if (!run) return c.json({ ok: false, error: "job_not_found" }, 404);

    if (!parsed.data.ok || !parsed.data.report) {
      const message = parsed.data.error ?? "no_report";
      console.error(JSON.stringify({ event: "labeler_job_failed", job_id: jobId, failure: failureClass(message), reason: message.slice(0, 200) }));
      await closeJob(env, jobId);
      return c.json({ ok: true, stored: false });
    }

    const sourceReport = parseReport(run.reportJson) ?? {};
    const acs = blindAcs(sourceReport) as unknown as Parameters<typeof refineEventsWithLabeler>[2];
    const pass = LABELER_PASSES[job.pass];
    const report = parsed.data.report as Parameters<typeof labelerRowsFromV2Report>[0];
    const rows = labelerRowsFromV2Report(report, { runId: run.id, appId: await appIdFor(run.targetUrl), createdAt: new Date().toISOString(), acs }, pass);
    if (rows.acLabels.length === 0) {
      console.error(JSON.stringify({ event: "labeler_job_failed", job_id: jobId, failure: "no_rows" }));
      await closeJob(env, jobId);
      return c.json({ ok: true, stored: false });
    }
    const owner = { projectId: run.projectId, userKey: run.userKey };
    const refined = await refineEventsWithLabeler(rows.failureEvents, report, acs, (a) => labelerLlmCall(env, fetchImpl, jobId, a, owner));
    const stored = await insertLabelRows(env, { acLabels: rows.acLabels, failureEvents: refined.events, builder: builderOfReport(sourceReport) });
    await closeJob(env, jobId);
    console.log(JSON.stringify({ event: "labeler_job_done", job_id: jobId, ...stored, refineFailed: refined.failed }));
    return c.json({ ok: true, stored: true, ...stored });
  });

  app.get("/admin/labeler-runs", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;
    const env = c.env;
    const runId = c.req.query("runId") ?? "";
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(runId)) return c.json({ ok: false, error: "invalid_request" }, 400);
    const passes = [];
    for (const pass of Object.keys(LABELER_PASSES) as LabelerPassId[]) {
      const jobId = labelerJobId(runId, pass);
      const spend = await env.DB.prepare(`SELECT spent_usd, budget_usd, calls FROM inspection_agent_spend WHERE run_id = ?`).bind(jobId).first<{ spent_usd: number; budget_usd: number; calls: number }>();
      if (!spend) continue;
      // 상태는 D1에서만 읽는다(KV 바인딩 없음). 콜백이 잡을 닫으면 budget = spent → 닫힘. 닫혔는데 라벨 0행 = 실패
      // (실패 분류는 console 로그 labeler_job_failed에만 — 공개 Actions 로그에 사유를 싣지 않는다).
      const counts = await labelCounts(env, runId, pass);
      const closed = spend.spent_usd >= spend.budget_usd;
      const status = !closed ? "running" : counts.acLabels > 0 ? "done" : "failed";
      passes.push({ pass, vendor: LABELER_PASSES[pass].vendor, model: LABELER_PASSES[pass].model, spentUsd: spend.spent_usd, calls: spend.calls, status, ...counts });
    }
    const [a, b] = [await loadPass(env, "A", { runId }), await loadPass(env, "B", { runId })];
    const agreement = a.acLabels.length && b.acLabels.length ? agreementNumbers(comparePasses(a, b)) : null;
    return c.json({ ok: true, passes, agreement });
  });

  app.get("/admin/labeler-agreement", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;
    const sinceRaw = c.req.query("since");
    const since = sinceRaw && Number.isFinite(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 90 * 86400_000).toISOString();
    const report = comparePasses(await loadPass(c.env, "A", { since }), await loadPass(c.env, "B", { since }));
    return c.json({ ok: true, since, agreement: agreementNumbers(report) });
  });

  return app;
}
