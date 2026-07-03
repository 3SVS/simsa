# Simsa — project overview (hand-off)

> Single-file orientation for a new engineer or AI agent. The repo's history and
> many identifiers still say **conclave-ai** (the original name); the product is
> now **Simsa**. This file is the current source of truth for "what is this,
> where does it run, what's live." Deep design rationale lives in
> `ARCHITECTURE.md` and `docs/`.

---

## 1. What Simsa is

Simsa is a **multi-agent code-review SaaS for non-developers** ("vibe coders"
using v0 / Lovable / Bolt / Cursor). A user describes what they want, connects
the GitHub repo their AI tool pushes to, and Simsa reviews each PR **against
their acceptance items** — reporting each as passed / issue found / not verified
/ needs decision, in plain language (English + Korean). It is not a linter; it
judges whether the submitted code changes actually satisfy the user's intent.

Under the hood a council of frontier models reviews the diff; the verdict feeds
a self-evolving memory (learned success/failure patterns) that sharpens future
reviews. See §5.

**Audience:** global non-developers. UI is fully bilingual (EN default, KO
toggle). Copy avoids jargon ("code changes", not "diff").

---

## 2. Naming: conclave-ai → Simsa

| Surface | Current value |
|---|---|
| Product / brand | **Simsa** (심사 = "review/adjudication") |
| npm scope | **`@simsa/*`** (was `@conclave-ai/*` — old npm account is lost; see §7) |
| CLI binaries | **`simsa`** and `conclave` (alias — both work) |
| GitHub repo | `3SVS/conclave-ai` (unchanged) |
| Cloudflare Worker | `conclave-ai` (unchanged — renaming a Worker is disruptive) |
| Config file | `.conclaverc.json`, cosmiconfig key `conclave` (unchanged for compat) |
| Dashboard domain | `app.trysimsa.com` |
| Landing domain | `www.conclave-ai.dev` (marketing site) |
| Support email | `hi@conclave-ai.dev` |

**Rule of thumb:** user-facing = Simsa; infra identifiers may still be
conclave-ai and that's intentional, not a bug. Historical docs (CHANGELOG,
`docs/releases/*`, HANDOFF files) keep the old scope on purpose.

---

## 3. Where it runs (live as of 2026-07)

| Component | Path | Deploys to | How |
|---|---|---|---|
| **Central plane** (API) | `apps/central-plane` | Cloudflare Worker `conclave-ai` + D1 + R2 | **manual**: `gh workflow run deploy-central-plane -f confirm=deploy -f apply-migrations=true` |
| **Dashboard** (user app) | `apps/dashboard` | Vercel `conclave-dashboard` → `app.trysimsa.com` | `cd <repo root> && vercel deploy --prod --yes --archive=tgz` |
| **Landing** (marketing) | `apps/landing` | Vercel `conclave-ai` → `www.conclave-ai.dev` | Vercel project `conclave-ai`, root `apps/landing`, `--archive=tgz` |
| **CLI** (BYO path) | `packages/cli` | npm `@simsa/cli` | `gh workflow run release -f bump=patch` |

- Worker base URL: `https://conclave-ai.seunghunbae.workers.dev`
- `deploy-central-plane` is **manual-only by design** — merging to main runs CI
  but does NOT deploy. Migrations are forward-only + idempotent.
- **Never** run `wrangler secret put` locally (Containers bindings strand a
  staged version and lock deploys). Use the **`set-worker-secrets`** workflow
  (allowlisted secret names pulled from repo secrets).

---

## 4. Monorepo layout

pnpm + Turbo, TypeScript strict ESM, Node ≥ 20. **28 packages + 5 apps.**
Tests are `node --test` only — never Jest/Vitest; mock at the seam.

- `apps/central-plane` — Hono-on-Workers API. D1 (SQLite) via forward-only
  migrations in `migrations/NNNN_*.sql` (latest: `0054`). R2 bucket
  `simsa-evidence` for screenshots/docs/training data.
- `apps/dashboard` — Next.js user app. i18n is **dictionary-first**:
  `src/i18n/dictionary.mjs` (EN+KO, parity-tested) with a `.d.mts` type mirror.
  Deep-screen logic often lives in `.mjs` + `.d.mts` pairs (Node 20 CI can't
  strip TS types from test files).
- `apps/landing` — Next.js marketing + Terms/Privacy.
- `packages/core` — Council orchestration, scoring, **memory substrate** (§5),
  efficiency gate. Every LLM call must route through the efficiency gate.
- `packages/agent-{claude,openai,gemini,grok,ollama,design,worker}` — pluggable
  agents; missing API key skips cleanly.
- `packages/cli` — the `simsa`/`conclave` binary, 22 commands. BYO path.
- `packages/scm-github`, `platform-*`, `integration-*` — infra adapters.
- `packages/mcp-workspace` — stdio MCP server (IDE integration).

---

## 5. The moat: self-evolve substrate

This is the non-obvious core. Two git-tracked catalogs under `.conclave/`:

- **answer-keys/** — SUCCESS patterns, written on merge. ∞ TTL.
- **failure-catalog/** — FAILURE patterns, written on reject. ∞ TTL.

Every review reads top-K from BOTH as RAG context, so reviews learn each repo's
tolerance over time. Raw per-cycle events live in **episodic/** with a **90-day
TTL** — they're distilled (nightly Haiku classify → weekly rule extraction →
monthly proceduralize + federated sync) into the catalogs, then aged out.

Also shipped: external-intel crawlers (daily design refs, weekly GitHub
trending, daily OSS bugfix-PR mining), prompt-variant A/B with Bayesian CIs, and
shadow agent self-spawning.

**Key limitation to know (A vs B):** this is an excellent *prompt/RAG* evolution
system ("A"). It is **not** a self-trained model ("B") — `ARCHITECTURE.md`
explicitly calls it "RLHF-like substrate **without fine-tuning**." The episodic
log stores only `diffSha256` (a hash), so raw diffs were never retained for
training. §6 is the bridge being built toward B.

---

## 6. Training store + consent (NEW — 2026-07, branch `training-store-consent`)

The gap in §5: distilled RULES can't fine-tune a model — that needs the original
`{diff, council verdict, outcome}` triplet, which was being hashed/aged away.
The council's per-item verdict is itself a **high-value supervised label** (three
frontier models' judgement at cents per PR) — the raw material for a future
distilled reviewer/triage model.

What was added (SaaS path only, since the server already holds the diff there):

- **Consent, opt-in, default OFF, version-gated.** Table
  `workspace_training_consent` (migration `0054`); module
  `training-consent-db.ts` (`TRAINING_CONSENT_VERSION`). Routes:
  `GET|POST /workspace/training-consent`. Dashboard toggle in project
  **Settings → "Help improve Simsa"** (i18n `trainingConsent.*`).
- **Capture, best-effort, never throws.** `training-store.ts` →
  `captureTrainingRecord`. Hooked into the PR-review endpoint
  (`workspace-github.ts`, step 9c). No consent OR no R2 bucket → no-op. Stores
  one JSON record per review at `training/YYYY/MM/DD/<runId>.json` in R2. Keyed
  by `sha256(userKey)` — **raw handle/email never in the payload**.
- **ToS clause** added: landing Terms §VI "Data & model training" (opt-in,
  anonymized; BYO/CLI code never leaves the machine).

**Known gap (documented, not silent):** the merge/reject *reward* signal isn't
known at review time — records land `outcome: "pending"`. A later PR-state poll
can append it.

**Still to do (future):** CLI/BYO path needs an upload contract + consent UX
(would amend architecture decision #21 "code never leaves the machine"); a
held-out eval set (50–100 labelled vibe-coder failures) to prove a trained model
beats a frontier baseline; then a triage model as the cheap first fine-tune.

---

## 7. Billing (GitHub Marketplace only, for now)

- **BYO mode is free forever** (user brings own API keys).
- Paid: **GitHub Marketplace** subscriptions map to monthly free-review
  allowances: `first-pr pass` +5, `Solo` +30, `Pro` +100
  (`marketplace-entitlement.ts`). Landing prices: First-PR pass $3/mo, Solo $19,
  Pro $49. GHM has **no one-time purchases** — first-pr pass is a $3 monthly sub
  framed "cancel anytime."
- **Lemon Squeezy** subscription/refund automation exists but is **dormant**
  (awaiting LS approval; activate via `LS_SUBSCRIPTION_VARIANT_CREDITS` env).
- **Credit debits are OFF in production** (`ENABLE_ACTUAL_CREDIT_DEBITS=false`,
  `ENABLE_CREDIT_BLOCKING=false`) — allowance/ledger run in dry-run/preview.
- Marketplace listing URL 404s until GitHub approves it; landing CTAs point at
  the GitHub App page (`github.com/apps/conclave-ai-code-council`) meanwhile.

---

## 8. Auth & identity

- **Better Auth** (D1-backed) is live in prod; `get-session` returns 200.
- SaaS identity handle in most workspace routes is **`userKey`** (a capability
  string). Ownership is enforced per-`userKey` (`denyUnlessOwnedProject`).
- A **claim flow** (`workspace-claim.ts`, migration `0048`) binds a legacy
  `userKey` workspace to an authenticated account.
- Public sign-up is **open** (`AUTH_SIGNUP_MODE=open`).
- Private repos: supported via the **GitHub App** installation
  (`github-app-access.ts`) — OAuth probe → App installation token fallback.

---

## 9. npm publish state (read before releasing)

- Scope moved to `@simsa/*` after the old npm account became unrecoverable.
- The new npm account's **write token has a 90-day max expiry** (npm policy) and
  **must have "bypass 2FA" enabled** or publish 403s in CI. Secret: `NPM_TOKEN`.
- Publishing new packages under a fresh org hits npm's **new-package rate limit
  (E429)** — a first bulk publish may need retries spread over hours/a day. The
  release script skips already-published versions, so reruns are safe.
- Current: `@simsa/core@0.16.1`, `@simsa/cli@0.18.1` (most packages published;
  any stragglers just need a release rerun once the rate limit clears).
- **Next hardening:** move to npm **Trusted Publishing (OIDC)** so CI publishes
  without a token at all (release.yml already has `id-token: write`) — kills the
  expiry-token failure mode. Then revoke the manual token.

---

## 10. Guardrails (things that bite)

- **Deploy is manual** for the Worker; **never push to main directly** except
  hotfixes after local `pnpm verify`. PRs → CI green → merge.
- **Secrets never local** — only via `set-worker-secrets` workflow.
- **Zod at every external boundary**; no `as any` to dodge types. Regenerate
  types after schema changes.
- **Tests alongside code**, `node --test`, mock at the seam. i18n changes must
  keep EN/KO parity (`apps/dashboard/test/i18n.test.mjs`).
- **Regression sweep before fixing a bug** — grep for the same pattern elsewhere
  and fix together.
- Stacked PRs whose base is a feature branch do NOT reach main when merged —
  always base user-facing PRs on `main`.

---

## 11. Fast orientation for an agent

1. Read `ARCHITECTURE.md` §"7-Layer Architecture" and §"Self-Evolve Substrate".
2. `apps/central-plane/src/router.ts` — every route mount in one place.
3. `apps/central-plane/src/routes/workspace-github.ts` — the PR-review endpoint
   (the product's core loop).
4. `apps/dashboard/src/app/projects/[id]/` — the user's screens.
5. `docs/decision-status.md` — where the code diverges from the original 34
   locked decisions, and why.
