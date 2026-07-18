import { Hono } from "hono";
import type { Env } from "./env.js";
// v0.16.2 — Container DO class is re-exported from src/index.ts (which
// wrangler bundles). Importing it here would force `@cloudflare/containers`
// (which uses extensionless imports + the `cloudflare:workers` runtime
// module) into every node --test consumer of `createApp`. Keep this module
// dependency-free of the Workers-only chain.
import { healthRoutes } from "./routes/health.js";
import { registerRoutes } from "./routes/register.js";
import { episodicRoutes } from "./routes/episodic.js";
import { federatedBaselinesRoutes } from "./routes/federated-baselines.js";
import { episodicAnchorRoutes } from "./routes/episodic-anchor.js";
import { memoryRoutes } from "./routes/memory.js";
import { createOAuthRoutes } from "./routes/oauth.js";
import { createTelegramRoutes } from "./routes/telegram.js";
import { createReviewRoutes } from "./routes/review.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createSaasAuthRoutes } from "./routes/saas-auth.js";
import { createSaasRoutes } from "./routes/saas.js";
import { createDemoRoutes } from "./routes/demo.js";
import { createReferencesRoutes } from "./routes/references.js";
import { createFeedbackRoutes } from "./routes/feedback.js";
import { createPromotedSeedsRoutes } from "./routes/promoted-seeds.js";
import { createLearningStatsRoutes } from "./routes/learning-stats.js";
import { createSourceCandidatesRoutes } from "./routes/source-candidates.js";
import { createOssPatternsRoutes } from "./routes/oss-patterns.js";
import { createSpecUpdatesRoutes } from "./routes/spec-updates.js";
import { createExternalIntelRoutes } from "./routes/external-intel.js";
import { createPromptVariantsRoutes } from "./routes/prompt-variants.js";
import { createSpawnedAgentsRoutes } from "./routes/spawned-agents.js";
import { createBillingRoutes } from "./routes/billing.js";
import { createLemonsqueezyWebhookRoutes } from "./routes/lemonsqueezy-webhook.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createPlanRoutes } from "./plan.js";
import { createClientErrorRoutes } from "./routes/client-errors.js";
import { createShareRoutes } from "./routes/shares.js";
import { createWorkspaceExtRoutes } from "./routes/workspace-ext.js";
import { createWorkspaceGitHubRoutes } from "./routes/workspace-github.js";
import { createWorkspaceNotificationRoutes } from "./routes/workspace-notifications.js";
import { createWorkspaceTrainingConsentRoutes } from "./routes/workspace-training-consent.js";
import { createWorkspaceAdminStatsRoutes } from "./routes/workspace-admin-stats.js";
import { createWorkspaceAdminCreditsRoutes } from "./routes/workspace-admin-credits.js";
import { createWorkspaceCreditsRoutes } from "./routes/workspace-credits.js";
import { createWorkspaceBenchmarkRoutes } from "./routes/workspace-benchmark.js";
import { createWorkspaceSourcesRoutes } from "./routes/workspace-sources.js";
import { createWorkspaceDocumentIntakeRoutes } from "./routes/workspace-document-intake.js";
import { createWorkspaceVisualChecksRoutes } from "./routes/workspace-visual-checks.js";
import { createWorkspaceVisualCheckRunRoutes } from "./routes/workspace-visual-check-runs.js";
import { createWorkspaceRepairJobRoutes } from "./routes/workspace-repair-jobs.js";
import { createWorkspaceExperimentRoutes } from "./routes/workspace-experiment.js";
import { createWorkspaceAgentWorkflowRoutes } from "./routes/workspace-agent-workflow.js";
import { createWorkspaceMembershipRoutes } from "./routes/workspace-membership.js";
import { createWorkspaceClaimRoutes } from "./routes/workspace-claim.js";
import { createWorkspaceFeedbackRoutes } from "./routes/workspace-feedback.js";
import { createAuthSpikeRoutes } from "./routes/auth-spike.js";
import type { FetchLike } from "./github.js";

/**
 * v0.7.3 — explicitly bind globalThis.fetch at app-construction time.
 * When tests inject `opts.fetch`, we use theirs as-is (they're plain
 * functions, not platform natives). When production calls
 * `createApp()` with no fetch, we hand every route factory a PROPERLY
 * BOUND native fetch so downstream clients (TelegramClient,
 * dispatchRepositoryEvent, OAuth flows) never see the unbound
 * platform reference.
 *
 * Why: native `fetch` on Cloudflare Workers throws
 * "Illegal invocation" when invoked with `this !== globalThis`. The
 * v0.7.2 hotfix addressed this inside TelegramClient by re-binding
 * defensively when `opts.fetch` was absent — but in production the
 * fetch IS passed through the factory chain (opts.fetch →
 * createReviewRoutes(opts.fetch) → new TelegramClient({ fetch:
 * fetchImpl })), so `opts.fetch` was never absent, the defensive
 * re-bind never fired, and outgoing Telegram messages silently
 * failed. Fixing it at the top of the chain is the right
 * architectural layer — downstream code can trust what it's given.
 */
export function createApp(opts: { fetch?: FetchLike } = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const fetchImpl: FetchLike = opts.fetch ?? (fetch.bind(globalThis) as FetchLike);
  app.route("/", healthRoutes);
  app.route("/", registerRoutes);
  app.route("/", episodicRoutes);
  app.route("/", federatedBaselinesRoutes);
  app.route("/", episodicAnchorRoutes);
  app.route("/", memoryRoutes);
  app.route("/", createOAuthRoutes(fetchImpl));
  app.route("/", createTelegramRoutes(fetchImpl));
  app.route("/", createReviewRoutes(fetchImpl));
  app.route("/", createAdminRoutes(fetchImpl as typeof fetch));
  // v0.16 (Problem 3) — SaaS path: /webhook/github, /auth/device, /auth/token,
  // /auth/github/callback, /auth/logout (saas-auth.ts) + /saas/review,
  // /saas/autofix, /saas/me (saas.ts).
  app.route("/", createSaasAuthRoutes());
  app.route("/", createSaasRoutes());
  // Tasks #51 — landing demo (no-auth, IP rate-limited). Single Claude
  // pass with optional PRD; designed to convert landing visitors.
  app.route("/", createDemoRoutes());
  // v0.16.8 — Phase 4: external design-reference cache. CLI review +
  // audit GET /references/:domain to inject curated lessons into RAG.
  app.route("/", createReferencesRoutes());
  // v0.16.9 — Sprint A: user feedback intake (POST /feedback,
  // GET /me/feedback, POST /admin/classify-feedback). Closes the
  // self-evolve loop by capturing user signal back into the substrate.
  app.route("/", createFeedbackRoutes());
  // v0.16.10 — Sprint C: promoted seeds (GET /seeds/promoted/:domain,
  // POST /admin/promote-seeds). Synthesizes promoted seeds from
  // accumulated user feedback so the CLI fetches them at review time.
  app.route("/", createPromotedSeedsRoutes());
  // v0.16.11 — Sprint D: GET /admin/learning-stats. Snapshot of
  // current self-evolve substrate state (feedback, promoted seeds,
  // external references) so operators / dashboards can answer "is the
  // substrate working?" with hard numbers.
  app.route("/", createLearningStatsRoutes());
  // v0.16.12 — Sprint E1: source-candidate discovery + review.
  // GET /admin/source-candidates, POST /admin/source-candidates/:id/decide,
  // POST /admin/run-source-discovery. Weekly cron also runs discovery.
  app.route("/", createSourceCandidatesRoutes());
  // v0.16.13 — Sprint E2: OSS PR pattern miner. GET /seeds/oss-patterns/:domain
  // (public, CLI consumes) + POST /admin/run-oss-pr-miner. Daily cron runs
  // runOssPrMiner() directly.
  app.route("/", createOssPatternsRoutes());
  // v0.16.14 — Sprint E3: changelog/spec monitor. GET /seeds/spec-updates/:domain
  // + POST /admin/run-changelog-monitor. Weekly cron tracks new versions of
  // React/Next.js/Tailwind/TS/shadcn-ui/Storybook for new patterns + deprecations.
  app.route("/", createSpecUpdatesRoutes());
  // v0.17 — Sprint E7: external-intel framework. CVE advisory feed,
  // MCP server registry, shadcn community blocks, awesome-list entries.
  // GET /seeds/external-intel/:domain + POST /admin/run-{cve,mcp-registry,
  // shadcn-block,awesome-list}-miner. Daily/weekly crons in index.ts.
  app.route("/", createExternalIntelRoutes());
  // v0.16.15 — Sprint E4 (scaffold): prompt-variant CRUD admin surface.
  // POST /admin/prompt-variants, GET /admin/prompt-variants,
  // POST /admin/prompt-variants/:id/status. A/B routing wiring with
  // agents lands in a follow-up sprint once Sprint D telemetry matures.
  app.route("/", createPromptVariantsRoutes());
  // v0.16.17 — Sprint E5 (shadow scaffold): agent self-spawning.
  // GET /admin/spawned-agents, POST /admin/spawned-agents/:id/status,
  // POST /admin/run-agent-spawner. Weekly cron also runs the spawner.
  // Spawned agents start in 'shadow' (no user-visible verdict impact).
  app.route("/", createSpawnedAgentsRoutes());
  // v0.14.5 — Billing (Lemon Squeezy MoR). GET /billing renders the
  // buy page; POST /billing/checkout returns a hosted Checkout URL;
  // GET /billing/success + /billing/cancel land post-checkout. All
  // 503 billing_not_configured when LS secrets are absent.
  app.route("/", createBillingRoutes());
  // v0.14.5 — Lemon Squeezy webhook receiver. POST /webhook/lemonsqueezy
  // verifies X-Signature HMAC + grants paid_credits on order_created.
  app.route("/", createLemonsqueezyWebhookRoutes());
  // Workspace generation — free beta, no auth, CORS-enabled for dashboard.
  // POST /workspace/idea-to-spec-draft
  app.route("/", createWorkspaceRoutes());
  // RC-4 — plan entitlement: GET /workspace/plan + admin plan-grants.
  app.route("/", createPlanRoutes());
  // G12 — client error intake (dashboard 전역 핸들러의 fire-and-forget).
  app.route("/", createClientErrorRoutes());
  // G11 — read-only share links (스냅샷 모델, 추측 불가 id, 회수 가능).
  app.route("/", createShareRoutes());
  // G8 D-1 — ExtendedProjectData 서버 정본 (owned 게이트, last-write-wins).
  app.route("/", createWorkspaceExtRoutes());
  // Stage 9 — Workspace GitHub OAuth + project-repo connections.
  app.route("/", createWorkspaceGitHubRoutes(fetchImpl));
  // Stage 17 — Telegram notification settings + history.
  app.route("/", createWorkspaceNotificationRoutes(fetchImpl));
  // Training-data consent — opt-in to retaining raw review triplets (diff +
  // council verdict) in the durable training store. Default OFF; version-gated.
  app.route("/", createWorkspaceTrainingConsentRoutes());
  // Stage 18 — Admin usage stats (key-gated, no billing).
  app.route("/", createWorkspaceAdminStatsRoutes());
  // Stage 20 — Admin credit ledger (key-gated, manual grant + preview, no debit).
  app.route("/", createWorkspaceAdminCreditsRoutes());
  // Stage 33 — User-facing credit balance + top-up request endpoints.
  app.route("/", createWorkspaceCreditsRoutes());
  // Stage 65 — Persisted Multi-Agent Build Benchmark.
  app.route("/", createWorkspaceBenchmarkRoutes());
  // Stage 261 — Unified project sources (website / github_repo / document upload → R2).
  app.route("/", createWorkspaceSourcesRoutes());
  // Stage 265 — Document intake → spec draft (PRD/md upload to draft spec).
  // POST /workspace/projects/:id/sources/:sourceId/spec-draft — draft only,
  // same generation path + hourly rate-limit bucket as idea-to-spec-draft.
  app.route("/", createWorkspaceDocumentIntakeRoutes());
  // Stage 261 — Simsa visual completion-check runs (report snapshots + R2 evidence).
  app.route("/", createWorkspaceVisualChecksRoutes());
  // Stage 263 — cloud runner dispatch: POST .../visual-checks/run queues a
  // SimsaInspector container job; /internal/visual-check-{running,done} are
  // the container's callbacks (Bearer INTERNAL_CALLBACK_TOKEN).
  app.route("/", createWorkspaceVisualCheckRunRoutes());
  // Stage 268 — repair loop: POST .../visual-checks/:runId/repair dispatches a
  // simsa_repair job into the ConclaveSandbox container (repair branch + draft
  // PR from the run's agent_prompt); /internal/repair-{running,done} are the
  // container's callbacks (Bearer INTERNAL_CALLBACK_TOKEN).
  app.route("/", createWorkspaceRepairJobRoutes());
  // Stage 72 — Persisted Manual Multi-Agent Experiments.
  app.route("/", createWorkspaceExperimentRoutes());
  // Stage 112 — Persisted Agent Workflow Records (intake snapshot save/list/read).
  app.route("/", createWorkspaceAgentWorkflowRoutes());
  // Stage 254 — read-only auth-user ↔ workspace bridge (GET /workspace/membership/me).
  app.route("/", createWorkspaceMembershipRoutes());
  // Claim flow (separate file — workspace-membership.ts carries a tested
  // read-only source guarantee): session-gated, 401 when auth is dormant.
  app.route("/", createWorkspaceClaimRoutes());
  app.route("/", createWorkspaceFeedbackRoutes());
  // Stage 209 / 221 — Better Auth LOCAL-ONLY route (/api/auth/*), gated by
  // AUTH_ENABLED. Default off → 503 auth_disabled in production. The D1-backed
  // runtime is constructed per-request ONLY behind AUTH_ENABLED + secret + env.DB
  // gates (local only); production stays dormant. No OAuth, no CORS, no dashboard
  // UI; no production migration/deploy (see auth-spike.ts + docs/stage-220 memo).
  app.route("/", createAuthSpikeRoutes());
  app.onError((err, c) => {
    // Log the full error (message + stack) server-side only. Never echo
    // err.message to clients — it can leak internals (SQL, file paths, keys).
    console.error("central-plane error:", err, err instanceof Error ? err.stack : undefined);
    return c.json({ error: "internal_error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));
  return app;
}
