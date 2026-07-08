> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 132 — Moat Train Checkpoint

**Date:** 2026-06-24
**PR:** #148 · **Branch:** `feat/stage-126-acceptance-graph-view` · **HEAD:** `a3cc59f`
**Status:** checkpoint — decision-ready. **Not merged, not deployed, no migration (none in this train).**

Decision-ready handoff for the Stage 126~132 Acceptance Graph / Moat train.
Dashboard-only + docs. Mirrors the PR #148 description.

## 1. Train summary
- **126** Saved workflow snapshots → Acceptance Graph Derived View
- **127** Acceptance Graph → Recurring Blocker Signals
- **128** Agent Run Plan + Evidence Plan + Blockers → Agent/Tool Recommendation Memory
- **129** Graph + Blockers + Tool Memory → Template Effectiveness Signals
- **130** Outcome Improvement Graph planning (docs)
- **131** MCP Basic free-vs-paid boundary spec (docs)

**Main message:** the train turns saved workflow records into derived acceptance
intelligence signals **without adding DB migrations, model training, or backend
mutation.**

## 2. Included stages
126 Acceptance Graph Derived View v1 · 127 Recurring Blocker Detection · 128
Agent/Tool Recommendation Memory · 129 Template Effectiveness Signals · 130
Outcome Improvement Graph Planning · 131 MCP Basic Boundary Spec · 132 Checkpoint.

## 3. Product value delivered
Simsa now shows how **one saved workflow** connects acceptance items · stages ·
agent tasks · evidence expectations · blocker signals · tool fit · template
improvement signals — early **moat infrastructure**. All **derived signals /
per-workflow memory / preview-only / not statistically validated / not trained /
not verified defects.** No cross-project learning is claimed.

## 4. Moat thesis progress
Thesis (Stage 125): *Simsa's value compounds via an Acceptance Graph across
AI-built workflows.* This train delivers the **first derived layer** of that graph
(per-workflow) + three signal families (blockers, agent/tool memory, template
effectiveness). Stages 130–131 plan the next depth (outcome improvement) and the
distribution boundary (MCP Basic) — without implementing them.

## 5. User-facing surface changed
`/projects/new/intake` — opened saved-workflow record detail now appends, in
order: Acceptance Graph Derived View → Recurring Blocker Signals → Agent/Tool
Recommendation Memory → Template Effectiveness Signals. Each is `useMemo`-derived
from the saved record + prior previews, with derived-preview disclaimers and
empty-state copy. Nothing else changed.

## 6. Backend / migration impact
**None.** No central-plane code, **no new migration, no new D1 table, no graph
database, no persisted blocker/memory/template metrics, no MCP runtime change.**
Therefore: **central-plane deploy not required · D1 migration not required ·
dashboard deploy required after merge** to make the UI live.

## 7. Payment provider correction (checkpoint decision)
Stage 131 defines the Web App as the payment/account surface but **does not select
Stripe or any provider.** Because Bae is **not operating from a US company by
default and Stripe must not be assumed**, future paid Web App work must use a
**provider-agnostic billing boundary and evaluate Korea-compatible payment
providers first.**

- **No Stripe implementation. No Stripe Billing assumption. No payment provider
  selected. No billing/payment implementation in this train.**
- Audit result: the train's changed files contain **no Stripe-specific code,
  copy, routes, SDKs, billing/customer/subscription/webhook objects, or checkout
  assumptions.** Existing Stage 130/131 wording is already provider-neutral
  ("payment provider", "account/payment", "usage credits"); the only `customer`
  occurrence is "customer confidential data" (data-policy text, not a Stripe
  object). No doc edits required.
- **Future payment/commercialization train should evaluate:** Korea-compatible
  PG/payment provider · subscription feasibility · invoice/manual billing for
  early B2B · tax/accounting requirements · whether a US entity / Stripe Atlas
  path is ever necessary (optional, separate legal/entity decision). **Not now.**

## 8. MCP Basic boundary summary (Stage 131, provider-neutral)
- **MCP Basic** — free distribution layer; preview/read/handoff; no default
  mutation; not a billing surface; no high-risk tools.
- **Web App** — persistence; account/payment (provider TBD); saved records;
  team/admin (later); benchmark/decision/outcome/action history (later).
- **Hosted execution** — future paid usage/credit layer; explicit confirmation;
  clear cost/provider boundary; audit.

## 9. Liability / trust boundary
Derived signals are **not certification.** Vocabulary held across the train:
derived / per-workflow / preview-only / candidate / not_verified / needs
refinement. Avoided: trained model / statistically proven / best-performing tool /
verified blocker / certified outcome. Final accept/release decisions remain with
the user/team.

## 10. Verification (HEAD a3cc59f)
- dashboard: **386/386** tests · central-plane: **1181/1181** (unchanged) · both
  typecheck clean · monorepo `turbo run typecheck` **56/56** · dashboard build
  **green** (`/projects/new/intake` 30 kB).
- **Migration audit:** no central-plane/migration files changed in this train.
- **Payment audit:** no Stripe/provider-specific assumptions.

## 11. Known warnings
Only the pre-existing `apps/dashboard/src/app/projects/[id]/export/page.tsx`
exhaustive-deps warning. Not introduced by this train; non-blocking.

## 12. Deploy implications
Dashboard-only changes. **central-plane deploy: not required · D1 migration: not
required · dashboard deploy: required after merge.** No landing/simsa.dev deploy,
no domain/DNS, no payment provider change, no MCP publish.

## 13. Rollout options
- **A — Merge only, no deploy:** code/docs on main; the graph/blocker/memory/
  template sections are not live.
- **B — Merge + dashboard deploy:** **recommended** (verification green); makes
  Stage 126~129 sections live; no central-plane / D1 migration.
- **C — Hold PR open:** only if verification fails or a payment-assumption problem
  is found (none found).

## 14. Smoke plan (after approval)
`app.trysimsa.com/projects/new/intake`: page loads · saved workflow list opens ·
saved record detail opens · Acceptance Graph Derived View · Recurring Blocker
Signals · Agent/Tool Recommendation Memory · Template Effectiveness Signals appear
· derived-preview disclaimers present · no trained-model/statistical-validation/
verified-defect claims.
Regression (all 200): `app.trysimsa.com`, `/projects/new`, `/admin/workflows`,
`trysimsa.com`, `trysimsa.com/demo`, `simsa.dev`, `conclave-dashboard.vercel.app`.

## 15. Rollback plan
Dashboard deploy fails or the derived view breaks the intake page → **roll back
dashboard to the previous production deployment.** No central-plane rollback
expected; **no migration rollback needed** (none introduced).

## 16. Risks → mitigations
- Intake saved-record detail UI is getting long → sections are derived/`useMemo`,
  empty-state guarded; consider tabs/collapse in a future stage.
- Derived signals mistaken for verified findings → derived-preview labels
  everywhere; no verified-defect language.
- Template effectiveness mistaken for statistical validation → "not statistically
  validated" copy + tests forbidding such claims.
- MCP boundary misread as immediate paid MCP → Stage 131 says MCP Basic is
  preview/read/handoff only; no publish.
- Payment surface misread as Stripe → §7 correction: provider TBD,
  Korea-compatible first, no Stripe assumption.

## 17. Recommendation
**READY TO MERGE + DASHBOARD-ONLY ROLLOUT** (Option B), pending Bae approval:
1. squash merge PR #148
2. deploy dashboard (no central-plane deploy, no migration)
3. smoke `app.trysimsa.com/projects/new/intake` + regression.

**Merge / deploy not executed in this stage.**

## 18. Recommended next train
Primary: **Stage 133 — MCP Basic Implementation Planning** (aligns with the
confirmed free-distribution strategy). Alternatives:
- **Option 1 (recommended) — MCP Basic Implementation Planning:** implement
  preview/read/handoff tools; provider-neutral; no billing; no hosted execution.
- **Option 2 — Outcome Persistence Planning:** manual outcome event recording +
  workflow outcome timeline; no cross-project analytics yet (moat depth).
- **Option 3 — Auth / Workspace Planning:** real account/workspace/team boundary
  (needed before serious paid Web App / paid beta readiness).

Guidance: MCP Basic next if the goal is **distribution**; Auth/Workspace next if
the goal is **paid beta readiness**; Outcome Persistence next if the goal is
**moat depth**. **Do not implement a payment provider yet; do not assume Stripe;
keep commercialization as a later Korea-compatible provider decision.**
