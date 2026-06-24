# Stage 197 — Better Auth Local Spike Approval Gate

**Date:** 2026-06-25
**Branch:** `docs/stage-197-better-auth-local-spike-gate` · **Base / main:** `6ac260b` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** approval gate / boundary document only. **No spike performed. No auth implementation, no Better Auth install, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no local D1 migration run, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

## 1. Executive gate decision
- **This stage does NOT approve implementation.** It defines the **decision boundary** for a
  *future* local-only spike.
- **If approved later, the spike must be LOCAL-ONLY.**
- **Production deploy** remains **forbidden** without separate approval.
- **Production migration** remains **forbidden** without separate approval.
- **Token/secret handling in chat or logs** remains **forbidden** at all times.

## 2. Current main state
- `main` = **`6ac260b`** (Release: Stage 192~194). Auth **planning docs merged** (187/188/189/192/
  193/194).
- **Better Auth is NOT installed**; **no auth routes**; **no migrations added**.
- **Production** remains the prior dashboard deploy (`9b645af`).
- `/account` = **local stub**. **Plan Map live and read-only.**

## 3. What a future local-only spike MAY be allowed to test (max safe scope, Stage 198, only if Bae approves)
Potentially allowed **later**:
- **Install Better Auth** only **after explicit package/version approval**.
- **Central-plane local auth route only** (`/api/auth/*`, local).
- **Local D1 identity tables only** (`user`/`session`/`account`/`verification`).
- **Feature flag default OFF for production.**
- **Local login/logout proof** only · **local session-verification proof** only.
- **No production credentials · no production env changes · no production deploy.**
- **No** workspace-aware project-access changes · **no** role enforcement · **no** team invitation
  flow · **no** Plan-Map approval audit · **no** IntegrationAccount ownership migration.

## 4. What remains FORBIDDEN even in the future local spike
Production deploy · production D1 migration · production env-var changes · OAuth provider setup
with **real secrets** · printing/requesting secrets · workspace role enforcement · team invites ·
share links · Plan-Map gate approval · IntegrationAccount token storage · GitHub/Vercel ownership
migration · payment/billing · domain/DNS changes · MCP/npm publish · destructive data changes ·
modifying live-dashboard behavior.

## 5. Approval phrases required before future work (separate, non-transferable)
| Future action | Required exact phrase |
|---|---|
| Future local-only spike | **"Better Auth local spike approved."** |
| Package/version install | **"Better Auth package/version approved."** |
| Local migration file creation | **"Local auth migration draft approved."** |
| Production migration | **"Production auth migration approved."** |
| Auth implementation beyond local spike | **"Better Auth implementation approved."** |
| Production dashboard deploy | **"Dashboard deploy approved."** |
**Each approval is separate and non-transferable** — one phrase never implies another; the local
spike phrase does **not** authorize install, migration, implementation, or deploy.

## 6. Future Stage 198 allowed file boundary (do NOT create now)
Potential future files (only if approved): **central-plane auth config/helper** files ·
**central-plane local auth route** · **local-only migration draft** · **test files** · **docs
report**. **Explicitly excluded:** production env files · secrets · **dashboard production auth
UI** · workspace access enforcement · payment/billing files · domain/DNS config.

## 7. Future Stage 198 package/version boundary
- **Exact Better Auth version must be re-checked immediately before install** (`[verify]` —
  including #4203/#10021 status at that version).
- **No broad dependency upgrades** · **no unrelated package changes**.
- **Lockfile changes limited to the approved auth package(s)** (`better-auth`, in
  `apps/central-plane` only).
- **Any package-manager failure stops the spike.**

## 8. Future Stage 198 migration boundary
- Migration **draft may be local-only if approved**; **production migration must NOT run**.
- **Additive only** · **no destructive changes** · **`userKey` columns remain**.
- **Rollback = feature flag OFF + `userKey` read path preserved.**
- **Migration number re-checked against `main` immediately before drafting** (current next =
  `0047`; re-verify in case main advanced).

## 9. Future Stage 198 runtime boundary
- **Central-plane / Workers / D1 target.**
- Dashboard **consumes** session state later — **not** source of truth.
- **Local-only test route allowed only if approved**; **production route activation forbidden**.
- **Cookie/CORS/CSRF strategy must be documented before any live route.**

## 10. Future Stage 198 test boundary (minimum)
`pnpm typecheck` · central-plane tests (if available) · auth-helper tests · **disabled-flag
behavior** · **no-token-output scan** · **no-production-env-mutation scan** · migration **dry/local
smoke only if approved** · **no dashboard regression** if the dashboard is touched.

## 11. Stop conditions (the future spike must STOP if)
Secrets are required · production env vars are needed · production migration is needed · Better
Auth docs **contradict** the plan · package install causes **broad dependency churn** · the **D1
adapter path is unclear** · cookie/session behavior **cannot be safely scoped locally** · **tests
fail** · **any live production behavior would change**.

## 12. Success criteria for a future local spike
- Local-only proof **compiles**; **no production changes**; **no secrets exposed**; feature-flag
  boundaries **clear**; the local auth route **can be reasoned about**; the migration path
  **remains additive**; the rollback plan **remains valid**; the **next gate can be decided**.
- **Success is NOT** defined as production-ready, secure, final, or complete.

## 13. Relationship to Plan Map
Plan Map remains **read-only**. `GateDecision` remains **future**. A local auth spike **does not
enable** Plan-Map approval audit. The Plan-Map blocker can be updated only **after real auth
implementation + deploy** — **not** after a local spike. (At most, a spike could justify wording
like "Auth architecture selected", never "approval audit enabled".)

## 14. Relationship to /account
`/account` remains the **local stub in production**. A future local spike **may document** sign-in
behavior **but must not ship production sign-in**. **Account-page changes require separate UI
approval** if the page is touched.

## 15. Relationship to collaboration
Team/invite/share/roles remain **blocked**. Workspace/member enforcement remains **blocked**.
`userKey` remains **insufficient**. A local identity spike is **only the first foundation layer**,
not collaboration.

## 16. Recommended Stage 198
- **Option A — Stage 198: Better Auth Local Spike Plan / Approval Execution** — only if Bae
  explicitly provides **"Better Auth local spike approved."**
- **Option B — Stage 198: Better Auth Package / Version Final Check** — one more version
  verification before any install.
- **Option C — Stage 198: Session Cookie / CORS Strategy Deep Dive** — if cookie/domain risk feels
  too high.
- **Recommendation: Option C first** (Session Cookie / CORS Strategy Deep Dive) as the **safest
  next step** — the Vercel↔Workers cross-origin cookie/CORS/CSRF design is the highest-uncertainty
  area (Stage 192 flagged cookie defaults + cross-host as `[verify]`), and resolving it **on paper**
  de-risks any later spike. Option B can fold into it. Option A only on the explicit spike phrase.

## 17. Now-safe vs gated
- **Now-safe:** this approval-gate doc · boundaries · stop conditions · success criteria · future
  approval-phrase definitions.
- **Requires Bae auth approval:** installing Better Auth · auth route handlers · session logic ·
  local login/logout flow.
- **Requires Bae package/version approval:** changing `package.json` · changing the lockfile.
- **Requires Bae migration approval:** creating a SQL migration draft · running local D1 migration ·
  running production migration.
- **Requires Bae deploy approval:** any production route · any production session cookie · any
  production env var · any live-dashboard change.
- **Requires security review:** cookies/sessions · OAuth callback · CORS/CSRF · env-var handling ·
  token storage · account deletion/export · rate limiting.

## 18. Stage 197 decision — **Gate defined; no spike executed**
The boundaries, forbidden actions, six separate approval phrases, file/package/migration/runtime/
test boundaries, stop conditions, and success criteria for a **future local-only spike** are
defined. **Nothing was implemented, installed, migrated, or deployed.** The recommended safest next
step is **Stage 198 — Session Cookie / CORS Strategy Deep Dive** (Option C); a local spike proceeds
only on the explicit phrase **"Better Auth local spike approved."**

## 19. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no
migration · no MCP publish · no npm publish · no auth/OAuth · no Better Auth install · no package
change · no token/secret · no domain/DNS · no server write · no DB persistence · no live-dashboard
change · dogfood PRs #121~130 untouched.
