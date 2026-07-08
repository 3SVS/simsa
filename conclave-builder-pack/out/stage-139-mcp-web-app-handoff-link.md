> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 139 — MCP Web App Handoff Link

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).

## Goal
Add a safe Web App **handoff link builder** so MCP Basic can send a user from an
agent host back to the Simsa Web App with **safe context only** — no raw private
content, no secrets, no persistence, no payment, no provider assumption.

## Safe-context policy
The link is a **pure URL** — it does not save anything, create an account, trigger
payment, assume a payment provider, or execute tools. It never throws: invalid or
sensitive input is sanitized/omitted rather than rejected.

## Helper — `packages/workspace-preview/src/web-app-handoff-link.mjs` (+ `.d.mts`)
`buildWebAppHandoffLink(input?): WebAppHandoffLink` — pure, deterministic.
Default base `https://app.trysimsa.com`, default path `/projects/new/intake`.
Returns `{ url, path, query, omittedFields, warnings, boundary }`.

### Allowed query params (safe)
`source`, `intent`, `type`, `preview`, `previewId`, `title`, `summary`,
`utm_source`, `utm_medium`, `utm_campaign`. Keys are **deterministically ordered**
and URL-encoded.

### Sanitization rules
- `intent` allowlist (`new_intake`/`save_workflow`/`open_history`/`unlock_advanced`/
  `manage_team`/`review_preview`) → unknown falls back to `new_intake`.
- `source` allowlist → unknown falls back to `mcp_basic`.
- `intakeType` only included when a known type; unknown → omitted + warning.
- `title` truncated to 80, `summary` to 240; control characters stripped.
- **Sensitive omission:** values matching obvious secret/token patterns
  (`sk-`, `ghp_`, `github_pat_`, `vercel_`, `xox*`, `BEGIN … PRIVATE KEY`,
  `password=` / `token=` / `secret=` / `api_key=`, `authorization:`,
  `bearer …`, `AKIA…`) are **omitted**, with the field name added to
  `omittedFields` and a warning. **No throw.**
- Invalid `baseUrl` (non-URL or non-http(s)) → falls back to the default + warning;
  a valid https base uses **host only** (path is fixed).

### Boundary (always)
`containsRawPrivateContent:false`, `containsSecrets:false`,
`createsPersistence:false`, `requiresPayment:false`, `assumesPaymentProvider:false`.

## MCP wrapper — `createWebAppHandoffLink(input?)`
Returns `{ ok:true, kind:"web_app_handoff_link", handoff, …boundary }` where
`handoff` is the builder output (preserving `omittedFields` + `warnings`). Forces
`source:"mcp_basic"`. Wrapper boundary: `mutatesState:false`,
`usesHostedExecution:false`, `requiresPayment:false`, `derivedPreviewOnly:true`.
**No server runtime wiring** — wrapper-level only.

## What it does NOT do
No login/auth/session · no saved workflow persistence · no server-side handoff
storage · no payment/billing · no Stripe/payment-provider logic · no central-plane
endpoint · no migration · no MCP publish · no hosted execution · no tool execution.

## Verification
- `@conclave-ai/workspace-preview`: **186/186** tests (+11 handoff: default link,
  safe params, deterministic ordering, truncation, control-char strip, secret/
  token omission + warnings, intent/source/intakeType fallbacks, invalid baseUrl
  fallback, no-throw on malformed, no Stripe/payment, no persistence), typecheck
  clean.
- `@conclave-ai/mcp-workspace`: **45/45** tests (+4 handoff wrapper: ok/kind/
  handoff/boundary, safe default, sensitive omission, no Stripe/payment), typecheck
  clean.
- `apps/dashboard`: **218/218** (unchanged), typecheck clean, build green
  (`/projects/new/intake` 30 kB), lint = pre-existing `export/page.tsx` warning.
- Monorepo `turbo run typecheck`: **57/57**.

The MCP Basic wrapper module now covers **all 9** registry tools (8 previews +
handoff link).

## Next stage
Stage 140 — MCP Basic Checkpoint (`npm pack` dry-run only; no publish without
explicit Bae approval).
