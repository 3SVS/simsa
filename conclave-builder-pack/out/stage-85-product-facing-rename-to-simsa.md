> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 85 — Product-facing Rename to Simsa

**Status: product-facing rename only. Internal technical namespace stays `conclave`.**

Stage 85 executes the rename that Stage 84 made possible. The product name
visible to users is now **Simsa**. Every internal namespace listed in
Stage 84 §2 Category B (npm packages, env vars, DB tables, route paths,
localStorage keys, Telegram bot username, Cloudflare Worker DO class,
GitHub App, `.conclave/` learned data, deployed legacy domains) **remains
frozen** — renaming any of them breaks downstream users.

No push, no deploy, no remote D1 migration apply, no live verification —
same operating rule as Stages 79–84.

## 1. Product-facing rename summary

**Brand decision (received with Stage 85 spec):**

| Field | Value |
|-------|-------|
| Product name | **Simsa** (한글 "심사") |
| Tagline | "The acceptance layer for AI-built software." |
| Primary marketing domain | `trysimsa.com` (NOT wired in Stage 85) |
| Developer domain | `simsa.dev` (NOT wired in Stage 85) |

Rationale (per spec): "Simsa"는 한글 "심사"에서 온 이름이며, 제품의 핵심인
AI-built software 결과물의 검토, 비교, 채택 판단을 의미합니다.

### Stage 85 swapped surfaces (Category A — public-facing)

1. **Dashboard `BRAND` constants** (`apps/dashboard/src/lib/brand.mjs` + `.d.mts`) — productName, productShortName, tagline, metadataTitle, metadataDescription, plus new `primaryDomain` + `developerDomain` fields.
2. **Central-plane `BRAND` constants** (`apps/central-plane/src/workspace/brand.ts`) — productName, productShortName, actionPackHeading, plus new `prCommentHeading` + `tagline`.
3. **Dashboard i18n EN + KO** — all 39 product-facing "Conclave" references in `dictionary.mjs` → "Simsa". EN tagline also updated to match new BRAND.tagline.
4. **Central-plane canonical action pack body strings** — 5 user-facing "Conclave" references in `DEFAULT_EVOLUTION_STRINGS` → "Simsa".
5. **Central-plane PR comment** — heading `## 🔍 Simsa Review (PR 확인 결과)`; footer link text `[Simsa]` (URL still points to legacy `conclave-ai.dev` — DNS migration is a separate stage per Stage 85 spec §5).
6. **Central-plane Telegram notification heading** — `Simsa PR 확인 완료`.
7. **Central-plane Telegram /start welcome** — `<b>Simsa AI bot</b>` and welcome body. Bot username `@Conclave_AI` stays (registered with BotFather).
8. **Central-plane Telegram test notification** — `Simsa 테스트 메시지`.
9. **Central-plane builder pack export** — 3 KO sentences `Simsa Workspace에서 …`.
10. **Central-plane PR fix brief footer** — `Simsa가 코드를 자동으로 고치지 않습니다.`.

### Stage 85 deliberately NOT changed (Category B — internal namespace freeze)

| Surface | Stayed as | Why frozen |
|---------|-----------|------------|
| npm packages | `@conclave-ai/*` (26 packages) | npm scope rename = breaks every downstream installer |
| MCP package id | `@conclave-ai/mcp-workspace` | Claude Desktop / Cursor / Windsurf integrations bind to this id |
| Repo folder names | `apps/central-plane/`, `apps/dashboard/`, etc. | git history, every import path, every CI workflow |
| Env vars | `CONCLAVE_*` prefix | wrangler bindings, .dev.vars, every deployment runtime |
| CLI binary | `conclave init`, `conclave review`, etc. | Users have it installed; renaming breaks installations |
| URL fragments | `conclave-ai.seunghunbae.workers.dev`, `dashboard.conclave-ai.dev`, `conclave-ai.dev` | DNS / Cloudflare Worker route / Vercel project URL |
| DB table names | `workspace_evolution_action_packs`, all `workspace_*` | every migration + every D1 row |
| Migration filenames | `0044_*.sql`, all `0001_*` → `0045_*` | migration ledger |
| HTTP route paths | `/workspace/projects/:id/...`, etc. | clients (CLI, dashboard, MCP) bind to these |
| localStorage keys | `conclave:locale`, `conclave_user_key`, `conclave_wf_*`, all `conclave_*` / `conclave:*` | renaming = every existing user loses their workspace data |
| CSS / Tailwind class prefixes | `brand-50`, `brand-700` | renaming = visual regression risk |
| Test fixture ids | `uk_owner`, `proj_*`, `wexp_*`, etc. | internal scaffolding, never user-visible |
| Cloudflare Worker DO class name | `ConclaveSandbox` | bound in wrangler.toml; rename = migration |
| Telegram bot username | `@Conclave_AI` | registered with BotFather; rename = lose existing chats |
| GitHub App name | `Conclave` | existing repo installations bind to it |
| `.conclave/` learned data folder | answer-keys / failure-catalog paths in users' repos | self-evolve substrate; renaming = users lose learned patterns |

### Stage 85 explicitly NOT done (per spec)

- DNS / Vercel domains / Cloudflare routes / redirects for `trysimsa.com` and `simsa.dev` are NOT configured in this stage. The dashboard chrome can reference them via `BRAND.primaryDomain` / `BRAND.developerDomain` once DNS is wired.
- Marketing site (`marketing/**`) is **out of scope** for Stage 85 — its own rename pass.
- Logo redesign / Figma overhaul — out of scope.
- Stage 77 saved action packs are **NOT rewritten** — immutable artifact policy. Pack rows saved before Stage 85 keep their baked-in `# Conclave Evolution Action Pack` heading in stored `pack_json` sections. Only NEW packs use the Simsa heading.

## 2. Dashboard brand config / UI changes

`apps/dashboard/src/lib/brand.mjs`:

```ts
export const BRAND = {
  productName: "Simsa",
  productShortName: "Simsa",
  tagline: "The acceptance layer for AI-built software.",
  metadataTitle: "Simsa — The acceptance layer for AI-built software.",
  metadataDescription: "Review, compare, and accept AI-built software with evidence.",
  primaryDomain: "trysimsa.com",
  developerDomain: "simsa.dev",
};
```

`apps/dashboard/src/lib/brand.d.mts` — `Brand` type extended with the two
new domain fields.

`apps/dashboard/src/app/layout.tsx` — already wired via Stage 84 (uses
`BRAND.metadataTitle` / `BRAND.metadataDescription`); Stage 85 just
changes the value through the central constant.

`apps/dashboard/src/components/AppSidebar.tsx` — already uses
`t.brand.wordmark` (i18n-driven). The dictionary update flows through
automatically.

## 3. Central-plane generated text changes

`apps/central-plane/src/workspace/brand.ts`:

```ts
export const BRAND = {
  productName: "Simsa",
  productShortName: "Simsa",
  tagline: "The acceptance layer for AI-built software.",
  actionPackHeading: "Simsa Evolution Action Pack",
  prCommentHeading: "Simsa Review",
} as const;
```

| File | Change |
|------|--------|
| `evolution-action-pack.ts` `DEFAULT_EVOLUTION_STRINGS` | 5 body strings — `Re-run Simsa PR review …`, `Report the PR number back to Simsa.`, `Re-run Simsa PR review after changes.`, `Record the outcome … so Simsa can score the next loop.`, `Simsa will compare acceptance results …`. Pack heading still flows from `BRAND.actionPackHeading` (Stage 84 wire). |
| `pr-comment.ts:126` | Heading `## 🔍 Simsa Review (PR 확인 결과)`. |
| `pr-comment.ts:297` | Footer link text `[Simsa](https://conclave-ai.dev)`. URL stays — DNS migration deferred per Stage 85 spec §5. |
| `telegram-notify.ts:44` | First line `Simsa PR 확인 완료`. |
| `routes/telegram.ts:100` | `/start` welcome `<b>Simsa AI bot</b>` + "from your Simsa AI installs". CLI command `conclave init` and `<code>/link YOUR_CONCLAVE_TOKEN</code>` stay (internal namespace). |
| `routes/workspace-notifications.ts:138` | Test notification `Simsa 테스트 메시지`. |
| `export.ts:132,258,350` | Builder pack KO sentences swap `Conclave Workspace` → `Simsa Workspace`. |
| `pr-fix-brief.ts:106` | `Simsa가 코드를 자동으로 고치지 않습니다.` |

## 4. i18n changes

`apps/dashboard/src/i18n/dictionary.mjs`:

- **39 EN + KO product-facing references** swapped via a single
  `replace_all` from `"Conclave"` → `"Simsa"`. Covers brand wordmark,
  body sentences in `understand`, `benchmark`, `experiment`, `evolution`
  namespaces.
- **EN `brand.tagline`** value updated to match `BRAND.tagline`:
  `"The acceptance layer for AI-built software."`.
- **KO `brand.tagline`** unchanged (`"AI가 만든 소프트웨어를 검수하는
  작업공간"`). It's a translation, not a literal copy of BRAND.tagline.
- **Internal i18n key** `LOCALE_STORAGE_KEY = "conclave:locale"` stays
  (Category B).

Brand drift-guard tests pin:

- `t.brand.wordmark === BRAND.productName === "Simsa"` for every locale
- `t.en.brand.tagline === BRAND.tagline === "The acceptance layer for AI-built software."`

i18n parity test still 10/10 (no key shape changes — only values).

## 5. Unchanged internal namespace confirmation

`grep -nE "Conclave|conclave" apps/dashboard/src/i18n/dictionary.mjs`
returns ONE remaining hit:

```
12:export const LOCALE_STORAGE_KEY = "conclave:locale";
```

That's the localStorage namespace prefix (Category B — frozen).

A wider search for INTENTIONALLY remaining occurrences:

- npm package names: `@conclave-ai/*` (26 packages × imports everywhere) — frozen
- env vars: `CONCLAVE_*` in wrangler.toml / .dev.vars / route handlers — frozen
- URL fragments: `https://conclave-ai.seunghunbae.workers.dev` (12 dashboard API wrappers default URL) — deploy infra, frozen
- DB tables: `workspace_evolution_action_packs`, all `workspace_agent_*` — frozen
- Migration filenames: `0044_workspace_evolution_action_packs.sql`, etc. — frozen
- Cloudflare Worker DO class: `ConclaveSandbox` (wrangler.toml + src/index.ts export) — frozen
- Telegram bot username `Conclave_AI` (assertions in `install-summary.test.mjs`) — frozen
- GitHub App display name (out of code) — frozen
- HANDOFF history + stage spec docs — frozen (Category C, historical record)
- Marketing site copy — out of scope (separate rename pass)
- README / CONTRIBUTING / CLAUDE.md — left alone (Stage 85 spec §5: "But avoid sweeping rewrites. Stage 85 should be surgical.")

## 6. Compatibility note for existing saved artifacts

- **Stage 77 saved action packs** keep their original
  `# Conclave Evolution Action Pack` heading and any Conclave-era body
  text in stored `pack_json`. Re-reading old packs renders them as-is.
  NEW packs saved after this code ships will use the Simsa heading.
- **Action pack `text` field** on detail GET is regenerated from
  `pack_json` at read time. Old `pack_json` sections still say Conclave;
  the rebuilt text shows whatever the stored sections contain. This is
  the documented Stage 77 + Stage 84 immutable-artifact policy.
- **No DB migration in Stage 85.** The Stage 83 release prep applies
  `0044` + `0045` from Stage 77/78 only.
- **Internal table/migration/route names** unchanged — pre-Stage-85
  clients (CLI, MCP, dashboard at older versions) continue to function
  identically.
- **Telegram bot** still answers at `@Conclave_AI` username; new welcome
  message displays "Simsa" product brand. Linked chats stay linked.
- **CLI binary `conclave`** unchanged — installed users do not need to
  reinstall.
- **localStorage data** at keys `conclave:*` / `conclave_*` remains
  accessible — users keep their workflow drafts, outcomes, review
  selection, sidebar collapse state.

## 7. Tests / build / local verification

```
central-plane test: 1134/1134   (Stage 84 baseline 1134, no test count change — values flipped)
dashboard test:     191/191     (Stage 84 baseline 191, no test count change — values flipped)
typecheck:          54/54
lint:               clean (pre-existing /export/page.tsx warning only)
i18n parity:        10/10
next build:         skipped — sandbox env: Google Fonts blocked by
                    SELF_SIGNED_CERT_IN_CHAIN (Stage 77~84 same env
                    issue, unrelated to Stage 85)
```

Updated tests (no new tests; existing assertions point to Simsa now):

| File | Change |
|------|--------|
| `apps/central-plane/test/brand.test.mjs` | All 3 tests pin Simsa values + `# Simsa Evolution Action Pack` heading. |
| `apps/central-plane/test/evolution-action-pack.test.mjs` | `/^# Conclave Evolution Action Pack/` → `/^# Simsa Evolution Action Pack/`. |
| `apps/central-plane/test/workspace-evolution-action-pack.test.mjs` | 2 endpoint text-format assertions flipped. |
| `apps/central-plane/test/telegram.test.mjs` | `"Conclave AI bot"` → `"Simsa AI bot"`, comment noting BotFather bot username stays. |
| `apps/central-plane/test/workspace-notifications.test.mjs` | `"Conclave PR 확인 완료"` → `"Simsa PR 확인 완료"`, `"Conclave 테스트 메시지"` → `"Simsa 테스트 메시지"`. |
| `apps/central-plane/test/workspace-pr-comment-comparison.test.mjs:391` | Test description `"still includes Conclave footer …"` → `"still includes Simsa footer …"`. URL assertion unchanged (legacy domain frozen). |
| `apps/central-plane/test/workspace-pr-run-specific.test.mjs:302` | `body.includes("Conclave")` → `body.includes("Simsa")`. |
| `apps/dashboard/test/brand.test.mjs` | All 3 tests pin Simsa values, including new `primaryDomain` / `developerDomain` fields. |
| `apps/dashboard/test/evolution-action-pack.test.mjs:139` | Heading regex flipped. |
| `apps/dashboard/test/agent-experiment.test.mjs:68, 75` | "Conclave Multi-Agent Experiment" → "Simsa Multi-Agent Experiment". |
| `apps/dashboard/test/benchmark-summary.test.mjs:7, 27` | "Conclave benchmark result" → "Simsa benchmark result". |

KEPT as `Conclave` (intentionally — Category B internal infra tested for invariance):

| File | Why kept |
|------|----------|
| `apps/central-plane/test/install-summary.test.mjs:115, 137` | `Conclave_AI` Telegram bot username — frozen (BotFather). |
| `apps/central-plane/test/container-invariants.test.mjs:53, 55` | `ConclaveSandbox` Worker DO class name — frozen. |

No new tests were added — Stage 85 is a value flip, not new behavior.
The Stage 84 drift-guard structure catches future renames automatically.

## 8. Push/deploy/migration/live verification skipped

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule.** (Stage 85
  added no migration.)
- **Live verification: skipped by operating rule.**

Local commit allowed and made for this rename + spec doc + HANDOFF
update.

## 9. Remaining rename risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| RN1 | A future rebrand touches BRAND but forgets the i18n sibling `t.brand.wordmark` | Low | Caught by `brand.test.mjs` drift test (Stage 84 contract). |
| RN2 | Stage 77 saved pack rows show old Conclave heading after Stage 85 ships | **By design** | Documented in §6 — immutable artifact policy. Users see new brand on NEW packs only. |
| RN3 | PR comment footer link `[Simsa](https://conclave-ai.dev)` mixes new product name with legacy domain | Medium | Documented. DNS migration is a separate operational stage. When DNS lands, the URL flips to `trysimsa.com` and the BRAND constant's `primaryDomain` field becomes the canonical reference. |
| RN4 | Existing users have `@Conclave_AI` bot in their Telegram with old display name; welcome text now says "Simsa" — visible inconsistency | Medium | Telegram client shows the bot's registered name; only the message body says "Simsa". Acceptable transition state. BotFather rename is a separate operational stage. |
| RN5 | Marketing site (`marketing/**`) still says Conclave end-to-end | Medium | Out of scope by spec §5. Marketing rename should land before any public launch push under the Simsa name. |
| RN6 | `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` still say Conclave | Low | Developer-facing docs; rename when next touched. |
| RN7 | `docs/HANDOFF-*.md` historical sections + `conclave-builder-pack/out/stage-*.md` Stage 1–84 spec docs still say Conclave | **By design** | Category C, historical record. Renaming historical docs = revisionism. |
| RN8 | GitHub App display name is still `Conclave` | Medium | Out of code. GitHub App display name rename can be done in app settings without breaking installations; do so when ready. |
| RN9 | `.conclave/` learned answer-keys + failure-catalog folder paths in users' repos | Frozen | Category B. Renaming = users lose learned patterns. Permanent legacy namespace. |
| RN10 | npm packages `@conclave-ai/*` (26 packages) keep the old scope | Frozen | Documented as permanent. Rebranding the npm scope = breaks every downstream installer; not worth it. |

The "frozen" risks (RN9, RN10) are not pending follow-ups — they are
**permanent decisions** that the internal technical namespace stays
`conclave` forever. This is normal industry practice (e.g., Twitter →
X kept many internal `twitter` namespaces).

## 10. Release checkpoint recommendation

**Release Stage 77~85 together** under the dual brand:

- Public face = **Simsa**
- Internal technical namespace = `conclave` (frozen)

The release prep doc (Stage 83) is unchanged in structure — only the
product name visible to end users flips. The go/no-go checklist
(Stage 83 §8 + Stage 84 informational line) gains one Stage 85
informational line:

> Stage 85 product-facing rename to Simsa landed. Release ships as
> "Simsa" on dashboard chrome / generated text / PR comments / Telegram
> notifications. Internal `conclave` namespace, URLs, DB tables,
> migrations, env vars, CLI binary, MCP package id, Telegram bot
> username, GitHub App name, and `.conclave/` paths all remain frozen.

After release, separate operational stages handle:

1. **DNS for `trysimsa.com`** + Vercel domain binding for the dashboard.
2. **DNS for `simsa.dev`** + redirect strategy from `conclave-ai.dev`.
3. **Marketing site rename pass** (`marketing/**`).
4. **GitHub App display name change** (app settings only; installations
   stay bound by id).
5. **README / CONTRIBUTING rename** (developer-facing docs).

None of those are blocking for the Stage 77~85 release.

Operating-rule status (Stage 85): **Push: skipped. Production deploy:
skipped. Remote migration apply: skipped. Live verification: skipped.**
Local commit only. Awaiting Bae approval to merge PR #133 and proceed
to `pnpm migrate:apply` + `pnpm ship`.
