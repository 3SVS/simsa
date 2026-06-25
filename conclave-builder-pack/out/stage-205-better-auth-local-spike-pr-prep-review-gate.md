# Stage 205 — Better Auth Local Spike PR Prep / Review Gate

**Date:** 2026-06-25
**Type:** PR prep + push + review gate (no merge, no deploy, no implementation beyond the Stage 204 skeleton). **No production deploy, no migration, no auth route, no login/logout UI, no session middleware beyond the spike, no OAuth, no Vercel rewrite, no CORS code, no production env, no `.env`, no DNS/domain, no production server write/persistence, no Plan-Map audit, no role enforcement, no team invite/share, no IntegrationAccount migration, no MCP/npm publish, no payment/billing, no token/secret output, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

## 1. Branch / HEAD
`feat/stage-204-better-auth-local-spike` @ **`a6aa4bb`** (base `main` @ `94943e8`). One feature commit
ahead of main (the Stage 204 spike). Working tree clean.

## 2. Files changed (7, +587 / −4)
- `apps/central-plane/package.json` (+ `"better-auth": "1.6.20"` only)
- `pnpm-lock.yaml` (better-auth + transitive deps)
- `apps/central-plane/src/env.ts` (3 optional flags)
- `apps/central-plane/src/auth-spike-config.ts` (new, pure flag helper)
- `apps/central-plane/src/better-auth-spike.ts` (new, gated skeleton + import proof)
- `apps/central-plane/test/better-auth-spike.test.mjs` (new, 7 tests)
- `conclave-builder-pack/out/stage-204-better-auth-local-spike-execution.md` (Stage 204 report)
**Exactly the 7 expected files; no other file changed.**

## 3. Safety diff review
- `better-auth` is **exact-pinned to `1.6.20`** (no caret/tilde); the `package.json` diff is the
  single added line. **No broad dependency upgrade, no unrelated package change, no dashboard
  package change.**
- Confirmed **absent**: migration files · `.sql` · auth route registration (`index.ts`/`router.ts`
  unchanged, not in diff) · OAuth provider setup · real secrets · `.env` · production env config ·
  Vercel rewrite · CORS code · DNS/domain · production deploy config · Plan-Map approval audit ·
  workspace role enforcement · team invite/share UI · IntegrationAccount token storage ·
  payment/billing · MCP/npm publish · live-dashboard behavior.

## 4. Product / architecture review
The PR preserves: **Better Auth primary** · **WorkOS fallback still possible** · **Simsa-owned
collaboration layer unchanged** · the spike is **local-only** · **auth disabled by default**
(`AUTH_ENABLED` unset) · **production unaffected** · `/account` stays the **local stub** · Plan Map
stays **read-only** · `userKey` stays the **legacy fallback** · **no route → no live auth surface
yet**. Next steps remain **separate gates**: merge approval · local migration draft approval · auth
implementation approval · production migration approval · deploy approval · Vercel rewrite/subdomain
approval.

## 5. Verification results
- `pnpm --filter @conclave-ai/central-plane build` — **ok** (better-auth compiles under Workers TS).
- `pnpm --filter @conclave-ai/central-plane typecheck` — **ok**.
- `node --test … better-auth-spike.test.mjs` — **7/7 pass**.
- `pnpm typecheck` (monorepo) — **57/57**.
- **`pre-push verify`** (typecheck + build + lint, incl. central-plane with better-auth) — **passed**.

## 6. Secret / token scan
`(secret|token|password|api-key|client-secret|access-token|refresh-token|bearer)` value patterns +
`sk-`/`ghp_`/private-key — in the new src files = **0**. The single hit in the test
(`BETTER_AUTH_SECRET: "super-secret-value"`) is a **synthetic test fixture** that the test asserts is
**NOT** echoed by the config (a no-leak assertion), not a real secret. **No real secret/token
values.**

## 7. Push result
Pushed `feat/stage-204-better-auth-local-spike` → origin (new branch, **non-force**). Pre-push
`pnpm verify` (which builds central-plane with better-auth) **passed**.

## 8. PR number / URL
**PR #162** — https://github.com/3SVS/conclave-ai/pull/162

## 9. PR status
OPEN · base `main` · head `feat/stage-204-better-auth-local-spike` @ `a6aa4bb` · **MERGEABLE** ·
mergeStateStatus **UNSTABLE** (CI `typecheck-build (20)/(22)` **pending** — just triggered; this is
the first PR that builds better-auth on the CI Node 20/22 runners; locally green + pre-push verify
passed) · 7 files, +587 / −4. Scope as expected.

## 10. Docs path
`conclave-builder-pack/out/stage-205-better-auth-local-spike-pr-prep-review-gate.md` (local checkpoint
record, like Stage 177~203 — not pushed, keeps the merge queue lean).

## 11. Stage 205 decision — **Option A: Better Auth local spike PR ready for review**
Branch pushed, **PR #162 opened**, verification green (build/typecheck/spike-test/monorepo + pre-push
verify), exactly the 7 expected files, no safety blockers, no real secrets, architecture preserved.
CI pending (will run the same `pnpm verify`). **Not merged, no further implementation.**

## 12. Merge gate status
**HELD.** Merge requires **"PR #162 merge approved."** (Stage 206).

## 13. Migration / auth / deploy gate status
**ALL HELD.** No migration, no auth route, no production rollout. **Even after merge**, each next step
needs its **own** phrase: local auth migration draft (**"Local auth migration draft approved."**),
auth implementation (**"Better Auth implementation approved."**), production migration (**"Production
auth migration approved."**), deploy (**"Dashboard deploy approved."**), plus Vercel rewrite / auth
subdomain / DNS. **PR merge approval does not imply any of these.**

## 14. Rollback note
Fully reversible: revert `apps/central-plane/package.json` + `pnpm-lock.yaml` + `pnpm install`; delete
the 2 new src files + the test; revert the `env.ts` additions. **No DB / live / env / dashboard change
to undo.**

## 15. Out-of-scope confirmation
No production deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no
production migration · no MCP publish · no npm publish · no OAuth · no token/secret · no domain/DNS ·
no production server write · no production persistence · no Vercel rewrite · no CORS code · no
live-dashboard change.

## 16. Recommended next stage
**Stage 206 — Better Auth Local Spike Merge Gate / Main Sync / Post-Merge Verification** (only after
explicit **"PR #162 merge approved."**). Then **Stage 207 — Better Auth Local Route + D1 Migration
Draft Planning**, only if Bae approves the next gate. **PR merge approval does not approve migration,
route registration, production deploy, Vercel rewrite, OAuth, or real auth rollout.**
