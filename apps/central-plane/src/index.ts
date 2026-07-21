import { createApp } from "./router.js";
import type { Env } from "./env.js";
import { assertPreflight } from "./preflight.js";
import { selfHealWebhook } from "./webhook-heal.js";
import { cleanupStuckJobs, cleanupStuckVisualChecks, cleanupStuckRepairJobs } from "./stuck-cleanup.js";
import { refreshAllSources } from "./external-references.js";
import { sweepPlaintextGithubTokens } from "./db/token-encrypt-sweep.js";
import { retryPendingFeedback } from "./routes/feedback.js";
import { promoteSeedsPass } from "./seed-promoter.js";
import { runSourceDiscovery } from "./source-discovery.js";
import { runOssPrMiner } from "./oss-pr-miner.js";
import { runChangelogMonitor } from "./changelog-monitor.js";
import { runDeployTrendWatcher } from "./deploy-trend-watcher.js";
import { runVerifySweep } from "./workspace/verify-sweep.js";
import { runAgentSpawner, runAutoGraduation } from "./agent-spawner.js";
import { runCveAdvisoryMiner } from "./cve-advisory-miner.js";
import { runReengageNudges } from "./workspace/reengage.js";
import { runMcpRegistryMiner } from "./mcp-registry-miner.js";
import { runShadcnBlockMiner } from "./shadcn-block-miner.js";
import { runAwesomeListMiner } from "./awesome-list-miner.js";

const app = createApp();

// Module-scoped cache: run the preflight once per isolate. The key is
// the KEK value so that a secret rotation restarts the check on the
// next request — cheap and safe. Sentinel distinguishes "never checked"
// from "checked with undefined".
const UNCHECKED = Symbol("unchecked");
let preflightCheckedFor: string | null | typeof UNCHECKED = UNCHECKED;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const kek = env.CONCLAVE_TOKEN_KEK ?? null;
    if (preflightCheckedFor === UNCHECKED || preflightCheckedFor !== kek) {
      assertPreflight(env);
      preflightCheckedFor = kek;
    }
    return app.fetch(request, env, ctx);
  },
  // Scheduled handler for cron triggers.
  //
  // Multiple crons are wired to the same handler; we branch on
  // event.cron to dispatch:
  //   - every 10 min → Telegram webhook self-heal (v0.13.7)
  //   - every 5 min  → SaaS jobs stuck-cleanup (v0.16.4)
  //   - every day 03:00 UTC → external design references refresh (v0.16.8)
  //   - every 6 hours      → retry pending user_feedback classification (v0.16.9)
  //
  // Each branch logs a structured outcome so `wrangler tail` is the
  // audit trail (the scheduled trigger has no caller to return data to).
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "*/5 * * * *") {
      try {
        const result = await cleanupStuckJobs(env);
        console.log(JSON.stringify({ cron: "stuck-cleanup", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[stuck-cleanup] crashed:", err);
      }
      // Stage 263 — same tick also sweeps visual-check runs stuck in
      // queued|running (SimsaInspector container killed / dispatch lost).
      try {
        const result = await cleanupStuckVisualChecks(env);
        console.log(JSON.stringify({ cron: "stuck-cleanup-visual-checks", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[stuck-cleanup-visual-checks] crashed:", err);
      }
      // Stage 268 — same tick also sweeps repair jobs stuck in queued|running
      // (ConclaveSandbox repair job killed / dispatch lost).
      try {
        const result = await cleanupStuckRepairJobs(env);
        console.log(JSON.stringify({ cron: "stuck-cleanup-repair-jobs", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[stuck-cleanup-repair-jobs] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 3 * * *") {
      // Piggybacked daily hygiene: drain legacy plaintext GitHub tokens into
      // the encrypted column (migration 0004 phase 2). No-op without KEK.
      try {
        const sweep = await sweepPlaintextGithubTokens(env);
        console.log(JSON.stringify({ cron: "token-encrypt-sweep", cronExpression: event.cron, ...sweep }));
      } catch (err) {
        console.error("[token-encrypt-sweep] crashed:", err);
      }
      try {
        const results = await refreshAllSources(env);
        const ok = results.filter((r) => r.ok).length;
        const total = results.length;
        const totalEntries = results.reduce((s, r) => s + r.entries, 0);
        console.log(
          JSON.stringify({
            cron: "external-references-refresh",
            cronExpression: event.cron,
            sources_ok: ok,
            sources_total: total,
            entries_total: totalEntries,
            results,
          }),
        );
      } catch (err) {
        console.error("[external-references-refresh] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 */6 * * *") {
      try {
        const result = await retryPendingFeedback(env, 50);
        console.log(
          JSON.stringify({
            cron: "feedback-classify-retry",
            cronExpression: event.cron,
            ...result,
          }),
        );
      } catch (err) {
        console.error("[feedback-classify-retry] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 4 * * *") {
      try {
        const result = await promoteSeedsPass(env);
        console.log(
          JSON.stringify({
            cron: "seed-promoter",
            cronExpression: event.cron,
            ...result,
          }),
        );
      } catch (err) {
        console.error("[seed-promoter] crashed:", err);
      }
      return;
    }
    // v0.14.4 — day-of-week=7 (Sunday) since CF cron parser rejects 0.
    // See wrangler.toml header comment.
    if (event.cron === "0 5 * * 7") {
      try {
        const result = await runSourceDiscovery(env);
        console.log(
          JSON.stringify({
            cron: "source-discovery",
            cronExpression: event.cron,
            ...result,
          }),
        );
      } catch (err) {
        console.error("[source-discovery] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 6 * * *") {
      try {
        const result = await runOssPrMiner(env);
        console.log(
          JSON.stringify({
            cron: "oss-pr-miner",
            cronExpression: event.cron,
            total_saved: result.total_saved,
            total_failed: result.total_failed,
            per_repo: result.per_repo.map((r) => ({
              repo: r.repo,
              scanned: r.scanned,
              saved: r.saved,
              skipped_existing: r.skipped_existing,
              failed: r.failed,
            })),
          }),
        );
      } catch (err) {
        console.error("[oss-pr-miner] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 7 * * 1") {
      try {
        const result = await runChangelogMonitor(env);
        console.log(
          JSON.stringify({
            cron: "changelog-monitor",
            cronExpression: event.cron,
            total_releases_processed: result.total_releases_processed,
            total_entries_saved: result.total_entries_saved,
            total_failed: result.total_failed,
            per_source: result.per_source,
          }),
        );
      } catch (err) {
        console.error("[changelog-monitor] crashed:", err);
      }
      // D14: deploy/service trend watcher shares the Monday-07:00 pass —
      // fills the deploy_trend_suggestions review queue (never auto-applies).
      try {
        const trends = await runDeployTrendWatcher(env);
        console.log(JSON.stringify({ cron: "deploy-trend-watcher", cronExpression: event.cron, ...trends }));
      } catch (err) {
        console.error("[deploy-trend-watcher] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 8 * * 1") {
      try {
        const result = await runAgentSpawner(env);
        // Always also run auto-graduation in the same pass — keeps the
        // weekly Monday cron's two phases (detection of new clusters +
        // graduation of trial agents) atomic. Cheap (single aggregate
        // query + at most a handful of UPDATEs).
        const grad = await runAutoGraduation(env);
        console.log(
          JSON.stringify({
            cron: "agent-spawner",
            cronExpression: event.cron,
            ...result,
            auto_graduation: grad,
          }),
        );
      } catch (err) {
        console.error("[agent-spawner] crashed:", err);
      }
      return;
    }
    // G1 (2026-07-18) — 복귀 이메일 넛지: 팩 받고 3~14일 미복귀+이메일 opt-in에게
    // (user,project)당 평생 1통. 18:00 KST 발송 슬롯.
    if (event.cron === "0 9 * * *") {
      try {
        const result = await runReengageNudges(env);
        console.log(JSON.stringify({ cron: "reengage-nudges", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[reengage-nudges] crashed:", err);
      }
      return;
    }
    // v0.17 — Sprint E7: external-intel miners.
    if (event.cron === "0 10 * * *") {
      try {
        const result = await runCveAdvisoryMiner(env);
        console.log(JSON.stringify({ cron: "cve-advisory-miner", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[cve-advisory-miner] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 8 * * 3") {
      try {
        const result = await runMcpRegistryMiner(env);
        console.log(JSON.stringify({ cron: "mcp-registry-miner", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[mcp-registry-miner] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 8 * * 4") {
      try {
        const result = await runShadcnBlockMiner(env);
        console.log(JSON.stringify({ cron: "shadcn-block-miner", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[shadcn-block-miner] crashed:", err);
      }
      return;
    }
    if (event.cron === "0 8 * * 5") {
      try {
        const result = await runAwesomeListMiner(env);
        console.log(JSON.stringify({ cron: "awesome-list-miner", cronExpression: event.cron, ...result }));
      } catch (err) {
        console.error("[awesome-list-miner] crashed:", err);
      }
      return;
    }
    // Default / "*/10 * * * *" — webhook self-heal.
    const result = await selfHealWebhook(env);
    console.log(JSON.stringify({
      cron: "webhook-self-heal",
      cronExpression: event.cron,
      ...result,
    }));
    // 기준평가 1 (2026-07-22) — find→fix→verify 원 닫기: 머지된 수리 PR
    // 신호(workspace_repair_merged)를 소비해 재검수를 자동 디스패치한다.
    // 5분 배포 그레이스는 스윕 내부에서 처리. 실패는 스윕을 죽이지 않는다.
    try {
      const verify = await runVerifySweep(env);
      console.log(JSON.stringify({ cron: "verify-sweep", cronExpression: event.cron, ...verify }));
    } catch (err) {
      console.error("[verify-sweep] crashed:", err);
    }
  },
};

export { createApp } from "./router.js";
// v0.16.2 — wrangler discovers the Durable Object class via the main
// entry's exports. Imported here directly (not via router.ts) so node
// --test consumers of router.ts don't transitively pull in the Workers-
// only `@cloudflare/containers` runtime imports.
export { ConclaveSandbox } from "./container.js";
// Stage 263 — SimsaInspector container DO (Playwright visual inspections).
// Same rule as ConclaveSandbox: exported ONLY from index.ts so node --test
// consumers of router.ts never pull in `@cloudflare/containers`.
export { SimsaInspector } from "./inspector-container.js";
export type { Env } from "./env.js";
