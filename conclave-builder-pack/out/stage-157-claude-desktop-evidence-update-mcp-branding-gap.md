> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 157 — Claude Desktop Evidence Update / MCP Display Branding Gap

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (Stage 154~159 train, PR #153) · **Base:** `main` @ `de6f7e6`
**Type:** evidence update + local config branding. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Record Bae's **actual** Claude Desktop app-side dogfood evidence as **passed** for the
core MCP Basic flow, supersede the Stage 156 pending-only status, fix the local MCP
display name (`simsa-basic` → `Simsa-Basic`), investigate custom-icon support, and
record the Web App handoff English-hardcoding gap. Publish stays held.

## 2. Correction to Stage 156 evidence status
Stage 156 was written under the assumption that **no** Bae app-side evidence existed
(Status B). That assumption is now **superseded**: Bae ran the Claude Desktop app-side
dogfood and reported success for the core flow. This stage updates the classification.

## 3. Bae app-side evidence summary
Claude Desktop app-side Simsa Basic flow worked:
- acceptance map generated successfully
- stage plan generated successfully
- evidence plan generated successfully
- Simsa Web App handoff link generated successfully (URL starts with
  `https://app.trysimsa.com/projects/new/intake`)
- Basic-only preview behavior was shown
- **no** credential / user-key prompt reported
- **no** `run_pr_review` / `post_pr_comment` exposure reported

New UX gaps reported by Bae:
1. MCP server/display name appears as `simsa-basic`; desired display is **`Simsa-Basic`**.
2. Icon appears as a generic "S"; desired branding improved **if** Claude Desktop supports it.
3. Handoff destination in the Simsa Web App shows hardcoded **English** copy.

## 4. Updated evidence classification
**Status A — Claude Desktop app-side dogfood passed for the core MCP Basic flow, with
branding and handoff UX gaps recorded.** This is **not** full public-publish readiness:
core invocation worked inside Claude Desktop, but product-facing polish gaps remain
(display name correction; icon capability unconfirmed; handoff English-hardcoded copy).

## 5. MCP display name gap
The generated local config used server key `simsa-basic`. The user-facing entry should
read `Simsa-Basic`. This is **local MCP server display/config branding only** — the npm
package, internal package, internal namespace, and `@conclave-ai/mcp-workspace` are
**not** renamed.

## 6. Config helper update
`packages/mcp-workspace/scripts/print-claude-desktop-basic-config.mjs` now emits server
key **`Simsa-Basic`** (command `node`, args → local `dist/index.js`, `env: {}`, no
credentials, no config-file mutation). Tests
(`test/print-claude-desktop-basic-config.test.mjs`) updated to assert the `Simsa-Basic`
entry **and** that the old lowercase `simsa-basic` key is gone. README examples + the
"Private Claude Desktop dogfood" and Troubleshooting references updated to `Simsa-Basic`
with a note that internal package names are unchanged. Verified: generated config
contains `"Simsa-Basic"` and no `"simsa-basic"` server key.

## 7. Icon support investigation — **Icon Outcome B (not confirmed)**
The local Claude Desktop config (`claude_desktop_config.json`) `mcpServers` entries are
documented for `command` / `args` / `env` (stdio servers). A custom **icon** field for
a local stdio MCP server entry is **not confirmed** in the config schema available here.
Therefore **no icon configuration is implemented in this stage** — to avoid fabricating
unsupported config. The **display name `Simsa-Basic`** is the branding lever used now;
custom icon is tracked as a host-capability follow-up (revisit if/when a documented,
supported field is confirmed).

## 8. Web App handoff English hardcoding gap
The MCP handoff link itself is valid and safe (correct URL prefix, sensitive fields
omitted, persists nothing). However, the **receiving Simsa Web App** intake/handoff
surface displays **hardcoded English copy** — a dashboard localization gap (the
dashboard has an i18n system; this destination should honor it). This is a
**dashboard** issue, not an MCP runtime issue.

## 9. Impact classification
- MCP runtime: **PASS**
- Claude Desktop app-side core flow: **PASS**
- Handoff URL safety: **PASS**
- MCP display branding: **FIXED** (`Simsa-Basic`)
- Custom icon: **follow-up** (host capability not confirmed)
- Dashboard handoff localization: **GAP**
- Korean beta/public readiness: **BLOCKED until the handoff copy is localized or
  explicitly accepted**
- MCP publish: **still held**

## 10. Publish readiness implication
**MCP publish remains held.** Core app-side flow passing is necessary but not
sufficient: the dashboard handoff English-hardcoding gap blocks Korean beta/public
readiness until fixed or explicitly accepted, and custom-icon branding is an open
follow-up. No publish is recommended.

## 11. Stage 157 decision
**Option A — Evidence status updated and display branding fixed.** Claude Desktop core
MCP app-side evidence is **Status A with caveats**; the `Simsa-Basic` display config is
updated and verified; icon support is documented as **not confirmed** (Outcome B); the
handoff English copy remains a dashboard UX gap routed to Stage 158.

## 12. Recommended next stage
**Stage 158 — Web App Handoff Localization / Korean UX Gap Inventory** (inventory the
hardcoded English copy on the handoff/intake destination and plan the i18n fix, reusing
the dashboard's existing dictionary-first i18n). **Do not merge** the train PR until the
Stage 159 checkpoint + Bae approval.
