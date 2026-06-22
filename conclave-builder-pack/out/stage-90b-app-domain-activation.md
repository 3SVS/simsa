# Stage 90B — app.trysimsa.com Domain Activation (executed)

**Date:** 2026-06-22
**Scope:** Activate `app.trysimsa.com` as the dashboard production domain + deploy Stage 89 CORS allowlist to central-plane (manual, gated). No apex/simsa.dev routing, no generated-link switch, no migration.

## Result — all steps PASS
1. **Domains registered** (operator): `trysimsa.com` + `simsa.dev` purchased on the same Vercel account → Registrar = Vercel, **Nameservers = Vercel (auto-managed DNS)**.
2. **Custom domain added**: `vercel domains add app.trysimsa.com` (linked project `conclave-dashboard`; single-arg form — passing the project name is rejected by the CLI when a project is linked).
3. **DNS auto-managed + verified**: public resolvers (1.1.1.1, 8.8.8.8) resolve `app.trysimsa.com` to Vercel Edge; NS delegation confirmed (`ns1/ns2.vercel-dns.com √`); SSL cert issued (`cert_…` for `app.trysimsa.com`).
   - Note: edge cert propagation lagged a few minutes (initial TLS handshake failed on both schannel-curl and openssl = control-plane issued ≠ edge serving). Resolved after short propagation.
4. **Dashboard smoke**: `https://app.trysimsa.com` → **200**, valid TLS (`CN=app.trysimsa.com`), `<title>Simsa — The acceptance layer for AI-built software.</title>`. Legacy `https://conclave-dashboard.vercel.app` → **200** (fallback intact).
5. **central-plane manual deploy** (Actions → deploy-central-plane → Run workflow, `confirm=deploy`, `apply-migrations=false`): success. "Confirm deploy intent" skipped (guard passed), **"Apply D1 migrations" skipped (no migration ran)**, Deploy Worker + smoke success. → Stage 89 CORS allowlist now live.
6. **CORS smoke** (core, CORS-enabled endpoints): preflight from `https://app.trysimsa.com` → `204` + `Access-Control-Allow-Origin: https://app.trysimsa.com`; `GET /workspace/projects` actual response also echoes ACAO; `evil.com` not echoed; legacy `conclave-dashboard.vercel.app` + apex `trysimsa.com` allowed (exact match).
7. **OAuth returnTo smoke** (live): `app.trysimsa.com` → `302 → github.com` (accepted); `evil.com` → `400` (rejected); legacy → `302`. GitHub App callback is worker-based → no GitHub App change needed.

## ⚠️ Follow-up (pre-existing CORS gap — recommend Stage 91)
CORS is per-route-file (`corsHeaders` + `ALLOWED_ORIGINS`); there is **no global CORS middleware** (`router.ts` mounts each module). These route files have **no CORS headers at all** (every origin, not specific to app.trysimsa.com):
- `workspace-experiment.ts` (experiments, evolution-action-packs, evolution-learning/timeline, decision, benchmark-from-experiment)
- `workspace-benchmark.ts`
- `workspace-credits.ts`
- `workspace-admin-credits.ts`
- `workspace-admin-stats.ts`

Effect: browser-client (CORS-enforced) calls to those features are blocked **from any origin** (including the existing `conclave-dashboard.vercel.app`). curl / MCP / server-side calls are unaffected. **Stage 91**: add `corsHeaders` (same allowlist incl. `app.trysimsa.com`) to these files, with tests.

## Not done (per scope / prohibitions)
trysimsa.com apex routing ✗ · simsa.dev routing ✗ · generated-link footer switch ✗ (still `conclave-ai.dev`) · GitHub App / Telegram rename ✗ · D1 migration ✗ (skipped) · token/secret printed ✗.

## Rollback readiness
- Keep `conclave-dashboard.vercel.app` as fallback (untouched).
- If app.trysimsa.com breaks: `vercel domains rm app.trysimsa.com` (or remove from project) — DNS reverts; dashboard still on legacy URL.
- central-plane CORS deploy revert only if needed: re-dispatch deploy of the prior commit.
- No DB rollback (no migration ran).

## Remaining follow-ups
- Stage 91: CORS coverage for the 5 route files above.
- Later: generated-link transition (PR comment footer etc.) to the live Simsa domain.
- Later (separate, explicit): trysimsa.com apex (redirect vs landing) + simsa.dev docs.
