> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 169 — User Profile / Account Settings IA

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593`
**Type:** product/design IA (docs-only). **No deploy, no central-plane, no migration, no auth/OAuth, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output.**

## 1. Goal
Define a low-risk profile/account-settings information architecture that can be built
later **without blocking on real auth/workspace/team** — separating now-safe (local/demo)
surfaces from auth/integration/billing/migration-dependent ones.

## 2. Stage 168 findings addressed
No global profile/account route, no real user model — only a `MockUserBadge`/sidebar
initial and `localStorage` locale. Collaboration depends on a future real-auth decision.
Stage 169 plans the profile surface so a now-safe slice can ship independently of auth.

## 3. Current dashboard profile/account inventory (verified)
- **App shell** (`app/layout.tsx`): `I18nProvider` → `AppSidebar` + `main` with a floating
  `LanguageToggle` (top-right).
- **Sidebar** (`components/AppSidebar.tsx`): brand wordmark top; a bottom **user initial
  badge** rendered as a non-interactive `<span>` (`bg-brand-600` circle) in both collapsed
  and expanded rails. `MockUserBadge.tsx` exists but is not wired into the shell.
- **Locale:** `I18nProvider` + `LanguageToggle`, persisted to `localStorage`
  (`conclave:locale`); en/ko.
- **No** `/account`, `/profile`, `/settings` (global), or connected-accounts UI.
- **Natural future entry point:** the sidebar user-initial badge → link to `/account`.

## 4. Recommended account route — **`/account`** (Option A)
- Low-friction global user settings; **not blocked** by workspace/team model; works for
  both single-user and future team modes; can later link to `/workspace/settings`.
- Fits the flat routing convention (siblings: `/projects`, `/admin/*`). Rejected:
  `/settings/account` (no global `/settings` yet), `/profile` (narrower than "account"),
  `/workspace/settings/account` (presumes a workspace model that doesn't exist).
- **Entry point:** make the sidebar initial badge a `<Link href="/account">` when built
  (Stage 170), plus an item near the bottom of the expanded sidebar.

## 5. Account page information architecture
1. **Profile** — display name, email, avatar/initial, (later) role/status badge.
2. **Preferences** — preferred locale / UI language, notification preference, (later) timezone.
3. **Connected accounts** — GitHub status, Vercel status, disconnect/manage placeholder,
   read-first safety note.
4. **Data & export** — export my projects/reports (later), import settings (later), delete
   account (later, **disabled until real auth**).
5. **Workspace** — current workspace/`userKey` label (if applicable), future team/workspace links.

Section readiness:
- **Profile:** display name/avatar = now-safe (local/demo); email = requires real auth.
- **Preferences:** locale = **now-safe** (reuse existing i18n); notifications/timezone = defer.
- **Connected accounts:** GitHub = requires integration UX (Stage 173; backend exists);
  Vercel = requires integration.
- **Data & export:** export = partial-now (links to existing builder pack); import/delete = defer/auth.
- **Workspace:** `userKey` label = now-safe (display only); team links = requires auth.

## 6. Field/action classification matrix
| Field / Action | UX surface | Now-safe? | Requires auth? | Requires DB/migration? | Requires integration? | Notes |
|----------------|-----------|:--------:|:--------------:|:----------------------:|:---------------------:|-------|
| display name | Profile | ✅ (local) | for persistence | for persistence | — | demo/local now; identity later |
| email | Profile | ❌ | ✅ | ✅ | — | needs verified identity |
| avatar / initial | Profile | ✅ (initial) | upload→auth | upload→yes | — | initial now; uploaded avatar later |
| preferred locale | Preferences | ✅ | — | server-persist later | — | **reuse `conclave:locale`** |
| notification pref | Preferences | ⚠️ local toggle | for delivery | for delivery | email/telegram | display now; delivery later |
| timezone | Preferences | ✅ (local) | persist→auth | persist→auth | — | defer |
| GitHub connected | Connected | ⚠️ status only | — | — | ✅ (exists) | show status; mgmt Stage 173 |
| Vercel connected | Connected | ⚠️ "planned" | — | — | ✅ (none yet) | placeholder only |
| disconnect GitHub | Connected | ❌ | — | — | ✅ | Stage 173 + approval |
| disconnect Vercel | Connected | ❌ | — | — | ✅ | after Vercel exists |
| export account data | Data | ⚠️ link existing export | — | — | — | links to builder pack |
| import data | Data | ❌ | — | maybe | — | Stage 172 |
| delete account | Data | ❌ | ✅ | ✅ | — | disabled until auth |
| current workspace | Workspace | ✅ (label) | — | — | — | show `userKey` label only |
| switch workspace | Workspace | ❌ | ✅ | ✅ | — | needs workspace model |

## 7. Locale preference strategy
Reuse the existing i18n: `read/writeStoredLocale` (`localStorage` `conclave:locale`).
An `/account` Preferences section can surface the **same** locale control as
`LanguageToggle` (local-only) **now**; a real profile persists preferred locale
server-side **later** (after auth). No new i18n mechanism. Not implemented this stage.

## 8. Connected accounts strategy
- **GitHub:** backend integration exists (OAuth + GitHub App, encrypted tokens). The
  account page shows **status only** (e.g. "Connected"/"Not connected"), deferring
  connect/disconnect management to **Stage 173**.
- **Vercel:** **placeholder "Planned"** — no backend yet.
- **Never expose tokens; read-first; least-privilege; write actions need explicit
  approval; connect/disconnect not implemented here; no external API calls.**

## 9. Data / export / import / delete-account strategy
- **Export:** link to the existing per-project builder-pack export now; account-wide
  export later.
- **Import:** Stage 172 (build on intake).
- **Delete account:** **disabled until real auth** (destructive + identity-bound); needs
  confirmation + scoped cascade when built.

## 10. i18n copy plan (`account.*` — plan only, implement with the stub)
`account: { title, subtitle, profile{...}, preferences{...}, connectedAccounts{...},
data{...}, workspace{...}, safety{...} }`, EN + KO first (reuse dictionary-first; en/ko
parity test will enforce), future locales dictionary-only. Not added this stage.

## 11. Auth / identity dependencies
- **Now-safe (no auth):** locale preference, `userKey`/workspace **label**, GitHub
  connection **status (read)**, display-name/avatar as **local/demo**, links to existing
  export.
- **Requires real auth:** persisted email/identity, account-wide persistence of profile
  fields, delete account, switch/real workspace, team links.
- **Requires integration:** GitHub/Vercel connect/disconnect management (Stage 173).
- **Requires billing:** none here (payment TBD, Korea-first, no Stripe — out of scope).

## 12. Risks and non-goals
- **Non-goals:** sign-in/up/password/OAuth flows, user-table migration, session
  middleware, billing/payment settings, real teammate/workspace switching.
- **Risk — honest positioning:** a local/demo profile must not imply authenticated
  multi-user. Label demo/local fields clearly; don't show "secure account" until auth.
- **Risk — destructive:** delete account stays disabled until auth + confirmation design.

## 13. Implementation plan
- **Stage 170 — Account Settings Local Preference Stub (now-safe):** `/account` route +
  `account.*` i18n (EN+KO) + Profile (local display name/initial), Preferences (locale
  reusing `conclave:locale`), Connected (GitHub status read / Vercel "Planned"), Workspace
  (`userKey` label), Data (link to existing export). All local/read-only; auth-dependent
  fields shown as disabled/"requires sign-in". Sidebar initial badge → `/account` link.
- **Stage 171+ (auth-gated planning):** Workspace/Team model, Share/Invite/Permission UX,
  Export/Import, GitHub/Vercel integration UX + safety, then the foundation checkpoint.
  Auth-dependent layers stay planning until an Auth/Identity decision (Stage 168 risk).

## 14. Stage 169 decision — **Option A: Profile/account IA ready (with strong auth-dependency notes)**
The `/account` IA is defined with a clear now-safe slice (profile-local, locale, GitHub
status, `userKey` label, export link) separated from auth/integration/billing/migration
dependencies. Proceed to a **low-risk local account-settings stub (Stage 170)**; keep the
deeper team/sharing/integration layers as planning until the auth decision.

## 15. Recommended next stage
**Stage 170 — Account Settings Local Preference Stub** (now-safe `/account` route +
`account.*` i18n + local profile/locale/status surfaces; no auth, no migration, no
integration calls). **Do not merge** the train PR until the foundation checkpoint + Bae
approval.
