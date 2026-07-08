> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 94 — simsa.dev Developer Docs Surface

**Date:** 2026-06-23
**Branch:** `feat/stage-94-simsa-dev`
**Scope:** Minimal developer/docs placeholder for `simsa.dev`. Code PR only (94A) — Vercel project + domain + deploy are post-merge, gated (94B).

## Implementation
Mirrors the Stage 93 pattern: a new standalone static Next app `apps/simsa-dev` → its own Vercel project `simsa-dev` → `simsa.dev` (post-merge). The dashboard, landing, central-plane, and internal `@conclave-ai/*` namespace are all **untouched**.

## Files (new app — `apps/simsa-dev/`)
- `package.json` (`@conclave-ai/simsa-dev`, private, next 15.5.16 / react 19.2.6, plain CSS — no Tailwind/Google fonts)
- `tsconfig.json`, `.eslintrc.json`, `next.config.mjs`, `.gitignore`, `vercel.json`
- `src/app/layout.tsx` — metadata `Simsa for Developers`
- `src/app/page.tsx` — placeholder dev surface
- `src/app/globals.css` — same Linear-minimal neutral + deep-green (`#15803d`) system as the landing, no emoji
- `pnpm-lock.yaml` updated (new package)

## Content (deliberately a placeholder — no overpromising)
```
Simsa for Developers
Developer docs are coming soon.
Simsa helps teams review, compare, and accept AI-built software with evidence.
[ Open Simsa ]  → https://app.trysimsa.com
[ View on GitHub ] → https://github.com/3SVS/conclave-ai   (repo is PUBLIC — verified)
MCP package — coming soon   (plain text; @conclave-ai/mcp-workspace is NOT yet on npm — no link)
Built for AI-built software acceptance.
```
- No API/SDK/MCP docs promised. The "coming soon" item is plain muted text, not a broken link.
- GitHub link verified public (`gh repo view 3SVS/conclave-ai` → PUBLIC). The repo keeps the frozen internal `conclave-ai` name.

## Local verification
- `apps/simsa-dev` build **green** (`/` static prerender), typecheck clean, lint **no warnings/errors**.
- No host-aware routing → no routing tests. Dashboard / landing / central-plane untouched.

## Deploy / domain — NOT performed in PR stage
No Vercel project created, no `simsa.dev` assigned, no DNS change, no deploy in this PR.

## Post-merge plan (94B, after merge + explicit approval)
1. Create Vercel project `simsa-dev` (root directory = `apps/simsa-dev`); deploy via CLI from `apps/simsa-dev` (standalone, like the landing).
2. Assign `simsa.dev` to the **new** project (do not attach to dashboard or landing projects).
3. Smoke: `simsa.dev` → 200/TLS/`Simsa for Developers`, CTA → app.trysimsa.com, no Conclave public copy, no broken docs link; `trysimsa.com` still landing; `app.trysimsa.com` still dashboard.

## Rollback
- If broken: remove `simsa.dev` from the `simsa-dev` project; `trysimsa.com` + `app.trysimsa.com` untouched.
- No DB / migration → nothing to roll back server-side.

## Not changed (frozen)
`@conclave-ai/*` package names · MCP package name · `CONCLAVE_*` env · DB/routes/internal namespace · central-plane (no deploy) · GitHub App · Telegram bot · generated links · billing. No npm publish.
