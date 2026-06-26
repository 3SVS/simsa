# Stage 237 — Production Auth Topology Env Provisioning Gate

Date: 2026-06-27 · Type: production Worker topology env provisioning (2 public-URL values).
**Auth remains disabled. No activation, no code deploy, no D1 mutation, no secret rotation.**

## 1. Approval phrase observed
`"Production auth topology env provisioning approved."` — present (direct, standalone). Authorizes
provisioning the two topology env values `BETTER_AUTH_BASE_URL=https://app.trysimsa.com` and
`BETTER_AUTH_TRUSTED_ORIGINS=https://app.trysimsa.com` ONLY. Does NOT authorize `AUTH_ENABLED` activation,
`BETTER_AUTH_SECRET` rotation, central-plane/dashboard deploy, production D1 mutation, OAuth, DNS, CORS prod,
successful sign-up/sign-in, payment, MCP/npm publish.

## 2. Branch / HEAD
- main `e8d42cc` (Stage 232); HEAD == origin/main; worktree clean. central-plane Worker remains `043331b`
  code (secret-put rebinds the existing script — no code deploy); Stage 235 dashboard rewrite remains live;
  `AUTH_ENABLED` unset; no D1 mutation since Stage 224; no code deploy since Stage 235.

## 3. Topology env provisioning result
- `BETTER_AUTH_BASE_URL` → "✨ Success! Uploaded secret" on Worker **conclave-ai** (production).
- `BETTER_AUTH_TRUSTED_ORIGINS` → "✨ Success! Uploaded secret" on Worker **conclave-ai**.
- Both values are public first-party origins (`https://app.trysimsa.com`), not private credentials → piped
  via stdin (the repo's documented `echo | wrangler secret put` pattern). NOT used for `BETTER_AUTH_SECRET`.

## 4. Pre-provision production baseline (read-only)
- `app.trysimsa.com/api/auth/ok` → 503 `auth_disabled`; `…/sign-up/email` → 503; Worker `/api/auth/ok` →
  503 `auth_disabled`; Worker `/health` → 200; `app.trysimsa.com/` → 307 (loads/redirects).

## 5. Pre-provision D1 dormancy
- auth objects = 7; user/session/account/verification = 0/0/0/0.

## 6. Pre-provision env/secret metadata (value-free)
- `BETTER_AUTH_SECRET` present. `AUTH_ENABLED` / `BETTER_AUTH_BASE_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`
  absent. OAuth unset.

## 7. Local verification results
- dashboard build pass · auth-rewrite tests 5/5 · central-plane build + auth tests (6 files) 38/38 ·
  `pnpm typecheck` 57/57 · `pnpm verify` green.

## 8. Provisioning commands used
```
printf "https://app.trysimsa.com\n" | pnpm --filter @conclave-ai/central-plane exec wrangler secret put BETTER_AUTH_BASE_URL
printf "https://app.trysimsa.com\n" | pnpm --filter @conclave-ai/central-plane exec wrangler secret put BETTER_AUTH_TRUSTED_ORIGINS
```

## 9. Post-provision metadata verification (value-free)
- Worker secrets now include `BETTER_AUTH_BASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_TRUSTED_ORIGINS`.
- `AUTH_ENABLED` secret count = **0** (not added). OAuth unset. No secret VALUE displayed by any command.

## 10. Post-provision auth-disabled HTTP verification (auth MUST stay disabled)
- `app.trysimsa.com/api/auth/ok` → **503 `auth_disabled`**.
- `app.trysimsa.com/api/auth/sign-up/email` → **503 `auth_disabled`**.
- Worker `/api/auth/ok` → **503 `auth_disabled`**. Worker `/health` → **200**. `app.trysimsa.com/` → **307**.
- → Topology env did NOT activate auth: the gate ladder returns `disabled` (AUTH_ENABLED unset) BEFORE any
  topology/runtime is read, so the two new values are inert until activation. No 2xx on any auth endpoint.

## 11. Post-provision D1 dormancy verification (read-only)
- auth objects = **7**; user/session/account/verification = **0/0/0/0**. No rows created.

## 12. AUTH_ENABLED status
- Remains **UNSET** (not a secret, not in `wrangler.toml [vars]`). Production auth stays dormant.

## 13. Rollback / containment note
- Not needed (verification clean). If topology env ever causes unexpected behavior while `AUTH_ENABLED` is
  unset: `wrangler secret delete BETTER_AUTH_BASE_URL` and `wrangler secret delete BETTER_AUTH_TRUSTED_ORIGINS`
  (instant, no code deploy — reusable script). Keep `AUTH_ENABLED` unset; keep `BETTER_AUTH_SECRET`; do NOT
  drop 0047; do NOT roll back dashboard/central-plane unless their own behavior is unsafe.

## 14. M&A / enterprise readiness note
Production auth topology was prepared without activating auth, deploying code, or mutating app data: two
public first-party origin values set as reversible Worker secrets, with verified-disabled behavior (503 +
zero D1 rows) post-provisioning. Topology provisioning and the activation flag flip stay distinct, auditable steps.

## 15. Explicit non-actions (NONE performed)
No `AUTH_ENABLED` activation, no `BETTER_AUTH_SECRET` rotation/deletion, no central-plane/dashboard deploy,
no production D1 mutation/write, no OAuth, no DNS/domain, no CORS prod change, no live dashboard behavior
change, no successful sign-up/sign-in, no payment/billing, no MCP/npm publish, no code change on main, no
dogfood PR #121~130 change. Only the two approved topology env values were provisioned.

## 16. Recommended next stage
**Stage 238 — Production Auth Activation Gate**, only after `"Production auth activation approved."` Scope:
set `AUTH_ENABLED=true` only (single env change, no deploy/migration/secret-rotation), run a minimal marked
production smoke (sign-up/sign-in → expected D1 deltas), with instant rollback `wrangler secret delete
AUTH_ENABLED`.
