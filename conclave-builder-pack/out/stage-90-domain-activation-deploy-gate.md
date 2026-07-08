> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 90 — Domain Activation + Deploy Gate

**Date:** 2026-06-22
**Split:** 90A (Deploy Gate PR) → **then** 90B (Domain Activation Execution, separate approval).

---

## Stage 90A — Deploy Gate (this PR)

### Problem
`deploy-central-plane.yml` auto-deployed on every push to `main` that touched
`apps/central-plane/**` / `packages/core/**`. A code-only merge therefore triggered a
production deploy. Stage 89 hit this: the docs/config merge auto-started a deploy that
had to be cancelled mid-run (Worker deploy was cancelled before it shipped; the migration
step was a no-op — "No migrations to apply!").

### Change (Option A — workflow_dispatch-only)
`.github/workflows/deploy-central-plane.yml`:
- **Removed the `push:` trigger entirely.** The workflow now runs **only** on
  `workflow_dispatch`.
- Added a required `confirm` input + a first **"Confirm deploy intent"** step that
  fails fast unless `confirm == "deploy"`. Guards against accidental dispatch.
- Migration step condition simplified to `inputs.apply-migrations != 'false'`
  (the `push`-event branch is gone).
- Kept `apply-migrations` input, build → migrations → deploy → smoke steps unchanged.

### Trigger behavior — before / after
| | Before | After |
|---|---|---|
| Merge central-plane code to main | **auto production deploy** | CI only (`ci.yml`); **no deploy** |
| Production deploy | implicit on merge | **manual**: Actions → deploy-central-plane → Run workflow → type `deploy` |
| Code merged vs deployed | coupled | **decoupled** |

### Verification
- YAML parses cleanly; `on` = `[workflow_dispatch]` only (no `push`); inputs = `apply-migrations`, `confirm`; first step = "Confirm deploy intent" (`if: inputs.confirm != 'deploy'`).
- No deploy / migration / domain / DNS executed.

### 90A success criterion — met
central-plane production deploy no longer runs automatically on main push; it runs only
via explicit manual dispatch (with a typed confirm). ✓

---

## Stage 90B — Domain Activation Execution (DO NOT RUN until 90A merged + approved)

### Preconditions
- 90A merged; `deploy-central-plane` is manual/gated.
- `main` includes Stage 89 code (CORS + OAuth allowlists for app.trysimsa.com / trysimsa.com).
- Bae confirms DNS/Vercel UI access.
- No uncommitted local changes.

### Step 1 — Vercel custom domain
- Target Vercel project: the one serving `conclave-dashboard.vercel.app` (`conclave-dashboard`).
- Add `app.trysimsa.com` as a custom domain; configure DNS **CNAME** per Vercel's instruction; wait for verification (SSL issued).
- **Do NOT remove `conclave-dashboard.vercel.app`** (kept as fallback).

### Step 2 — dashboard domain smoke
- `https://app.trysimsa.com` loads dashboard, `<title>` = Simsa, valid TLS.
- `https://conclave-dashboard.vercel.app` still works.

### Step 3 — central-plane deploy (manual, gated)
- Actions → deploy-central-plane → Run workflow on `main`, type `confirm = deploy`.
- Activates the Stage 89 CORS allowlist (app.trysimsa.com, trysimsa.com).
- No new migrations expected; if the migration step runs it must report a no-op
  ("No migrations to apply!").

### Step 4 — app.trysimsa.com API smoke
- Dashboard at app.trysimsa.com calls central-plane successfully (CORS preflight returns the exact echoed origin).
- userKey/auth flow works.
- GitHub connect returnTo flow works from app.trysimsa.com (returnTo allowlisted in Stage 89; OAuth callback is worker-based → no GitHub App change needed) — or document the failure reason.

### Step 5 — rollback
- Keep `conclave-dashboard.vercel.app` as fallback.
- If broken: remove/disable `app.trysimsa.com` from Vercel.
- Revert central-plane CORS deploy only if necessary (re-dispatch a deploy of the prior commit).

### Remaining link-transition follow-ups (later stage)
- Switch generated links (PR comment footer `conclave-ai.dev`, Telegram, export) to the live Simsa domain only **after** app.trysimsa.com is confirmed live.
- Decide trysimsa.com apex (redirect → app vs landing) and simsa.dev docs.

---

## Security
- No token values printed or stored. Vercel token was rotated/revoked by operator (R11).
- Cloudflare deploy uses repo secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) inside Actions — never echoed.
