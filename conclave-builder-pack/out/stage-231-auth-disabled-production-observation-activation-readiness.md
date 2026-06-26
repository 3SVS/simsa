# Stage 231 — Auth-Disabled Production Observation / Activation Readiness Gate

Date: 2026-06-26 · Type: observation + readiness memo only. **No deploy / env / secret / D1 / activation change.**

## 1. Approval phrase observed
`"Auth-disabled production observation and activation readiness approved."` — present (direct). Authorizes
read-only observation + a readiness memo ONLY. Does NOT authorize `AUTH_ENABLED` activation, env/secret
change, central-plane/dashboard deploy, Vercel rewrite, CORS, DNS, OAuth, production D1 mutation, successful
sign-up/sign-in, payment, or MCP/npm publish. Only read-only HTTP + read-only D1 SELECT + value-free secret
metadata were run.

## 2. Branch / HEAD
- main `043331b` (Stage 227); HEAD == origin/main; worktree clean. No deploy/env/secret/D1 change since Stage 230.

## 3. Current production state
- central-plane Worker serves main `043331b` (Stage 230 deploy); `AUTH_ENABLED` unset; `BETTER_AUTH_SECRET`
  provisioned (dormant); topology env unset; production D1 has 0047 (dormant, 0 auth rows); dashboard
  (`app.trysimsa.com`, Vercel) NOT redeployed (prior build).

## 4. Production deployment identity (read-only)
- Latest `deploy-central-plane.yml` run = **28226196653** (success, headSha `043331b`, 2026-06-26 08:19Z) —
  the Stage 230 deploy. The prior run (28036199100, `635418f`, 2026-06-23) is older → no newer deploy
  superseded Stage 230.
- `GET /health` → 200 `{"ok":true,"service":"conclave-central-plane","version":"0.13.15","environment":"production"}`.

## 5. HTTP observation results (worker host `https://conclave-ai.seunghunbae.workers.dev`, 3 rounds)
| Check | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `GET /health` | 200 ok | 200 ok | 200 ok |
| `GET /api/auth/ok` | 503 `auth_disabled` | 503 `auth_disabled` | 503 `auth_disabled` |
| `POST /api/auth/sign-up/email` | 503 `auth_disabled` | 503 `auth_disabled` | 503 `auth_disabled` |
- No 2xx on any auth endpoint. No successful sign-up/sign-in, no session creation, no cookie/session path.
  Consistent across all 3 rounds.

## 6. Dashboard boundary check (read-only; no Vercel change)
- `GET https://app.trysimsa.com/` → 307 (normal redirect; dashboard reachable).
- `GET https://app.trysimsa.com/api/auth/ok` → **404** (Next.js HTML). There is NO same-origin auth route
  on the dashboard (no rewrite). The central-plane `503 auth_disabled` exists ONLY at the worker host →
  correct boundary. Dashboard not deployed; behavior unchanged.

## 7. Read-only D1 dormancy verification
- auth objects = **7** (`user`, `session`, `account`, `verification` + `idx_account_userId`,
  `idx_session_userId`, `idx_verification_identifier`).
- row counts: `user`=0, `session`=0, `account`=0, `verification`=0. No rows written by the deploy or the
  503 probes. Dormant.

## 8. Env / secret metadata check (value-free)
- `BETTER_AUTH_SECRET` present in Worker secrets. `AUTH_ENABLED` / `BETTER_AUTH_BASE_URL` /
  `BETTER_AUTH_TRUSTED_ORIGINS` are NOT secrets and NOT in `wrangler.toml [vars]` → unset in production.
  No OAuth env configured for this flow. No secret value revealed; nothing rotated/set.

## 9. Activation readiness matrix
**Already complete:**
- Production D1 auth schema applied + verified (Stage 224).
- `BETTER_AUTH_SECRET` provisioned (Stage 226).
- central-plane auth code deployed (Stage 230, main `043331b`).
- Auth-disabled behavior verified (503 `auth_disabled`, 3 rounds).
- Route gating verified (unit + smoke + production HTTP).
- D1 dormancy verified (0 auth rows).

**Still required before product-facing activation:**
- Same-origin rewrite vs subdomain decision (preferred: same-origin Vercel rewrite — Stage 225/227 docs).
- `BETTER_AUTH_BASE_URL` value decision (e.g. `https://app.trysimsa.com` once rewrite exists).
- `BETTER_AUTH_TRUSTED_ORIGINS` value decision.
- Post-rewrite disabled verification (`app.trysimsa.com/api/auth/ok` → 503 `auth_disabled` via rewrite,
  BEFORE activation).
- Activation rollback plan (unset `AUTH_ENABLED` → instant 503).
- Production smoke plan (sign-up/sign-in round-trip + session cookie on the user-facing origin).
- Clear distinction between technical activation (Worker host) and product-facing auth release (dashboard origin).

**Activation remains BLOCKED unless:** Bae explicitly approves `"Production auth activation approved."`;
`AUTH_ENABLED=true` is the ONLY activation change in that stage; topology/baseURL/trustedOrigins already
correct; same-origin (or subdomain) path verified; D1 row-count + rollback plan ready; no dashboard ambiguity.

## 10. Topology recommendation
**Path A (preferred) — Stage 232: Same-Origin Auth Rewrite Readiness / Implementation Gate.**
Route `app.trysimsa.com/api/auth/*` → central-plane Worker so cookies are first-party; keep `AUTH_ENABLED`
unset; rewrite + deploy separately approved; verify `app.trysimsa.com/api/auth/ok` → 503 `auth_disabled`
through the rewrite BEFORE any activation. Path B (Worker-only technical activation) is NOT recommended as
product-facing auth and must not be confused with a dashboard auth launch. Repo findings (no `vercel.json`,
no rewrite, cross-origin today) support Path A as feasible and preferred.

## 11. Risks / holds
| Risk | Mitigation |
|---|---|
| Activation before topology ready | Activation is its own last gate; rewrite + topology env precede it. |
| app.trysimsa.com ↔ Worker host session/cookie mismatch | Same-origin rewrite (Path A) makes cookies first-party. |
| `trustedOrigins`/`baseURL` unset during activation | Set + verify them in the rewrite stage before flipping `AUTH_ENABLED`. |
| Cross-origin cookies failing silently | Avoid by same-origin; never activate on the cross-site path. |
| Dashboard not wired to auth route | Expected today (404); the rewrite wires it; do not activate until wired+verified. |
| Env drift → non-503 behavior | 3-round observation asserts 503; re-check pre-activation; halt on any 2xx. |
| Accidental user/session rows before activation | D1 row-count monitored = 0; any nonzero pre-activation → investigate. |
| OAuth added too early | Not configured; out of scope until a dedicated track. |
| Confusing central-plane vs dashboard deploy | Documented: auth code is the Worker; dashboard deploy is separate. |
| Rollback depending on env vs code | Activation rollback = unset `AUTH_ENABLED` (env, instant); code rollback = `wrangler rollback`. |

## 12. M&A / enterprise readiness note
Evidence that Simsa ships sensitive auth infrastructure without activating it: schema, secret, and code
were shipped in independent approved steps; production behavior is observably dormant (503 + zero auth rows,
3 rounds); deployment is fully decoupled from activation; activation prerequisites are enumerated and gated.
Auditable, reversible, zero live-behavior change.

## 13. Explicit non-actions (NONE performed)
No `AUTH_ENABLED` activation, no env/secret change or rotation, no central-plane/dashboard deploy, no Vercel
rewrite, no CORS prod change, no DNS/domain, no OAuth, no production D1 mutation/write, no successful
sign-up/sign-in, no payment/billing, no MCP/npm publish, no live dashboard behavior change, no code change
on main, no dogfood PR #121~130 change.

## 14. Recommended next stage
**Stage 232 — Same-Origin Auth Rewrite Readiness / Implementation Gate** (Path A). Suggested approval phrase:
`"Auth same-origin rewrite readiness approved."` Production auth activation remains separate:
`"Production auth activation approved."`
