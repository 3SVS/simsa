# Stage 147 — MCP Server Runtime Wiring Checkpoint

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (PR #151) · **Base:** `main` @ `e3d6fa4` · **HEAD:** `cd1074f`
**Type:** checkpoint (decision-ready). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Train summary
The MCP Server Runtime Wiring Train wires the previously-extracted MCP Basic wrappers
into the actual MCP server runtime and makes the free Basic surface usable with no
credentials.
- **141** — planning / tool-registration boundary (docs).
- **142** — registered the 8 read-only preview tools; added backward-compatible
  **Basic-only mode** (`ServerOptions.client` optional; `index.ts` starts without
  `CONCLAVE_USER_KEY`); `getMcpToolRegistrationPlan` + `runBasicPreviewTool`;
  `scripts/copy-basic-tools.mjs` copies the Basic `.mjs`/`.d.mts` into `dist`.
- **143** — registered `create_web_app_handoff_link` → **9-tool** free Basic surface.
- **144** — local smoke harness (`smoke:basic`, `runBasicSmoke()`), no creds/network.
- **145** — README/docs rework (dual mode; corrected stale claims; not-published).
- **146** — pack-only checkpoint (`npm pack --dry-run`), Option A.
- **147** — this checkpoint.

## 2. Runtime tool coverage
**9 Basic tools registered** in `buildServer`: `preview_acceptance_map`,
`preview_stage_plan`, `preview_agent_run_plan`, `preview_evidence_plan`,
`preview_acceptance_graph_summary`, `preview_recurring_blockers`,
`preview_agent_tool_memory`, `preview_template_signals`,
`create_web_app_handoff_link`. The 9 connected tools (`list_projects`, `get_project`,
`list_pull_requests`, `run_pr_review`, `get_review_history`, `get_review_run`,
`create_fix_instructions`, `compare_runs`, `preview_pr_comment`) register only with a
client; `post_pr_comment` registers only with a client **and** `enablePostComment`.

## 3. Basic-only mode verification (no `CONCLAVE_USER_KEY`)
Runtime audit of the built `dist/server.js`:
- `mode = basic_only`, **basic = 9**, **connected = 0**.
- `run_pr_review` present = **false**; `post_pr_comment` present = **false**.
- Server starts (does not exit) and registers only the 9 local tools.

## 4. Env-backed mode verification (`CONCLAVE_USER_KEY` set)
- connected = **9** (all existing connected tools preserved).
- `post_pr_comment` with `enablePostComment:false` → **absent**.
- `post_pr_comment` with `enablePostComment:true` → **present**; total **19**
  (9 basic + 9 connected + 1 gated) — exactly +1 vs the Stage 142 surface.

## 5. Safety and confirmation boundary
- Basic tools need **no `CONCLAVE_USER_KEY`**, make **no central-plane call**, run
  **no AI/LLM**, **mutate nothing**, and **trigger no payment** (handler audit:
  `requiresPayment:false`, `mutatesState:false`).
- Handoff link: `handoff.boundary.createsPersistence:false`,
  `requiresPayment:false`, `assumesPaymentProvider:false` — no data persisted, no
  account/session created, no payment. Sensitive-looking fields omitted + warned.
- `post_pr_comment` stays gated behind `enablePostComment` **and** `confirm:true`
  (unchanged); `run_pr_review` stays execution-like (may consume 1 review credit).

## 6. Local smoke results
`pnpm --filter @conclave-ai/mcp-workspace smoke:basic` exits **0**:
`mode: basic_only`, `tools: 9`, `preview_acceptance_map: ok`,
`create_web_app_handoff_link: ok`, `network: not required`,
`credentials: not required`. Secret-free output.

## 7. Test / build / typecheck results
- mcp-workspace tests **68/68** ✓ · typecheck ✓ · build ✓.
- workspace-preview tests **186/186** ✓ · typecheck ✓.
- monorepo typecheck **57/57** ✓.
- Dashboard verification **skipped — justified**: no `apps/dashboard` files changed in
  this train (141~147 touch only `packages/mcp-workspace/*` + docs), and
  `@conclave-ai/workspace-preview` was **not modified** in this train, so the
  dashboard's re-export wrappers are unaffected (last verified 218/218).

## 8. Pack dry-run results (`npm pack --dry-run`, no publish)
- **workspace-preview:** `private:true`, `0.0.0`, **39 files** (src + types +
  `package.json`).
- **mcp-workspace:** `0.8.2` (unchanged), **25 files**, all 4 required runtime files
  present (`dist/index.js`, `dist/server.js`, `dist/mcp-basic-preview-tools.mjs`,
  `dist/mcp-basic-tools.mjs`); `scripts/` + `test/` not packaged.
- No `.tgz` artifact created/left behind.

## 9. README / docs accuracy
README states: not published · use local build/path · Basic-only works without
credentials · connected tools need env · publish requires Bae approval. It does **not**
claim registry-installability today, does **not** require `CONCLAVE_USER_KEY` for
Basic-only, and does **not** claim Basic tools call servers / run AI / trigger payment
/ save data.

## 10. Secret / sensitive scan (diff `main...HEAD`)
- **No real secrets.** The only `sk-…` matches are (a) the synthetic test fixture
  `{ title: "sk-ABCDEFGHIJKLMNOP" }` that verifies the handoff tool **omits** sensitive
  values, and (b) doc lines describing the scan itself. The fixture is fake and
  `test/` is **not packaged**.
- **No implementation hooks:** no `child_process`/`spawn`, no Stripe SDK/`new Stripe`,
  no `process.env.STRIPE|OPENAI|ANTHROPIC` in added lines.

## 11. What is intentionally not implemented
No MCP publish / npm publish / version bump (workspace-preview private/0.0.0;
mcp-workspace 0.8.2 unpublished). No payment/billing, no Stripe or any
payment-provider assumption (provider **TBD**, Korea-compatible first). No hosted
execution, no central-plane endpoint/change, no DB migration, no deploy, no
auth/login/session, no server-side handoff storage, no domain/DNS, no token/secret
output. No full external stdio-host automated test (manual host QA is the next train).

## 12. Merge readiness
**PR #151 is ready to merge** (pending Bae approval). State **OPEN**, **MERGEABLE**,
CI green (`typecheck-build (20)` + `(22)` both SUCCESS), HEAD `cd1074f`. PR description
covers Stage 141~147.

## 13. Publish decision
**Do not publish MCP now.** Keep `@conclave-ai/workspace-preview` private and
`@conclave-ai/mcp-workspace` unpublished. Publication/versioning/distribution require a
separate Bae-approved release (after manual host QA).

## 14. Required conclusions
- PR #151 is **ready** for merge (after Bae approval).
- MCP package **should NOT** be published now.
- Dashboard deploy is **NOT** required.
- Central-plane deploy is **NOT** required.
- Migration is **NOT** required.

## 15. Recommendation — **Option A: Ready to merge PR #151 after Bae approval**
Post-merge: **no deploy**, **no MCP publish**, **no npm publish**, **no central-plane
deploy**, **no migration**. (The merge is code-internal: it registers local tools and
relaxes the no-userKey startup to Basic-only; no runtime surface that production
depends on changes, and the dashboard output is unaffected.)

## 16. Recommended next train
**MCP Manual Host QA / Private Dogfood Train** (default) — wire the built server into a
real MCP host (Claude Desktop / Cursor / Windsurf) via the local absolute-path config,
manually exercise the 9 Basic tools + handoff, and dogfood before any publish.
Alternatives: **Auth/Workspace + Korea-compatible Payment Planning Train**;
**Outcome Persistence Train**.
