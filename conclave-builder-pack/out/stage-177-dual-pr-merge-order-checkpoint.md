# Stage 177 — Dual PR Merge Order Checkpoint / PR #155 + PR #156

**Date:** 2026-06-24
**Checkpoint branch:** `docs/stage-177-dual-pr-merge-order-checkpoint` · **Base:** `main` @ `9c4e593`
**Type:** review / merge-order checkpoint (no code change beyond this doc). **No merge, no deploy, no MCP/npm publish, no migration, no auth/OAuth/payment/billing/hosted execution, no central-plane change, no token/secret output. Neither PR branch is modified.**

## 1. PR status (verified via `gh` + `git merge-tree`)
| | PR #155 | PR #156 |
|---|---|---|
| Branch | `docs/stage-168-workspace-collaboration-integrations` | `fix/stage-176-simsa-stamp-thinking-motion` |
| HEAD | `4684fd5` | `4f3c9c6` |
| Base | `main` | `main` |
| State | OPEN | OPEN |
| Mergeable | **MERGEABLE** | **MERGEABLE** |
| mergeStateStatus | **CLEAN** | **UNSTABLE** (CI pending, not failing) |
| CI `typecheck-build (20)/(22)` | **pass / pass** | **pending / pending** (re-running after the `4f3c9c6` push) |
| Size | +1445 / −7 | +567 / −343 |

- PR #156's **UNSTABLE** is solely because CI is **pending** (the `4f3c9c6` doc-cleanup push
  re-triggered the workflow); `mergeable` is still MERGEABLE. Locally `pre-push verify` +
  the full suite passed, and CI runs the same `pnpm verify`. Expected to go green.

## 2. Scope comparison
**PR #155 — Collaboration Foundation (Stage 168~175):**
- Code (local, no-auth): `/account` local-preference stub (`app/account/page.tsx`),
  sidebar account link (`AppSidebar.tsx`), `lib/account-preferences.*` + test, `account.*`
  i18n (new namespace in `dictionary.mjs`/`.d.mts`).
- Docs: 8 planning/checkpoint reports (gap inventory, IA, workspace/team, share/invite,
  export/import, GitHub/Vercel integration, Stage 175 merge-readiness checkpoint).
- No deploy / migration / auth / OAuth / payment / publish. Stage 175 decision = Option A,
  merge-ready.

**PR #156 — Simsa Stamp Thinking Motion (Stage 176):**
- Code (dashboard-only): `SimsaStampThinking.tsx` + `lib/stamp-thinking.*` + test (new);
  **deletes** `SimsaSealThinking.tsx` + `lib/seal-thinking.*` + its test; `loading.*` i18n
  rewrite (same namespace, EN+KO) in `dictionary.mjs`/`.d.mts`; `globals.css` stamp motion;
  `intake/page.tsx` integration update.
- Future sound design **documented only** (opt-in, off by default).
- Docs: Stage 176 report (incl. the `4f3c9c6` body-renumber cleanup follow-up commit).
- No deploy / migration / auth / OAuth / payment / publish.

## 3. Conflict / rebase risk — **trivial (auto-merges cleanly)**
- **Only overlapping files:** `apps/dashboard/src/i18n/dictionary.mjs` and
  `dictionary.d.mts`. PR #155 **adds** the `account.*` namespace; PR #156 **rewrites** the
  `loading.*` namespace — **different regions**.
- **`git merge-tree --write-tree --messages <#155 head> <#156 head>`** produced a **clean
  merged tree (`3b2799d`) with NO conflict markers** — both dictionary files reported
  `Auto-merging` and resolved automatically. So even a 3-way merge of the two branches needs
  **no manual conflict resolution**.
- No generated/artifact files committed (no `.next/`, no build output). `intake/page.tsx`,
  `globals.css`, the stamp component/lib/test, and the account files are **disjoint** between
  the two PRs.
- The i18n **en/ko key-parity test** (`test/i18n.test.mjs`) is the safety net: after either
  PR lands, it will flag any key drift in the combined dictionary.

## 4. Safety gate review — **CLEAR (both PRs)**
Full file-list scan for `migration | central-plane | package.json | .env | wrangler |
vercel.json | .github/workflows` → **empty** for both PRs. Confirmed **absent** in both:
secrets/tokens · migrations · production deploy config · central-plane deploy/write · auth/
session/OAuth · payment/billing/Stripe · MCP/npm publish or version bump · hosted execution ·
domain/DNS. Both PRs are **dashboard-app + docs only**. No blocker.

## 5. Recommended merge order — **Option A**
**Merge PR #155 first → (optional trivial rebase) → verify → merge PR #156.**
Rationale (all Option-A conditions met):
1. PR #155 is the older Collaboration Foundation train, **Stage 175 merge-ready**, **CLEAN**,
   **CI green**.
2. PR #156 conflict risk is **limited to a dictionary auto-merge that `merge-tree` already
   resolves cleanly** — a rebase is optional, not required.
3. **No safety blocker** in either PR.

Sequence:
1. Merge **PR #155** → `main` (Stage 178).
2. Rebase **PR #156** onto updated `main` (optional — auto-merge is clean; rebase only to
   keep history linear), then re-verify (Stage 179).
3. Merge **PR #156** → `main` (Stage 179 gate).
4. Only after **both** are on `main`, consider the dashboard deploy/dogfood (Stage 180) with
   explicit Bae approval.

## 6. ★ Dashboard deploy constraint
**Do not deploy the dashboard until BOTH the collaboration checkpoint decision and the stamp
correction are resolved on `main`.** Critical nuance: the **wax-seal motion is already on
`main`** (Stage 160~166, `9c4e593`); PR #155 does **not** replace it. So deploying after only
PR #155 merges would ship the **wax seal** live. **PR #156 MUST be merged before any
dashboard deploy** of the Stage 160~166 loading-motion work — regardless of PR #155.

## 7. Verification plan
**First PR to merge (PR #155), pre-merge:**
- `pnpm --filter @conclave-ai/dashboard test`
- `pnpm --filter @conclave-ai/dashboard typecheck`
- `pnpm --filter @conclave-ai/dashboard build`
- `pnpm typecheck`

**Second PR (PR #156), after rebase onto the updated `main`:** the same four commands, plus
confirm the **en/ko parity test** passes against the combined dictionary (`account.*` +
rewritten `loading.*`).

## 8. Stage 177 decision — **Option A**
Both PRs are OPEN/MERGEABLE with **no safety blocker** and **trivial (auto-resolved)**
dictionary overlap. Recommend **merge PR #155 first, then rebase/verify/merge PR #156**, and
**hold any dashboard deploy until PR #156 is on `main`.** This stage performs **no merge** —
it awaits explicit Bae approval to proceed to Stage 178.

## 9. Recommended next stages
- **Stage 178 — Merge PR #155 / Main Sync / Post-Merge Verification** (on Bae approval).
- **Stage 179 — Rebase PR #156 on Main / Verify / Merge Gate** (after #155 lands).
- **Stage 180 — Dashboard Deploy / Intake i18n + Simsa Stamp Motion Visual Dogfood** — only
  after **both** PRs are on `main` and only with explicit Bae approval.
