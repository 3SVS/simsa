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
import { createPromptVariantsRoutes } from "./routes/prompt-variants.js";
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
  // v0.16.15 — Sprint E4 (scaffold): prompt-variant CRUD admin surface.
  // POST /admin/prompt-variants, GET /admin/prompt-variants,
  // POST /admin/prompt-variants/:id/status. A/B routing wiring with
  // agents lands in a follow-up sprint once Sprint D telemetry matures.
  app.route("/", createPromptVariantsRoutes());
  app.onError((err, c) => {
    console.error("central-plane error:", err);
    return c.json({ error: err.message || "internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "not found", path: c.req.path }, 404));
  return app;
}
