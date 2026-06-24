# Stage 170 — Account Settings Local Preference Stub

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593`
**Type:** dashboard UI (local-only). **No deploy, no central-plane, no migration, no auth/OAuth/session, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output, no destructive delete.**

## 1. Goal
Ship a low-risk `/account` settings stub using only **now-safe, local/demo-safe**
capabilities (Stage 169 IA) — clearly separated from real auth/identity/integration.

## 2. Implementation summary
- **`/account` route** (`app/account/page.tsx`, `"use client"`): Profile, Preferences,
  Connected accounts, Data & export, Workspace sections, each labeled with a status
  badge (Local / Planned / Requires sign-in / Read-only).
- **Pure helper** `lib/account-preferences.mjs` (+ `.d.mts`): `normalizeDisplayName`
  (trim, cap 80, default fallback), `displayInitial`, `read/writeDisplayName` (localStorage,
  never throws). React-free → runs under `node --test`.
- **i18n** `account.*` extended (EN + KO) — kept existing `workspace`/`plan`/`settings`
  (used by the sidebar) and added `title/subtitle/openLabel/sections/profile/preferences/
  connectedAccounts/data/workspaceInfo/badges`. `Dictionary` type updated.
- **Sidebar**: the bottom user-initial badge (collapsed `<span>` and expanded profile
  block) now links to `/account` with an accessible `openLabel`.

## 3. Route and navigation
Route `/account` (flat, sibling of `/projects`, `/admin/*`). Entry points: the sidebar
initial badge (collapsed rail) and the expanded bottom profile row, both `<Link
href="/account">` with `aria-label={t.account.openLabel}`. No behavior break.

## 4. Profile / local preference behavior
Display name is a **localStorage-backed input** (`conclave:account:displayName`),
normalized (trim, max 80, fallback "Simsa user"), no HTML rendering (React-escaped). The
avatar initial derives from the name. Copy states **"Stored locally in this browser — not
saved to a server."** Email is shown as **"available after sign-in"** with a
*Requires sign-in* badge (no field). No server write, no user table.

## 5. Locale preference behavior
Preferences reuses the existing `LanguageToggle` (which uses `useI18n` +
`localStorage conclave:locale`) — no new locale system. Help copy notes it applies to this
browser and will be saved with the account after sign-in.

## 6. Connected accounts placeholder/status
**GitHub:** read-only status row pointing to project repository settings (backend exists;
managed there) + *Read-only* badge. **Vercel:** "Planned" + *Planned* badge. A safety note
states integrations are read-first / least-privilege and **tokens are never shown**. No
connect/disconnect buttons, no API calls.

## 7. Data / export / import surface
Notes that project exports live in each project's Builder pack; account-wide export and
import are "Planned". **Delete account** is rendered **disabled** with a *Requires sign-in*
badge and explanatory copy. No new export/import implemented; no destructive action.

## 8. Workspace surface
Shows the current workspace as **local, browser-scoped** (no real team); team workspaces
and teammate invites are "Planned" with badges. No workspace switching.

## 9. i18n keys added
`account.{title, subtitle, openLabel, sections.{profile,preferences,connectedAccounts,
data,workspace}, profile.{displayName,displayNamePlaceholder,storedLocally,
emailRequiresSignIn}, preferences.{language,languageHelp}, connectedAccounts.{github,
githubStatus,vercel,vercelStatus,readFirst}, data.{projectExports,accountExportPlanned,
importPlanned,deleteAccount,deleteRequiresSignIn}, workspaceInfo.{current,localScoped,
teamPlanned,invitePlanned}, badges.{local,planned,requiresSignIn,readOnly}}` — EN + KO,
enforced by the existing en/ko key-parity test. (`workspaceInfo` is named to avoid
clashing with the pre-existing `account.workspace` string used by the sidebar.)

## 10. Auth / identity boundaries
This is explicitly a **local preferences stub, not an authenticated account.** No
sign-in/up/password/OAuth/session, no user table/migration, no server persistence, no
billing. Auth-dependent items (email, delete account, team/workspace switching) are shown
disabled or "Requires sign-in". Honest copy avoids implying authenticated multi-user.

## 11. Tests
`test/account-preferences.test.mjs` (pure): `normalizeDisplayName` (trim, max length,
empty/custom/blank fallback, no-throw on malformed), `displayInitial`, and
`read/writeDisplayName` round-trip + no-throw on null/throwing storage. The i18n parity
test covers `account.*` en/ko parity. No React-page test (no setup) — covered by
typecheck + build.

## 12. Verification results
- dashboard tests **242/242** ✓ (was 232; +10) · typecheck ✓ · **build ✓**
  (`/account` route, 1.87 kB).
- monorepo typecheck **57/57** ✓. No deploy, no publish.

## 13. Stage 170 decision
**Option A — Local account stub ready.** The `/account` surface is useful and **clearly
separated** from real auth/integration (local display name + locale, read-only GitHub
status, Planned Vercel, disabled delete, local workspace label), with honest badges/copy.

## 14. Recommended next stage
**Stage 171 — Workspace / Team Member Model Planning** (auth-gated planning; do not
implement before the auth/identity decision). **Do not merge** the train PR until the
foundation checkpoint + Bae approval.
