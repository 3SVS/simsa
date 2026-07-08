> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 145 — MCP Basic Docs / Installation Guide

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (Stage 141~147 train, PR #151) · **Base:** `main` @ `e3d6fa4`
**Type:** documentation only. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Docs updated
- **`packages/mcp-workspace/README.md`** — reworked to lead with the dual nature
  (free local **MCP Basic** + env-backed **connected mode**) and corrected stale
  claims (it no longer implies `npm i -g` works today, and `CONCLAVE_USER_KEY` is now
  documented as **optional** → Basic-only mode when unset). New/required sections:
  `## Simsa MCP Basic`, `What Basic tools do`, `What Basic tools do not do`,
  `Local quick start`, `Basic-only mode, no credentials`, `Env-backed connected mode`,
  `Tool list` (9 Basic tools: purpose · minimal input · output shape · boundary),
  `Manual MCP host configuration`, `Smoke test`, `Safety and data handling`,
  `Publish status`, `Troubleshooting`. The connected-mode config examples, billing
  semantics, and safety model are preserved.
- No separate `docs/` file was added — the package has no `docs/` dir and the README
  covers the guide in one place (avoids duplication).

## 2. Local quick start
```bash
pnpm install
pnpm --filter @conclave-ai/mcp-workspace build
pnpm --filter @conclave-ai/mcp-workspace smoke:basic
```
Documents the safe, secret-free smoke output (`mode: basic_only`, `tools: 9`,
`preview_acceptance_map: ok`, `create_web_app_handoff_link: ok`, `network: not
required`, `credentials: not required`).

## 3. Manual MCP host configuration
A generic, host-agnostic example using a **local absolute path** to the built
`dist/index.js` with empty `env` (Basic-only). Notes: build first, use an absolute
path, keep `env` empty for Basic-only, add `CONCLAVE_USER_KEY` only to enable
connected tools, and that the config file location differs by host (Claude Desktop or
another MCP host gets an equivalent entry). The README does **not** claim the package
is npm-installable today.

## 4. Basic-only vs connected mode
- **Basic-only** (no `CONCLAVE_USER_KEY`): 9 Basic local tools, no credentials, no
  network, no connected tools, no `run_pr_review`, no `post_pr_comment`.
- **Connected** (`CONCLAVE_USER_KEY` set): Basic tools remain + connected tools call
  the Simsa/Conclave API; `run_pr_review` may consume **1 review credit**;
  `post_pr_comment` stays disabled unless explicitly enabled + `confirm:true`. Docs
  use placeholders only (`your_user_key_here` / `uk_...`) — no real keys.

## 5. Safety / data handling
Deterministic local transformations; user input not stored; no raw private code to
Simsa servers in Basic-only mode; no LLM call; **no payment provider used or
assumed**; handoff links carry only safe query context and omit sensitive-looking
fields. Includes the disclaimer that MCP Basic does not guarantee software is
bug-free/secure/compliant/production-ready and that final decisions remain with the
user/team.

## 6. Publish status (documented)
Package **not currently published**; do not run `npm publish`; Stage 145 is docs only;
publication/versioning/distribution require **separate Bae approval**.
`@conclave-ai/mcp-workspace` stays `0.8.2`, unpublished.

## 7. Verification
Markdown-only change (plus the docs checkpoint). Re-ran the suite to confirm nothing
regressed and the README packaging tests still pass:
- `smoke:basic` exits `0`.
- mcp-workspace **68/68**, workspace-preview **186/186**, mcp-workspace typecheck ✓,
  monorepo typecheck **57/57** ✓. The existing README packaging tests (require-key /
  billing line / "Never paste raw GitHub tokens" / both config examples / no GitHub
  token) still pass against the rewritten README. Dashboard unaffected.

## 8. What remains not published
No `npm publish` / MCP publish / version bump. No payment/Stripe/payment-provider
assumption (provider **TBD**, Korea-compatible first). No hosted execution, no
central-plane, no migration, no deploy, no auth/login/session, no token/secret output.

## 9. Next stage
**Stage 146 — Package Contents / Pack-only Checkpoint** (`npm pack --dry-run` to
audit what would ship — files, no secrets, dist present — **without** publishing).
**Do not merge PR #151** until the Stage 147 checkpoint + Bae approval.
