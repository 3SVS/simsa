<div align="center">

# Conclave AI

**A council of AI agents reviews your PRs against your PRD.**
<br/>
<sub>Three frontier models. One verdict. Catches what single-LLM review misses.</sub>

[![npm](https://img.shields.io/npm/v/@conclave-ai/cli?label=%40conclave-ai%2Fcli&color=%230a3a5e)](https://www.npmjs.com/package/@conclave-ai/cli)
[![license](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-%230a3a5e)](LICENSE)
[![node](https://img.shields.io/node/v/@conclave-ai/cli?color=%230a3a5e)](https://nodejs.org)
[![demo](https://img.shields.io/badge/demo-conclave--ai.dev-%230a3a5e)](https://conclave-ai.dev)

[**▶ Try the demo**](https://conclave-ai.dev) · [**Install GitHub App**](https://github.com/apps/conclave-ai-code-council) · [**Pricing**](https://conclave-ai.dev#pricing) · [**Docs**](docs/)

</div>

---

## What is this?

Conclave AI is a **multi-agent code-review SaaS** for indie devs and AI-built apps. It runs three independent reviewers (Claude, GPT-5, Gemini) on every pull request, surfaces real blockers instead of style nits, and — when you attach a PRD — flags **scope deviations and spec mismatches** that no single-LLM reviewer catches.

> **Not** a Claude Code / Cursor / Copilot replacement. Those are IDE assistants. Conclave runs at the **PR layer** — one review per push, automatic autofix, native GitHub App.

## Why three agents instead of one

We dogfooded 15 synthetic-bug PRs across 5 vibe-coder Next.js templates (Vercel commerce, ai-chatbot, next-forge, platforms, postgres-auth-starter):

| | **Conclave (3-agent)** | **Claude alone** |
|---|---|---|
| Catch rate (synthetic blockers) | 100% | 100% |
| **Mean blockers surfaced per PR** | **10.93** | 3.80 |
| Latency | 128s (parallel) | 12s |
| Cache hit rate | 39.9% | n/a |

Same catch rate **but 3× the depth** — and the depth matters: the extra blockers are usually missing tests, edge-case handling, and security gaps that a single agent considered "minor enough to skip."

<sub>Numbers are from an internal dogfooding run (n=15 PRs, 5 Next.js templates). Reproduction protocol + scoring rubric live in [`benchmarks/`](benchmarks/) (skeleton — raw per-run results pending a redaction pass before split-out into a standalone `conclave-benchmarks` repo). Treat as an indicative ratio, not a peer-reviewed benchmark.</sub>

### The PRD layer is the moat

When we re-ran the same 3 PRs with a structured `.conclave/prd.md` attached:

| PR | No PRD | With PRD |
|---|---|---|
| build-bug | 3 blockers, verdict **rework** | **9 blockers (5 spec-mismatch)**, verdict **reject** |
| a11y-bug | 5 blockers, verdict **rework** | **11 blockers (4 spec-mismatch)**, verdict **reject** |
| regression-bug | 4 blockers, verdict **rework** | **7 blockers (6 spec-mismatch!)**, verdict **reject** |

`spec-mismatch` is a **categorically new flag class** — agents only produce it when they have access to the PRD. Examples it catches that plain code review can't:

- Endpoint exists but **wrong route** vs PRD (`/phase2-settings` vs `/settings`)
- **Missing acceptance criteria** (PRD says "must return 400 on bad input", code throws 500)
- **Scope creep** (PR adds telemetry the PRD doesn't authorize)
- **Hard-requirement violations** (PRD says "must NOT log Authorization headers", code does)

## Quick start

### As a SaaS user (recommended)

```bash
npm i -g @conclave-ai/cli
conclave login
```

Install the [GitHub App](https://github.com/apps/conclave-ai-code-council) on your repo, drop a `.conclave/prd.md`, and open a PR. Verdict + autofix land as a PR check + Telegram notification within ~2 minutes.

**Free tier**: BYO Anthropic key for unlimited usage, or 5 reviews/month no-card trial.

### As a self-hoster

```bash
git clone https://github.com/3SVS/conclave-ai
cd conclave-ai && pnpm install && pnpm build
# Configure your own ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
node packages/cli/dist/bin/conclave.js review --pr 42
```

The full pipeline runs locally on your repo's clone. The federated failure-catalog (cross-tenant learning) is SaaS-only — the rest of the engine is FSL-licensed source.

### Vercel Pro / strict deploy gates

Conclave AI's autofix bot commits as the canonical GitHub App noreply
identity (`<APP_ID>+conclave-ai-code-council[bot]@users.noreply.github.com`)
— the same format Dependabot and GitHub Actions use. Default Vercel /
Netlify projects accept it automatically.

If your project enables **"Verify Commit Authors"** (Vercel Pro+) and
deploys are blocked on autofix commits, allow GitHub App bot accounts
in your Vercel team settings (`Project → Settings → Git → Deployment
Authorization`). Same as you'd do for Dependabot. See
[docs/vercel-pro-setup.md](docs/vercel-pro-setup.md) for the exact path.

## How it works

We don't stop at "your PR has problems." Conclave takes responsibility for the full lifecycle: review → debate → rewrite → re-review → ship. You get a green check or a clear blocker, never a half-finished verdict.

```text
PR opens
  ↓
GitHub App webhook → Cloudflare Worker
  ↓
Auth + repo allow-list check
  ↓
Spawn ephemeral Cloudflare Container (Node 20)
  ↓
─────────────────────────────────────────────
  COUNCIL  (up to 3 deliberation rounds)
─────────────────────────────────────────────
  Round 1: agents review IN PARALLEL
   ┌──── Claude Sonnet 4.6 ────┐
   ├──── GPT-5-mini ───────────┤  + design / failure-gate when relevant
   └──── Gemini 2.5 Pro ───────┘
       ↓
   Consensus?  ─── yes ────────────────► verdict locked
       ↓ no
  Round 2: each agent sees others' blockers + rebuts
       ↓
   Consensus?  ─── yes ────────────────► verdict locked
       ↓ no
  Round 3: final round, majority verdict locked
─────────────────────────────────────────────
  ↓
final verdict
   ↓
   approve     rework               reject
       │         │                    │
       │   Worker (Opus 4.7) rewrites │  rejected: human escalation,
       │   the offending files in     │  no auto-merge, comment posted
       │   full ──► git push          │
       │         │                    │
       │   AUTOFIX LOOP (up to 3      │
       │   attempts — same Council    │
       │   re-runs each push) ────────┘
       │         │
       │   council re-converges OR caps out
       │         │
   ✓ approve   merge gate held until human ack
       │
   Telegram + GitHub check-run keyboard
```

End-to-end guarantees:

- **3 council rounds** before locking a verdict — single-agent disagreement never wins by itself.
- **Up to 3 autofix cycles** when the verdict is `rework` — worker rewrites whole files (not minimal patches), Council re-reviews each push.
- **Hard stop** if the loop can't converge: a `reject` verdict + clear human-readable blocker list lands as a PR check, never silent.
- **Smoke verification** runs against the deploy URL after autofix lands — if the build/runtime fails post-merge, the verdict downgrades to `rework` automatically and the PR check goes red. (Phase 5 catch-regression detector also tracks "this category was missed; flag harder next time.")

The full architecture is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The 34 design decisions locked on 2026-04-19 are in [`docs/decisions.md`](docs/decisions.md).

## Self-evolve loop

Conclave doesn't just review PRs — **the rule set itself gets smarter over time**. Three pipelines feed the council's prompt:

```text
Reactive (from your feedback)
  conclave feedback → POST /feedback
        ↓ Haiku classify (sync, cron retry on failure)
    user_feedback table
        ↓ daily 0400 UTC promoter cron
    promoted_seeds  ← synthesized via Haiku from ≥3 same-category rows
        ↓
    CLI review/audit fetch + inject

Proactive (from the world)
  daily 0300 UTC      Vercel Design / shadcn-ui / Refactoring UI / Design
                      Systems Checklist                         → external_references
  weekly 0500 UTC Sun GitHub Trending sweep (design-system / a11y / patterns)
                      → source_candidates (operator approves)
  daily 0600 UTC      OSS bugfix PR scan (Next.js / React / shadcn-ui /
                      Tailwind / Storybook / Vercel style-guide)
                      → oss_pr_patterns (Haiku extracts anti-pattern)

All three streams flow into ctx.answerKeys / ctx.failureCatalog at every council review.
```

Operator surface (`INTERNAL_CALLBACK_TOKEN`-auth):

- `GET  /admin/learning-stats` — substrate snapshot (feedback by status / category, promoted-seed counts, external-ref counts)
- `GET  /admin/source-candidates[?status=…]` — newly-discovered candidate repos
- `POST /admin/source-candidates/:id/decide` — approve / reject a candidate
- `POST /admin/promote-seeds` / `/admin/run-source-discovery` / `/admin/run-oss-pr-miner` — manual triggers (cron handles the same calls)

User surface:

- `POST /feedback` (Bearer) — submit feedback on a prior review
- `GET /me/feedback` (Bearer) — list your own
- `conclave feedback [--list] [--json]` — CLI wrapper

Every `conclave review --json` emits `metrics.rag` with per-source injection counts so you can see which streams contributed to a given review.

## Pricing

| Plan | Price | Reviews | Autofixes | Notes |
|---|---|---|---|---|
| **Free (BYO key)** | $0 | unlimited | unlimited | bring your own Anthropic API key + opt into anonymous failure-pattern sharing |
| **Trial** | $0 | 5/month | 2/month | platform-managed key; no card required |
| **Solo** | $19/mo | 30 | 10 | most popular for indie builders |
| **Pro** | $49/mo | 80 | 30 | priority sandbox queue + private mode |

Hard cutoffs (no surprise overage bills). $5 booster top-ups for one-off bursts.

## Architecture status

| Component | Status |
|---|---|
| CLI (`@conclave-ai/cli`) — `conclave login / review / audit / autofix / whoami / feedback` | ✅ shipped, npm latest |
| Multi-agent council (Claude + OpenAI + Gemini) | ✅ shipped |
| Design agent + visual review (a11y / tokens / hierarchy) | ✅ shipped |
| PRD-aware spec-mismatch flagging | ✅ shipped (v0.15) |
| Mechanical handlers (AF-1..AF-11 — deterministic fixers) | ✅ shipped |
| GitHub App + webhook | ✅ live (`conclave-ai-code-council`) |
| Device Flow auth (`conclave login`) | ✅ live |
| Curated external-reference cache (5 sources, daily refresh) | ✅ shipped (v0.16.8 / Phase 4) |
| User feedback intake + Haiku classifier | ✅ shipped (v0.16.9 / Sprint A) |
| `conclave feedback` CLI subcommand | ✅ shipped (v0.16.10 / Sprint B) |
| Promoted-seed loop (`feedback → bundled rules`, daily promoter cron) | ✅ shipped (v0.16.10 / Sprint C) |
| Failure-gate + catch-regression focus filter | ✅ shipped (v0.16.10) |
| `/admin/learning-stats` + `metrics.rag` per review | ✅ shipped (v0.16.11 / Sprint D) |
| GitHub Trending source-discovery crawler | ✅ shipped (v0.16.12 / Sprint E1) |
| OSS bugfix-PR pattern miner | ✅ shipped (v0.16.13 / Sprint E2) |
| Changelog/spec monitor (React/Next.js/Tailwind/TS/shadcn-ui/Storybook releases) | ✅ shipped (v0.16.14 / Sprint E3) |
| Prompt-variant override + outcome ingestion + Bayesian confidence intervals | ✅ shipped (v0.16.15-16 / Sprint E4 — operator-opt-in via `INTERNAL_CALLBACK_TOKEN`) |
| Agent self-spawning + council wire-in (trial state, advisory verdict during trial, auto-graduation by pass-rate window) | ✅ shipped (v0.14.3 / Sprint E5 — operator-opt-in via `INTERNAL_CALLBACK_TOKEN`) |
| `/saas/review` + `/saas/autofix` endpoints | ✅ shipped (v0.14.4 / Sprint E6 — operator runs `wrangler deploy` per [`docs/saas-deploy-checklist.md`](docs/saas-deploy-checklist.md)) |
| Cloudflare Containers worker (`ConclaveSandbox`) | ✅ shipped (v0.14.4 / Sprint E6 — Node 20 + git + GH CLI; runs autofix-pipeline per /saas/* request, callback to `/internal/job-done`) |
| Stripe metering + paid tiers | ⏳ deferred until moat data accumulates from real usage |

## Project structure

```
packages/
  cli/                       Conclave CLI binary + autofix-pipeline
  core/                      Pure orchestration: council, autofix loop, memory
  agent-claude/              Claude Sonnet 4.6 review agent
  agent-openai/              GPT-5-mini review agent
  agent-gemini/              Gemini 2.5 Pro review agent
  agent-design/              Design / a11y review (vision + structured)
  agent-worker/              Worker model that produces full-file rewrites
  scm-github/                GitHub PR + deploy-status helpers
  secret-guard/              Pre-apply secret scanner (blocks on high-confidence findings)
  visual-review/             Playwright + pixel diff for design domain
  integration-{telegram,discord,slack,email}/  Equal-weight notifiers
  platform-{vercel,netlify,cloudflare,railway,render}/  Deploy-status adapters
  observability-langfuse/    Optional self-hosted tracing

apps/
  central-plane/             Cloudflare Worker + D1 — auth, webhook, SaaS endpoints
  landing/                   Next.js landing on conclave-ai.dev
```

## Repo conventions

- **One package, one responsibility.** No `utility/` or `common/` dumping grounds.
- **Zod at every external boundary.** HTTP bodies, file formats, CLI input, LLM tool-use responses — all parsed.
- **Tests alongside the code.** `node --test` only — no Jest, no Vitest.
- **TypeScript strict + `noUncheckedIndexedAccess`**. Indexing returns `T | undefined`; handle it.
- **Lockstep versioning.** All publishable packages bump together (pre-1.0 policy).

See [`CLAUDE.md`](CLAUDE.md) for the canonical convention list.

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for:

- How to run the test suite (`pnpm test` — 26 packages, 1700+ tests across 168 files)
- How to add a new agent adapter (mirror `packages/agent-claude`)
- How to add a platform deploy-status adapter (mirror `packages/platform-railway`)
- Commit + PR conventions

We dogfood our own product — every PR to this repo is reviewed by Conclave AI itself.

## License

[FSL-1.1-Apache-2.0](LICENSE) — Functional Source License. You can use, modify, and redistribute the source freely for any purpose **except** running it as a competing commercial code-review SaaS. The license auto-converts to **Apache 2.0** on **2028-05-07** (two years from first publication).

In plain English:

- ✅ Self-host for your own internal use — go for it
- ✅ Fork it, patch it, send PRs upstream — please do
- ✅ Build a non-competing tool that integrates with it — go for it
- ✅ Use it in education, research, or your own non-SaaS product — yes
- ❌ Run it as a competing managed-service offering before 2028-05-07 — no

Same approach used by Sentry, Strapi, Convex, Buoyant.

---

<div align="center">
<sub>Built by <a href="https://3svs.com">3SVS</a> · powered by Anthropic, OpenAI, Google · <a href="https://conclave-ai.dev">conclave-ai.dev</a></sub>
</div>
