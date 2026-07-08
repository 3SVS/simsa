> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 146 — Package Contents / Pack-only Checkpoint

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (Stage 141~147 train, PR #151) · **Base:** `main` @ `e3d6fa4`
**Type:** pack-only checkpoint (no code change). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Verify the MCP Basic package contents are intentional and safe — required `dist`
runtime files present, Basic `.mjs` wrappers copied into `dist`, README accurate, and
**no secrets/tokens/raw private data** packaged — using `npm pack --dry-run` only. No
publish.

## 2. Verification results
- `pnpm --filter @conclave-ai/mcp-workspace build` ✓ (copy-basic-tools copied 4 files)
- `smoke:basic` exits **0** (`mode: basic_only`, `tools: 9`, network/credentials not required)
- mcp-workspace tests **68/68** ✓ · typecheck ✓
- workspace-preview tests **186/186** ✓ · typecheck ✓
- monorepo typecheck **57/57** ✓

## 3. workspace-preview pack dry-run
| Field | Value |
|-------|-------|
| name | `@conclave-ai/workspace-preview` |
| version | `0.0.0` |
| private / published | **private: true** — not for publication |
| total files | **39** (38 `src/*.mjs` + `*.d.mts`, + `package.json`) |
| package size / unpacked | 42.0 kB / 166.8 kB |
| tests packaged | 0 |
| `.env` / secret / `.pem` / fixture | **none** |
| non-`src` files | only `package.json` |
| payment / hosted-execution impl | **none** |

Contents are exactly the deterministic preview source + types + metadata. Intentional.

## 4. mcp-workspace pack dry-run
| Field | Value |
|-------|-------|
| name | `@conclave-ai/mcp-workspace` |
| version | **`0.8.2`** (unchanged) |
| `files` allowlist | `["dist","src","README.md"]` |
| total files | **25** · size 30.2 kB · unpacked 129.4 kB |
| `dist/index.js` | present ✓ |
| `dist/server.js` | present ✓ |
| `dist/mcp-basic-preview-tools.mjs` | present ✓ |
| `dist/mcp-basic-tools.mjs` | present ✓ |
| `README.md` | present ✓ |
| `.env` / secret / `.pem` / fixture | **none** |
| `scripts/` packaged | **no** (smoke/copy scripts are dev-only, correctly excluded) |
| `test/` packaged | **0** |
| top-level | `README.md`, `dist`, `package.json`, `src` |
| payment / hosted-execution impl | **none** |

Version stays `0.8.2`, unpublished. The dist contains the runtime wrappers (copied by
`scripts/copy-basic-tools.mjs` at build), so `dist/server.js`'s `.mjs` imports resolve
for an installed consumer.

## 5. Required dist/runtime file audit
All runtime files an installed consumer needs are present in the tarball:
`dist/index.js` (bin), `dist/server.js`, `dist/client.js`, and the copied
`dist/mcp-basic-preview-tools.mjs` + `dist/mcp-basic-tools.mjs` (+ their `.d.mts`).
Dev-only `scripts/` (copy-basic-tools, smoke, smoke-basic) are **not** shipped, which
is correct — consumers use the prebuilt `dist`.

## 6. Secret/sensitive scan (diff `main...HEAD`)
- Real-secret patterns (`sk-…`/`ghp_`/`github_pat_`/`xoxb-`/BEGIN PRIVATE KEY/AKIA):
  the only hit is the **test fixture** `{ title: "sk-ABCDEFGHIJKLMNOP" }` in
  `test/server-basic-mode.test.mjs` — a synthetic placeholder used to assert the
  handoff tool **omits** sensitive-looking values. Not a real secret, and `test/` is
  **not packaged**.
- Implementation-hook patterns (`child_process`/`spawn`/Stripe SDK/`new Stripe`/
  `createCheckout`/`process.env.STRIPE|OPENAI|ANTHROPIC`): **none** in added lines.
- `requiresPayment:false` / "no payment" / "No secret" strings are expected boundary
  metadata and docs, not implementations.

## 7. README accuracy check
- **Does say:** package is **not currently published**; use local build/path for now;
  Basic-only mode works **without credentials**; connected tools require env; publish
  requires **separate Bae approval**.
- **Does NOT claim:** package is published / installable from the registry today (the
  global-binary line is gated on "once published"; the only `pnpm install` lines are
  local build/troubleshooting steps); `CONCLAVE_USER_KEY` required for Basic-only (it's
  documented optional; the only "required" mention is a troubleshooting note saying it
  is **no longer required**); Basic tools call Simsa servers / run AI / trigger
  payment / save data (README states they do none of these).

## 8. Publish boundary
`npm pack --dry-run` only — **no `npm publish`** was run. `@conclave-ai/workspace-preview`
stays `private`/`0.0.0`; `@conclave-ai/mcp-workspace` stays `0.8.2`, unpublished.
Publication/versioning/distribution require separate Bae approval (Stage 147).

## 9. Risks and mitigations
- **Accidental publish of a private helper** → `@conclave-ai/workspace-preview` is
  `private:true`; npm refuses to publish it. Mitigation holds.
- **Missing runtime `.mjs` in a published tarball** → covered: the build copy step
  puts them in `dist`, and the pack audit confirms all four runtime files ship.
- **Stale README claims after the Basic-only change** → reconciled in Stage 145 and
  re-verified here.
- **Lockstep versioning** → no per-package version bump was made; any future publish
  goes through the release workflow with Bae approval.

## 10. Stage 146 decision
**Option A — Pack contents ready for checkpoint.** Package contents are intentional
and safe for the Stage 147 checkpoint. **No publish should occur yet.**

## 11. Recommended next stage
**Stage 147 — MCP Server Runtime Wiring Checkpoint** (train summary + audit; merge /
publish decision for PR #151, pending Bae approval). **Do not merge PR #151** until
then.
