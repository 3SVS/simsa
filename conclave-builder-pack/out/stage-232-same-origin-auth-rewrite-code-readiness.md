# Stage 232 — Same-Origin Auth Rewrite Code Readiness

Date: 2026-06-26 · Branch `feat/stage-232-same-origin-auth-rewrite` · PR #171 (OPEN, not merged).
Code readiness only. **Not live until a dashboard deploy. No env / activation / deploy.**

## 1. Approval phrase observed
`"Auth same-origin rewrite readiness approved."` — present (direct). Authorizes a code-readiness PR for
same-origin auth routing ONLY, provided it does not affect live production without a later dashboard/Vercel
deploy. Does NOT authorize dashboard/central-plane deploy, `AUTH_ENABLED` activation, env/secret change,
Vercel rewrite production deploy, DNS, CORS prod, OAuth, production D1 mutation, payment, MCP/npm publish.

## 2. Branch / HEAD
- Base main `043331b`. Feature branch `feat/stage-232-same-origin-auth-rewrite`, pushed; PR #171 opened.
- Report committed to local checkpoint branch only (not pushed, not on main/PR).

## 3. Dashboard / Vercel routing findings (from repo, not assumption)
- `apps/dashboard/next.config.ts` was empty (`{}`), no `output: 'export'` → normal Next.js app → **rewrites
  supported**. No existing rewrites.
- No `vercel.json` anywhere. No GitHub Actions workflow deploys the dashboard (`review.yml` is the Conclave
  self-review workflow; its "vercel/dashboard" mentions are comments). Dashboard deploys manually via
  `vercel deploy --prod`. → **merging this PR does NOT auto-deploy** → non-live until a manual deploy.
- Dashboard has NO `/api/auth` route today (`app.trysimsa.com/api/auth/ok` → 404, Stage 231) → the scoped
  `/api/auth/:path*` rewrite shadows nothing.

## 4. Central-plane target findings
- Documented production Worker origin (existing dashboard convention): `https://conclave-ai.seunghunbae.workers.dev`
  (`NEXT_PUBLIC_CENTRAL_PLANE_URL` default in `src/lib/*-api.ts`). Used as the rewrite default.
- Destination is env-driven server-side: `CENTRAL_PLANE_AUTH_ORIGIN` (build/server only, NOT `NEXT_PUBLIC`
  → not client-exposed). No URL/secret value committed; the default already points at the production Worker.

## 5. Implementation rationale (Option A — safe)
- Routing surface is clear, env-driven and fail-safe, non-live on merge, and scoped — so a code-readiness PR
  is safe. `next.config.ts` reads the origin and emits one rewrite. Pure logic extracted to a testable
  server-side helper.

## 6. Files changed (PR #171 — 5 files, dashboard only)
- `next.config.ts` (M) — `async rewrites()` → `/api/auth/:path*` → `${origin}/api/auth/:path*`.
- `src/lib/auth-rewrite.mjs` (A) + `src/lib/auth-rewrite.d.mts` (A) — `resolveCentralPlaneAuthOrigin(env)`,
  `buildAuthRewrites(origin)`; fail-safe (missing/empty/non-http(s) → default), trailing-slash strip.
- `test/auth-rewrite.test.mjs` (A) — 5 tests.
- `docs/auth-same-origin-rewrite.md` (A) — behaviour, env, future deploy + disabled verification, gates.
No central-plane / `wrangler.toml` / migration / `.env` / secret change.

## 7. Rewrite behaviour expected after a FUTURE dashboard deploy (auth still disabled)
- `app.trysimsa.com/api/auth/ok` → `503 auth_disabled` (proxied to the Worker).
- `app.trysimsa.com/api/auth/sign-up/email` → `503 auth_disabled`.
- Worker direct `…workers.dev/api/auth/ok` → still `503 auth_disabled`.
- production D1 auth rows remain `0`; `AUTH_ENABLED` remains unset; dashboard loads normally.
- A same-origin rewrite deploy is NOT activation — it only exposes the disabled route on the first-party origin.

## 8. Tests / build / typecheck results
- `pnpm --filter @conclave-ai/dashboard build` → success (next.config rewrite validated).
- dashboard tests **259/259** (auth-rewrite **5/5**) · central-plane auth tests **38/38** · `pnpm typecheck`
  **57/57** · `pnpm verify` green · pre-push hook verify passed.

## 9. Future deploy + verification runbook (NOT executed)
- Future dashboard deploy requires `"Auth same-origin rewrite deploy approved."` → `vercel deploy --prod`
  (Root Dir `apps/dashboard`), optionally setting `CENTRAL_PLANE_AUTH_ORIGIN` (default already correct).
- Post-deploy disabled verification: the four checks in §7 (all 503 / 0 rows / unset / normal load).
- Production activation remains separate: `"Production auth activation approved."`

## 10. Post-deploy disabled verification plan
Same as §7 — assert `503 auth_disabled` through the first-party origin AND the Worker host, zero D1 auth
rows, `AUTH_ENABLED` unset, dashboard normal. Halt + roll back the dashboard deploy on any 2xx.

## 11. Risks / holds
| Risk | Mitigation |
|---|---|
| Wrong Worker origin | Env-driven with the documented production default; fail-safe fallback; tested. |
| Env missing → build/runtime failure | `resolveCentralPlaneAuthOrigin` never throws; default used; dashboard build passed without the env set. |
| `/api/auth/*` shadowing dashboard routes | No `/api/auth` handler exists; rewrite scoped to `/api/auth/:path*` only (tested). |
| Rewrite loops | Destination is the external Worker origin, not the dashboard itself → no loop. |
| CORS / session assumptions | Same-origin makes cookies first-party; nothing activated yet. |
| `baseURL`/`trustedOrigins` still unset | Set on the Worker before activation (separate gate); not needed for disabled proxy. |
| Rewrite deployed before disabled verification | Verification plan (§7/§10) runs immediately post-deploy, before any activation. |
| Activation before rewrite validation | Activation is a separate, later gate; do not bundle. |
| Dashboard deploy bundling unrelated changes | A future dashboard deploy ships the dashboard delta since its last build — review separately at deploy time. |
| Rollback path unclear | Rewrite rollback = redeploy dashboard without it / revert; activation rollback = unset `AUTH_ENABLED`. |

## 12. M&A / enterprise readiness note
First-party auth routing is now a safe, auditable, env-driven, test-covered config — added without bundling
deployment or activation, and provably non-live until an explicit dashboard deploy. Reinforces the
ship-while-disabled discipline.

## 13. Explicit non-actions (NONE performed)
No `AUTH_ENABLED` activation, no env/secret change, no dashboard/Vercel deploy, no central-plane deploy, no
production D1 mutation, no OAuth, no DNS/domain, no production Vercel rewrite deploy, no CORS prod change, no
live dashboard behavior change, no payment/billing, no MCP/npm publish, no dogfood PR #121~130 change.

## 14. Recommended next stage
**Stage 233 — PR Merge Gate for Stage 232**, only after `"PR #171 merge approved."` (still non-live).
Then: `"Auth same-origin rewrite deploy approved."` (dashboard deploy, disabled), and
`"Production auth activation approved."` (activation) — each separate.
