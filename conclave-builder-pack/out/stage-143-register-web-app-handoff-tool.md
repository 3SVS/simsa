> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 143 — Register Web App Handoff Tool

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (Stage 141~147 train, PR #151) · **Base:** `main` @ `e3d6fa4`
**Type:** runtime wiring (MCP server). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth/session, no token/secret output.**

## 1. Goal
Register the final free MCP Basic tool — `create_web_app_handoff_link` — in the MCP
server runtime, using the existing pure wrapper `createWebAppHandoffLink`. Stage 142
registered the 8 preview tools; this completes the 9-tool free Basic surface. The
tool stays local · deterministic · safe-context only · env-less · no central-plane ·
no mutation · no persistence · no auth/session · no payment · no payment-provider
assumption · no hosted execution.

## 2. Tool registered
`create_web_app_handoff_link` → wraps `createWebAppHandoffLink(args)` (from
`mcp-basic-preview-tools.mjs`, which calls the shared
`@conclave-ai/workspace-preview` `buildWebAppHandoffLink`).

## 3. Schema (Zod)
```ts
{
  intent: z.string().optional(),
  intakeType: z.string().optional(),
  title: z.string().optional(),
  safeSummary: z.string().optional(),
  previewKind: z.string().optional(),
  previewId: z.string().optional(),
  baseUrl: z.string().optional(),
}
```
The wrapper allowlists/validates every field and omits anything sensitive, so any
input shape yields a safe link (never throws).

## 4. Basic-only behavior (no `CONCLAVE_USER_KEY`)
- **9** Basic tools registered (8 preview + `create_web_app_handoff_link`).
- No connected/network tools, no `run_pr_review`, no `post_pr_comment`.

## 5. Env-backed behavior (`CONCLAVE_USER_KEY` present)
- 9 Basic tools + the existing connected tools, registered exactly as before.
- `run_pr_review` stays the existing execution-like tool; `post_pr_comment` stays
  gated behind `enablePostComment` + `confirm:true`. **No connected/gated tool
  behavior changed.** Total registered count is exactly **+1** vs Stage 142
  (19 with `enablePostComment` on: 9 basic + 9 connected + 1 gated).

## 6. Response & boundary
Response (via the shared `text()` envelope) preserves:
`{ ok:true, kind:"web_app_handoff_link", handoff, mutatesState:false,
usesHostedExecution:false, requiresPayment:false, derivedPreviewOnly:true }`.
The nested `handoff.boundary` preserves `containsRawPrivateContent:false,
containsSecrets:false, createsPersistence:false, requiresPayment:false,
assumesPaymentProvider:false`. No Stripe/payment-provider string appears in the URL
or handoff payload (only safe boolean boundary fields like `requiresPayment:false`).

## 7. Sensitive-field omission
Free-text fields (`title`, `safeSummary`, `previewId`) matching obvious
secret/token patterns (sk-/ghp_/github_pat_/vercel_/xox*/BEGIN PRIVATE KEY/
password=/token=/secret=/api_key=/authorization:/bearer/AKIA) are **omitted** from
the URL, recorded in `handoff.omittedFields`, and surfaced in `handoff.warnings`.
Control chars are stripped; `title`/`summary` are truncated (80/240). Unknown
`intent`/`source`/`intakeType` fall back to safe defaults; an invalid `baseUrl`
falls back to `https://app.trysimsa.com` with a warning.

## 8. Safety boundary preserved
The registered handler calls only the pure wrapper — no network, no central-plane,
no `process.env`, no record mutation, no file write, no LLM, no payment provider, no
account/login/session creation, no server-side handoff persistence, no agent
execution, no PR-comment posting.

## 9. Tests (`test/server-basic-mode.test.mjs`)
Updated counts to 9 Basic tools and added handoff coverage:
- Basic-only registers exactly 9 Basic tools incl. `create_web_app_handoff_link`;
  connected / `run_pr_review` / `post_pr_comment` absent.
- Env-backed registers Basic + connected; total = 9 + 9 (+1 gated when enabled).
- `BASIC_TOOL_META` has 9 entries; the 8 preview tools say "preview only"; the
  handoff description states safe/non-mutating + sensitive-field omission; none
  claims "through Conclave's API".
- Handoff dispatch returns `ok/kind/handoff/boundary`; missing input → default
  `app.trysimsa.com` link; sensitive title/summary/previewId omitted + warnings;
  no throw on malformed args; no Stripe/payment/userKey/token string in the payload.

**Results:** mcp-workspace **64/64** (was 58; +6), workspace-preview **186/186**,
`@conclave-ai/mcp-workspace` typecheck ✓, monorepo typecheck **57/57** ✓. Runtime
smoke: basic-only = 9 tools (handoff present), env-backed = 19, handoff dispatch
returns `https://app.trysimsa.com/projects/new/intake?…` with `requiresPayment:false`
and `assumesPaymentProvider:false`. Dashboard unaffected (shared exports unchanged).

## 10. What remains not implemented (by design)
No `npm publish` / MCP publish / version bump (`@conclave-ai/workspace-preview`
private; `@conclave-ai/mcp-workspace` stays `0.8.2`, unpublished). No payment work,
no Stripe/payment-provider assumption (provider **TBD**, Korea-compatible first). No
hosted execution, no central-plane, no migration, no deploy, no auth/login/session,
no server-side handoff storage, no domain/DNS, no token/secret output.

## 11. Next stage
**Stage 144 — MCP Basic Local Smoke Harness** (scripted stdio: list tools, call one
preview tool + the handoff tool, assert boundary; local only, no central-plane, no
credentials). **Do not merge PR #151** until the Stage 147 checkpoint + Bae approval.
