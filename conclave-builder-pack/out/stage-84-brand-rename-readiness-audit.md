# Stage 84 — Brand Rename Readiness Audit

**Status: READINESS AUDIT. Product name stays "Conclave" today.**

Stage 84 does not rename anything. It (1) audits where the public-facing
brand string "Conclave" appears, (2) classifies each occurrence as
public / internal / historical, (3) centralises the lowest-risk surfaces
behind a `BRAND` constant on both dashboard and central-plane so a future
deliberate rename touches one place, and (4) documents what remains
hardcoded along with risk notes.

No push, no deploy, no remote migration, no live verification — same
operating rule as Stage 79–83.

## 1. Brand surface audit summary

Repo-wide count (excluding `node_modules/`, `dist/`, `.next/`, `.turbo/`):

| Scope | Files | Occurrences |
|-------|-------|-------------|
| Total | 536 | 3,417 |
| `packages/` | 270 | mostly internal namespace (@conclave-ai/*) |
| `apps/` | 118 | mix of internal infra + public-facing |
| `docs/` + `conclave-builder-pack/out/` | 91 | historical, frozen |
| `.conclave/` | 22 | learned answer-keys / failure-catalog (frozen — Stage 6 self-evolve substrate) |
| `marketing/` | 10 | public-facing landing copy |
| Other | ~25 | scripts, examples, root configs |

Search performed with:

```
grep -rEnI "Conclave|conclave" --include="*.ts" --include="*.tsx" \
  --include="*.mjs" --include="*.js" --include="*.json" --include="*.md" \
  --include="*.sql" --include="*.toml" --include="*.yml" --include="*.yaml" .
```

## 2. Classification: public / internal / historical

### Category A — public-facing (rebrand-configurable)

These surfaces would change if "Conclave" became "Foo":

| Surface | File / Location | Currently | Stage 84 action |
|---------|------------------|-----------|------------------|
| HTML `<title>` + meta description | `apps/dashboard/src/app/layout.tsx` | hardcoded | **swapped to `BRAND.metadataTitle` / `metadataDescription`** |
| Sidebar wordmark | `apps/dashboard/src/components/AppSidebar.tsx` line 85 | `t.brand.wordmark` (i18n) | already config-driven via i18n; left alone (would change in lockstep with `t.brand.wordmark`) |
| EN/KO `brand.wordmark` + `tagline` | `apps/dashboard/src/i18n/dictionary.mjs` | hardcoded in dictionary | left alone; test pins `t.brand.wordmark === BRAND.productName` so a future rename catches drift |
| EN i18n strings referring to product | `apps/dashboard/src/i18n/dictionary.mjs` (~9 occurrences: "Conclave is reading…", "Conclave understood…", "Conclave does not guess…", "Conclave benchmark result", etc.) | hardcoded EN strings | **left as-is**; refactor would require touching i18n parity invariants — documented as Category A-deferred |
| KO i18n strings referring to product | `apps/dashboard/src/i18n/dictionary.mjs` (KO mirror of above) | translated KO strings (no literal "Conclave" except wordmark) | left alone; KO already says "Conclave" only in wordmark |
| Canonical Evolution Action Pack heading | `apps/central-plane/src/workspace/evolution-action-pack.ts` `DEFAULT_EVOLUTION_STRINGS.packHeading` | hardcoded `"Conclave Evolution Action Pack"` | **swapped to `BRAND.actionPackHeading`** |
| PR comment Korean heading | `apps/central-plane/src/workspace/pr-comment.ts` line 126 | `## 🔍 Conclave PR 확인 결과` | left as-is; documented as Category A-deferred |
| PR comment Korean footer attribution | `apps/central-plane/src/workspace/pr-comment.ts` line 297 | `Conclave](https://conclave-ai.dev)` | left as-is; footer also embeds the public domain (which IS Category B — internal infra). Rebrand touches both. |
| Telegram notification heading | `apps/central-plane/src/workspace/telegram-notify.ts` line 44 | `"Conclave PR 확인 완료"` | left as-is; documented as Category A-deferred |
| Builder pack export (3 strings) | `apps/central-plane/src/workspace/export.ts` lines 132, 258, 350 | hardcoded KO sentences referring to "Conclave Workspace" | left as-is; documented as Category A-deferred |
| PR fix brief footer | `apps/central-plane/src/workspace/pr-fix-brief.ts` line 106 | `- Conclave가 코드를 자동으로 고치지 않습니다.` | left as-is; documented as Category A-deferred |
| Marketing site copy | `marketing/**` | hardcoded across landing site | out of scope for Stage 84 (marketing repo refactor) |
| README + CONTRIBUTING + CLAUDE.md | root | hardcoded | left as-is (Category C-ish — developer-facing docs) |

**Stage 84 swapped surfaces (2)**:

1. `apps/dashboard/src/app/layout.tsx` metadata title + description → `BRAND.metadataTitle` / `BRAND.metadataDescription`
2. `apps/central-plane/src/workspace/evolution-action-pack.ts` `DEFAULT_EVOLUTION_STRINGS.packHeading` → `BRAND.actionPackHeading`

**Stage 84 deferred but inventoried (7)**: PR comment, Telegram, builder pack export, PR fix brief, i18n EN body strings, marketing site, README/CONTRIBUTING/CLAUDE.md. Each carries refactor risk that exceeds Stage 84's "readiness, not rename" budget — listed in §10 as remaining rename risks.

### Category B — internal namespace (DO NOT rename now)

These would NOT change in a brand rename. They are frozen by the
"bake-it-once" sections of `CLAUDE.md`:

| Surface | Examples | Why frozen |
|---------|---------|------------|
| npm package names | `@conclave-ai/core`, `@conclave-ai/cli`, `@conclave-ai/agent-*`, `@conclave-ai/central-plane`, `@conclave-ai/dashboard`, all 26 packages | npm scope rename = breaks every downstream installer; lockstep release process |
| MCP package ID | `@conclave-ai/mcp-workspace` | Claude Desktop / Cursor / Windsurf integrations bind to this id |
| Repo folder names | `apps/central-plane/`, `apps/dashboard/`, `packages/agent-claude/`, etc. | git history, every import path, every CI workflow |
| Env vars | `CONCLAVE_*` prefix anywhere it appears | `wrangler.toml` bindings, `.dev.vars` files, every deployment runtime |
| URL fragments | `conclave-ai.seunghunbae.workers.dev`, `dashboard.conclave-ai.dev`, `conclave-ai.dev` | DNS, Cloudflare Worker route, Vercel project URL |
| DB table names | `workspace_evolution_action_packs`, `workspace_agent_*`, etc. | every migration filename + every D1 row references them |
| Migration filenames | `0044_workspace_evolution_action_packs.sql`, all `0001_*` → `0045_*` | migration ledger; renaming breaks `pnpm migrate:apply` |
| HTTP route paths | `/workspace/projects/:id/...`, `/workspace/agent-experiments/...` | clients (CLI, dashboard, MCP) bind to these paths |
| localStorage keys | `conclave:locale`, `conclave_user_key`, `conclave_wf_*`, `conclave_outcomes_*`, `conclave:review-selection:*`, `conclave:sidebar-collapsed` | renaming = every existing user loses their workspace data |
| CSS / Tailwind class prefixes | `brand-50`, `brand-700`, etc. | renaming = visual regression risk + Tailwind config rewrite |
| Test fixture ids | `uk_owner`, `proj_exp`, `wexp_*`, `wprr_*`, `wab_*`, `weap_*` | internal test scaffolding; never user-visible |
| Cloudflare Worker name | `conclave-ai` (wrangler.toml) | route binding, deploy URL |
| GitHub App name | `Conclave` (existing app) | OAuth callback URL, webhook delivery, every connected repo's installation id |
| `.conclave/` learned data path | answer-keys, failure-catalog | self-evolve substrate; renaming = users lose learned patterns |
| Repo root `Conclave` references in identifiers | source code constants like `CONCLAVE_*` | identifiers, not user-visible strings |

### Category C — historical (DO NOT change now)

These are write-once dated artifacts:

| Surface | Volume |
|---------|--------|
| `docs/HANDOFF-*.md` (all dated handoffs) | many — each is a point-in-time record |
| `conclave-builder-pack/out/stage-*.md` (Stages 1–84 spec docs) | 84+ files |
| `docs/releases/*.md` | per-release notes |
| `docs/migrate-to-v0.4.md`, `docs/saas-deploy-checklist.md` | versioned ops docs |
| Old benchmark / example dirs | `benchmarks/`, `examples/` |

Rationale: a historical doc that says "Conclave PR review run #25104136096"
should keep saying that — it's a record of what shipped, not a forward-
looking surface. Rebranding history is revisionism.

## 3. Dashboard brand config changes

Added `apps/dashboard/src/lib/brand.mjs` (+`.d.mts`):

```ts
export const BRAND = {
  productName: "Conclave",
  productShortName: "Conclave",
  tagline: "Acceptance workspace for AI-built software",
  metadataTitle: "Conclave — Acceptance workspace for AI-built software",
  metadataDescription: "Turn product intent into acceptance checks, review history, and fix instructions for AI-built software.",
};
```

Wired into `apps/dashboard/src/app/layout.tsx`:

```diff
-  title: "Conclave — Acceptance workspace for AI-built software",
-  description: "Turn product intent into acceptance checks, ...",
+  title: BRAND.metadataTitle,
+  description: BRAND.metadataDescription,
```

Three brand tests in `apps/dashboard/test/brand.test.mjs` pin:

1. `BRAND.productName === "Conclave"`, etc. (stable values guard)
2. `t.brand.wordmark === BRAND.productName` for every locale (drift catcher — i18n sibling must move in lockstep with BRAND on rename)
3. `t.en.brand.tagline === BRAND.tagline` (EN-only; KO has its own translation)

What I intentionally did NOT change:

- `AppSidebar.tsx` already uses `t.brand.wordmark` → already config-driven via i18n. Replacing with `BRAND.productName` would lose the i18n locale-flexibility that already exists.
- `dictionary.mjs` body strings referring to "Conclave" inside sentences — these read as natural language and refactoring them via `${BRAND.productName}` template strings would touch every i18n parity test + risk locale-specific grammar errors. Listed as Category A-deferred.

## 4. Central-plane generated text audit + changes

Added `apps/central-plane/src/workspace/brand.ts`:

```ts
export const BRAND = {
  productName: "Conclave",
  productShortName: "Conclave",
  actionPackHeading: "Conclave Evolution Action Pack",
} as const;
```

Wired into `apps/central-plane/src/workspace/evolution-action-pack.ts`:

```diff
 export const DEFAULT_EVOLUTION_STRINGS: EvolutionStrings = {
-  packHeading: "Conclave Evolution Action Pack",
+  // Heading sourced from BRAND (Stage 84) so a future rebrand touches one
+  // file; saved pack_json rows from before this change keep their own
+  // baked-in heading (immutable artifact policy).
+  packHeading: BRAND.actionPackHeading,
   ...
 };
```

Three central-plane brand tests in `apps/central-plane/test/brand.test.mjs` pin:

1. `BRAND.*` stable values
2. `DEFAULT_EVOLUTION_STRINGS.packHeading === BRAND.actionPackHeading` (drift catcher)
3. `buildEvolutionActionPackText(...)` still starts with `"# Conclave Evolution Action Pack"` (Stage 77 contract preservation)

### What remains hardcoded in central-plane (Category A-deferred)

Documented for the rebrand stage — explicitly NOT refactored in Stage 84:

| Location | String | Why deferred |
|----------|--------|--------------|
| `pr-comment.ts:126` | `## 🔍 Conclave PR 확인 결과` | KO body string; refactor would need `${BRAND.productName} PR 확인 결과` template + i18n parity revisit |
| `pr-comment.ts:297` | `[Conclave](https://conclave-ai.dev)` | also embeds the public domain (Category B) — rebrand stage touches both atomically |
| `telegram-notify.ts:44` | `"Conclave PR 확인 완료"` | KO body string |
| `export.ts:132,258,350` | builder pack body sentences | KO body strings |
| `pr-fix-brief.ts:106` | `- Conclave가 코드를 자동으로 고치지 않습니다.` | KO body string |
| Various stage 75 / scorecard / evolution copy in `DEFAULT_EVOLUTION_STRINGS` | sentences like `"Re-run Conclave PR review after merge..."`, `"Record the outcome in the experiment decision so Conclave can score the next loop."` | EN body strings — same i18n parity concern as the dashboard case |

Total: **~12 server-generated user-facing strings still containing
"Conclave"** that a true rebrand would need to touch. Each is sentence-
level (not a heading), so refactoring requires either:

- (a) split sentences into i18n keys → swap `Conclave` for `${BRAND.productName}` template literal, OR
- (b) accept brand string inline in sentences (single-locale strings) and refactor in lockstep with the rename PR.

Option (b) is lower refactor risk for Stage-84-style readiness. Option
(a) is cleaner but a project-wide effort.

## 5. Saved artifact compatibility

**Saved Stage 77 action packs are NOT rewritten by Stage 84.**

Concrete behavior:

- Stage 77 packs are stored as `pack_json` (full
  `EvolutionActionPack` snapshot). The `sections[].title` and
  `sections[].body` already contain the EN body strings rendered at save
  time. The heading also already lives in the rebuilt `text` field which
  is regenerated at read time.
- Stage 84 changes `DEFAULT_EVOLUTION_STRINGS.packHeading` to read from
  `BRAND.actionPackHeading`. The VALUE is unchanged ("Conclave Evolution
  Action Pack"), so:
  - All existing saved packs continue to render with the same heading.
  - All new saved packs continue to render with the same heading.
  - When (someday) BRAND.actionPackHeading changes, **only new pack
    `text` regeneration** will pick up the new heading. Old `pack_json`
    rows keep their stored values intact (the `sections[]` body is what
    actually got copied to the user's clipboard at save time, and the
    server doesn't rewrite stored rows).

This matches Stage 77's immutable-artifact policy: saved packs are
revisitable history, not live documents.

### Recommendation for future actual rename stage

When the new brand name is chosen:

1. Update `BRAND.productName`, `BRAND.actionPackHeading`, etc. in both
   `apps/central-plane/src/workspace/brand.ts` and
   `apps/dashboard/src/lib/brand.mjs`.
2. Update i18n `brand.wordmark` + EN/KO body strings in
   `dictionary.mjs` to the new name. (Drift test catches the i18n
   sibling automatically.)
3. **Decide explicitly** whether to rewrite stored Stage 77 pack rows.
   Default recommendation: NO (artifacts are dated by the brand of their
   era). If yes, a one-time D1 UPDATE batched with the deploy.

## 6. i18n / tests results

- Dashboard: **3 new tests** in `brand.test.mjs` (BRAND value pin,
  i18n drift catcher per locale, EN tagline pin). 191/191 total.
- Central-plane: **3 new tests** in `brand.test.mjs` (BRAND value pin,
  packHeading-from-BRAND pin, buildEvolutionActionPackText still
  starts with `"# Conclave Evolution Action Pack"`). 1134/1134 total.
- **i18n parity 10/10** — no dictionary keys changed; both `brand.wordmark`
  / `brand.tagline` remain in EN and KO.
- **typecheck 54/54** — Stage 84 only added a new const file and one
  import line in each app; no public types changed.

No existing test was rewritten or weakened. The drift catchers are
additive guards.

## 7. Local verification

```
central-plane test: 1134/1134   (Stage 83 1131 → +3)
dashboard test:     191/191     (Stage 83 188 → +3)
typecheck:          54/54
lint:               clean (pre-existing /export/page.tsx warning only)
i18n parity:        10/10
next build:         skipped — sandbox env: Google Fonts blocked by
                    SELF_SIGNED_CERT_IN_CHAIN (Stage 77–83 same env
                    issue; unrelated to Stage 84)
```

Per the operating rule:

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule.** (Stage 84
  added no migration.)
- **Live verification: skipped by operating rule.**

## 8. Files changed

New files:

- `apps/dashboard/src/lib/brand.mjs`
- `apps/dashboard/src/lib/brand.d.mts`
- `apps/dashboard/test/brand.test.mjs`
- `apps/central-plane/src/workspace/brand.ts`
- `apps/central-plane/test/brand.test.mjs`
- `conclave-builder-pack/out/stage-84-brand-rename-readiness-audit.md`
  (this doc)

Modified files (small, surgical):

- `apps/dashboard/src/app/layout.tsx` — 1 import + 2 metadata fields
- `apps/central-plane/src/workspace/evolution-action-pack.ts` — 1
  import + 1 string literal replaced with `BRAND.actionPackHeading` +
  comment
- `docs/HANDOFF-2026-06-20.md` — Stage 84 section appended

## 9. Remaining rename risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| B1 | A future rebrand touches `BRAND` but forgets the i18n sibling `t.brand.wordmark` | **Caught** by the new dashboard `brand.test.mjs` drift test. |
| B2 | Stage 77 saved pack rows show old brand after rename | **By design** — artifacts are dated. Documented in §5. |
| B3 | KO body sentences in `pr-comment.ts`, `telegram-notify.ts`, `export.ts`, `pr-fix-brief.ts` still hardcode "Conclave" | **Documented**, not refactored. A future rename PR must touch each. ~6 server files, ~10 strings. |
| B4 | EN body sentences in `dictionary.mjs` ("Conclave is reading…", etc.) still hardcode "Conclave" | **Documented**. Refactor option (a) splits to templates + drift tests; option (b) inlines new brand in the rename PR. |
| B5 | Marketing site (`marketing/**`) carries hardcoded "Conclave" copy across landing pages | **Out of scope**. Marketing repo gets its own rename pass. |
| B6 | Internal namespace temptation: someone tries to also rename `@conclave-ai/*` packages, `CONCLAVE_*` env vars, `conclave_*` localStorage keys, `/workspace/*` route paths | **Documented as Category B-frozen** in §2. Renaming any of these triggers downstream breakage (npm consumers, deployed env, existing users' local data, every integrated client). The rebrand stage MUST commit not to touch them. |
| B7 | Public URLs `conclave-ai.seunghunbae.workers.dev`, `dashboard.conclave-ai.dev`, `conclave-ai.dev` would need DNS migration if the rename is a true marketing-facing change | **High effort** — DNS + redirects + Cloudflare Worker rebinding. Decide release strategy at rebrand time. |
| B8 | GitHub App named "Conclave" carries every existing repo's installation. Renaming requires either keeping the app + presenting a new display name OR cutting a new app + reauth flow for every user | **Major UX cost**. Recommendation: keep GitHub App's internal name, change only the display name where possible. |
| B9 | Built-in MCP integrations (Claude Desktop, Cursor, Windsurf) reference `@conclave-ai/mcp-workspace` package id | **Documented as Category B-frozen**. Renaming = every IDE user reconfigures their MCP server config. |
| B10 | `.conclave/` learned answer-keys + failure-catalog folder paths in users' repos | **Documented as Category B-frozen** — renaming = users lose learned patterns. |

## 10. Recommendation: release checkpoint before or after actual rename

**Release the Stage 77–82 evolution-record arc FIRST as "Conclave".**

Reasons:

1. The product surface is mature and tested. Holding it back to wait for
   a brand decision = wasted weeks of in-flight value.
2. Saved Stage 77 packs become dated artifacts under the Conclave brand
   — exactly the right semantic. A later rebrand introduces a clean
   "rename day" boundary in the user's timeline.
3. The Stage 84 audit + `BRAND` constants reduce a future rebrand from a
   site-wide search-and-replace to: change 2 constants → run drift
   tests → ship the deferred sentence updates as one PR.
4. The Category B surfaces (packages, env, DB, routes) are explicitly
   frozen regardless of timing. The Conclave-era release establishes
   them firmly.
5. Internal namespace freezing also means the existing
   `claude/stage-79-82-evolution-loop` branch + release prep doc (Stage
   83) can ship as-is without doc rewrites.

Implication for Stage 83's go/no-go checklist: **no change**. Add one
informational line: "Brand rename audit landed (Stage 84); release ships
under the existing Conclave brand."

When the new brand IS chosen later:

- 5–10 commit rebrand PR touching `BRAND.*` constants + ~12 server
  generated text strings + dictionary body strings + marketing site +
  GitHub App display name.
- Category B remains frozen (per the Stage 84 contract).
- One separate decision on whether to rewrite stored Stage 77 pack rows
  (recommended: no).
