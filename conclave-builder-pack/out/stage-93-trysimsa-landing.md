> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 93 — trysimsa.com Apex Landing

**Date:** 2026-06-22
**Branch:** `feat/stage-93-trysimsa-landing`
**Scope:** Minimal public entry surface for `trysimsa.com`. Code PR only — domain assignment + deploy are post-merge, gated.

## Implementation path chosen
**Separate minimal landing project** (Bae's choice). A new tiny static Next app `apps/simsa-landing` → its own Vercel project → `trysimsa.com` assigned there.

Why not the alternatives:
- **Same dashboard project**: the dashboard root layout wraps *every* page in the app chrome (sidebar + i18n), so a clean apex landing would require either moving all routes into a `(dashboard)` route group or forcing global dynamic rendering via `headers()` — a non-trivial refactor of the production dashboard. Rejected for risk.
- **Reuse `apps/landing`**: that app is Conclave-branded + a full marketing site (hero/pricing/screenshots); rebranding is out of this stage's minimal scope.
- **Redirect-only**: safe but Bae prefers a real entry page over forcing visitors into the dashboard.

The separate project keeps the dashboard **completely untouched** (zero regression risk) and cleanly separates the marketing domain from the app domain.

## Files (new app — `apps/simsa-landing/`)
- `package.json` (`@conclave-ai/simsa-landing`, private, next 15.5.16 / react 19.2.6 — same versions as `apps/landing`, no Tailwind/postcss — plain CSS)
- `tsconfig.json`, `.eslintrc.json` (`next/core-web-vitals`), `next.config.mjs`, `.gitignore`, `vercel.json` (`framework: nextjs`)
- `src/app/layout.tsx` — metadata = Simsa title/description, no dashboard chrome
- `src/app/page.tsx` — wordmark **Simsa** · tagline · one-sentence explanation · **Open Simsa** CTA → `https://app.trysimsa.com` · small footer
- `src/app/globals.css` — Linear-minimal, neutral (`#faf8f3` bg, zinc text), deep-green accent `#15803d` (dashboard brand-600), centered, **no emoji, no violet**, system font stack (no Google-font fetch → builds anywhere)
- `pnpm-lock.yaml` updated (new package registered; CI `--frozen-lockfile`)

## Copy
```
Simsa
The acceptance layer for AI-built software.
Review, compare, and accept AI-built software with evidence.
[ Open Simsa ]   → https://app.trysimsa.com
Built for AI-built software acceptance.
```

## Tests / verification (local)
- `apps/simsa-landing` build **green** (`/` static prerender), typecheck clean, lint **no warnings/errors**.
- No host-aware routing implemented (separate project) → no routing tests needed.
- Dashboard / central-plane untouched → their suites unaffected.

## Deploy / domain changes performed
**None in this PR.** No Vercel project created, no domain assigned, no DNS change, no deploy.

## Post-merge plan (after merge + explicit Bae approval)
1. Create a new Vercel project from `apps/simsa-landing` (root directory = `apps/simsa-landing`), deploy via CLI.
2. Assign `trysimsa.com` (apex) to the **new** project (move the apex domain off any default; `app.trysimsa.com` stays on the dashboard project — untouched).
3. Smoke: `https://trysimsa.com` → 200, TLS valid, shows Simsa entry (not dashboard); `https://app.trysimsa.com` still dashboard; `https://conclave-dashboard.vercel.app` still dashboard.

## Risks / rollback
- `app.trysimsa.com` is on the dashboard project and is **not modified** by this stage → no risk to the live app.
- If the landing project misbehaves: unassign `trysimsa.com` from it (apex falls back to unconfigured/registrar) or point it elsewhere; the dashboard + app domain are unaffected.
- No DB / no migration → nothing to roll back server-side.

## Statuses
- `trysimsa.com`: code ready; **not yet assigned/deployed** (post-merge).
- `app.trysimsa.com`: dashboard live (unchanged).
- legacy `conclave-dashboard.vercel.app`: dashboard fallback (unchanged).

## Recommendation for simsa.dev
Defer to a later stage. Options once addressed: redirect `simsa.dev` → `app.trysimsa.com` (or a future docs site), or a dedicated developer/docs surface. Do **not** point it at production until intended. Out of Stage 93 scope.
