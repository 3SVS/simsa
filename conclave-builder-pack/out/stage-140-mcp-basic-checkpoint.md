# Stage 140 — MCP Basic Checkpoint

**Date:** 2026-06-24
**PR:** #150 · **Branch:** `feat/stage-134-mcp-basic-helper-inventory` · **HEAD:** `45b43b1`
**Status:** checkpoint — decision-ready. **Not merged, not published, not deployed, no migration.**

Decision-ready handoff for the Stage 134~140 MCP Basic Implementation train.
Mirrors the PR #150 description.

## 1. Train summary
- **134** — Inventory + extraction plan (docs).
- **135** — `@conclave-ai/workspace-preview` skeleton + MCP Basic tool registry (9
  tools).
- **136** — Moved the intake preview closure into the package; MCP wrappers for
  acceptance map / stage plan / agent run plan / evidence plan.
- **137** — Moved acceptance-graph + recurring-blocker (+ 3 optional-input
  helpers); wrappers `previewAcceptanceGraphSummary` / `previewRecurringBlockers`.
- **138** — Moved agent-tool memory + template signals; wrappers
  `previewAgentToolMemory` / `previewTemplateSignals`. **All Stage 126~129 derived
  helpers now in the shared package.**
- **139** — Safe Web App handoff link builder + `createWebAppHandoffLink` wrapper.
- **140** — This checkpoint.

**Result:** the dashboard's deterministic preview helpers were extracted into a
single shared, private package, and the **9 MCP Basic tools are implemented at the
wrapper level** — preview/read/handoff only, no server runtime wiring, no publish.

## 2. Files and packages changed (vs `origin/main`)
- **`packages/workspace-preview`** (new, private) — 16 pure helpers moved in +
  `safety` + `web-app-handoff-link` + index/exports + their tests.
- **`packages/mcp-workspace`** — `mcp-basic-tools` registry + `mcp-basic-preview-
  tools` wrappers (+ tests); existing PR-review tools/`post_pr_comment` unchanged;
  **version unchanged (0.8.2)**.
- **`apps/dashboard/src/lib`** — the moved helper files are now thin re-export
  wrappers; `package.json` gains the `workspace:*` dependency.
- **`conclave-builder-pack/out`** — Stage 134~140 docs.
- **`pnpm-lock.yaml`** — workspace wiring.
- **Audited untouched:** central-plane, migrations, `.github/workflows`,
  `apps/simsa-landing`, `apps/simsa-dev`, billing, auth, domain/DNS.

## 3. workspace-preview package status
- **`private: true`, version `0.0.0`** — cannot be `npm publish`ed.
- Pure ESM (`.mjs` + `.d.mts`); **no build step**; entries point at `src`.
- Subpath exports for every helper + `./safety` + `./web-app-handoff-link`.
- `npm pack --dry-run`: 39 files, 42.0 kB; `files: ["src"]` → **no `dist`, no
  `test/`, no `.env`, no secrets** in the tarball.
- `safety` metadata: `allowsNetwork/allowsMutation/allowsHostedExecution/
  assumesPaymentProvider` all **false**, `paymentProvider: "TBD"`.

## 4. MCP Basic tool coverage
Registry (`mcp-basic-tools.mjs`) lists the **9** approved tools; the wrapper module
(`mcp-basic-preview-tools.mjs`) implements all 9:
`preview_acceptance_map` · `preview_stage_plan` · `preview_agent_run_plan` ·
`preview_evidence_plan` · `preview_acceptance_graph_summary` ·
`preview_recurring_blockers` · `preview_agent_tool_memory` ·
`preview_template_signals` · `create_web_app_handoff_link`. Each is read-only /
preview-or-handoff and returns a boundary (`mutatesState`/`usesHostedExecution`/
`requiresPayment` false, `derivedPreviewOnly` true). **No server runtime wiring** —
the tools are not registered on the MCP `Server` yet (intentional).

## 5. Dashboard compatibility status
Every moved helper's old path (`@/lib/intake-*.mjs`, `@/lib/acceptance-graph-
derived.mjs`, …) is a 2-line re-export wrapper to the package, so **all dashboard
call sites and the intake page work unchanged**. Dashboard tests **218/218**,
typecheck clean, build green (`/projects/new/intake` 30 kB) — same UI behavior.

## 6. Safety boundary audit
Static diff audit (`packages` + `apps/dashboard/src/lib`):
- **No Stripe** — every "stripe" occurrence is a test asserting its **absence**.
- **No payment/billing/checkout/subscription/webhook route or integration.** The
  `payment|checkout|billing` regexes are **pre-existing intake-analysis logic**
  (detecting payment-related *product areas* in user input — moved verbatim), not
  a payment integration.
- **No `process.env` runtime use** — the only mention is the safety-rule string
  "No process.env dependency."
- **No `fetch`/network, no `child_process`/`spawn`/`exec`, no LLM (openai/
  anthropic), no GitHub write, no deploy, no migration.** `new URL(...)` is pure
  parsing (handoff baseUrl validation + intake URL normalizer).
- **No secrets/tokens committed**; the handoff builder actively **omits** obvious
  secret/token patterns.

## 7. Test and build results
- `@conclave-ai/workspace-preview`: **186/186** · typecheck clean.
- `@conclave-ai/mcp-workspace`: **45/45** · typecheck clean.
- `apps/dashboard`: **218/218** · typecheck clean · build green.
- Monorepo `turbo run typecheck`: **57/57**.
- Coverage preserved end-to-end: helper tests moved with their helpers (no loss).

## 8. npm pack dry-run results
- `workspace-preview`: name `@conclave-ai/workspace-preview`, **version 0.0.0**,
  39 files / 42.0 kB / 166.8 kB unpacked. Private — publish would refuse.
- `mcp-workspace`: name `@conclave-ai/mcp-workspace`, **version 0.8.2 (unchanged)**,
  21 files / 20.7 kB. Still **unpublished**. **Dry-run only — no `npm publish`.**

## 9. What is intentionally not implemented
MCP `Server` runtime registration of the Basic tools · MCP publish / version bump
· payment provider (TBD; Stripe not assumed) · hosted execution · login/auth/
session · saved-workflow/handoff persistence · central-plane endpoints · D1
migration · deploy / domain change.

## 10. Known warnings
Only the pre-existing `apps/dashboard/src/app/projects/[id]/export/page.tsx`
exhaustive-deps warning. Not introduced by this train; non-blocking.

## 11. Merge readiness — required conclusions (all confirmed)
- workspace-preview is **private and unpublished** — ✅
- mcp-workspace remains **unpublished** (version unchanged) unless separately
  approved — ✅
- MCP Basic tools are **wrapper-level only** — ✅
- **no server runtime wiring** yet — ✅
- **no payment provider assumption** (paymentProvider TBD) — ✅
- **no Stripe implementation** — ✅
- **no hosted execution** — ✅
- **no central-plane changes** — ✅
- **no D1 migration** — ✅
- **no deploy** — ✅
- **no auth/login implementation** — ✅
- handoff link **does not persist data / create account / trigger payment** — ✅

CI: typecheck-build (20 + 22) **pass**; PR #150 `MERGEABLE` / `CLEAN`.

## 12. Recommended rollout decision
**Option A — Ready to merge PR #150 after Bae approval.**
- Post-merge action: **no deploy required.** The dashboard build is unchanged in
  behavior (helpers moved to the package, wrappers identical output); a dashboard
  redeploy is optional only if Bae wants the latest build live — it is **not
  needed** for correctness since output is identical.
- **No MCP publish · no npm publish · no central-plane deploy · no migration.**

## 13. Recommended next train
Default after merge: **MCP Server Runtime Wiring Train** (register the 9 wrappers
on the MCP `Server`, local smoke, optional `npm pack` — still no publish without
approval). Alternatives: **Auth/Workspace + Korea-compatible Payment Planning**
(needed before paid Web App; payment provider TBD, **Stripe not assumed**) ·
**Outcome Persistence Train** (moat depth).

Only after Bae explicitly approves: merge PR #150 · decide whether runtime wiring
is a new train · decide whether the MCP package stays private/pack-only or
eventually publishes.
