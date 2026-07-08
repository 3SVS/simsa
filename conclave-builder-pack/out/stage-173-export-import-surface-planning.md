> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 173 — Export / Import Surface Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593`
**Type:** planning (docs-only). **No deploy, no central-plane, no migration, no import-parser/PDF/account-export implementation, no auth/OAuth, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output.**

## 1. Goal
Plan Simsa's export/import surface as a collaboration/handoff foundation: existing
exports, missing imports, artifact + input taxonomy, file/content safety, the
import↔intake relationship, future account/workspace export, and phases. Docs-only.

## 2. Current export/import inventory (verified)
- **Export — exists, project-scoped, dual path:**
  - **Client-side download:** `projects/[id]/export/page.tsx` uses `createObjectURL` +
    `.zip` + `download` (builder-pack zip generated in the browser; jszip).
  - **Server endpoint:** central-plane `routes/workspace.ts` has `/export` (≈ lines
    35/408/442) producing a `builder_pack` payload.
- **Import — none.** No `projects/import` route, no `<input type="file">`, no parser
  (grep empty).
- **Intake** already accepts `WORKSPACE_INTAKE_TYPES` = idea / prd / product_url /
  github_repo / pull_request / ai_built_app (`workspace-preview/src/intake.mjs`).
- **Deterministic artifact builders exist** (markdown/JSON): e.g. benchmark
  summary/markdown comment builders, `JSON.stringify` artifact shapes.
- **Secret omission:** the handoff link omits secrets (Stage 139); export is
  project-scoped (no token exposure expected) — but **export lacks explicit sensitivity
  labeling** (gap).

## 3. Existing export artifacts
Builder pack (project-scoped): README/brief + acceptance items + checks/fixes + (per
prior stages) stage/evidence context, packaged as a downloadable zip; plus copy-to-
clipboard artifacts (benchmark summary/markdown, etc.).

## 4. Current gaps
No import anywhere; no account/workspace-wide export; no Simsa-artifact re-import; no
markdown/JSON/zip import; no sensitivity labeling on export; no import↔intake bridge.

## 5. Export taxonomy
- **Project export:** brief, acceptance map, stage plan, evidence plan, agent run plan,
  acceptance graph summary, recurring blockers, tool memory, template signals.
- **Report export:** markdown report, JSON report, PDF (later).
- **Builder pack export (exists):** zip for AI-builder/handoff — README, acceptance items,
  stage/evidence plan, constraints, disclaimer.
- **Account/workspace export (future, auth-gated):** all projects, settings/preferences,
  activity log, integration **metadata but no tokens**.

## 6. Import taxonomy
- **Text import:** idea / PRD / spec / acceptance notes / bug report.
- **URL import:** website / prototype / Vercel preview URL.
- **Repo/PR import:** GitHub repo / PR / issue / branch.
- **File import:** markdown / JSON / zip builder pack (later: PDF/docx if parser exists).
- **Simsa artifact import:** previously-exported acceptance map / stage plan / evidence
  plan / project bundle.
(No parser implemented this stage.)

## 7. Import safety rules
Imported files/content are **untrusted user input**: no code execution; no automatic
dependency install; no automatic external fetch without explicit confirm; **file-size
limits**; accepted **MIME/type allowlist**; **JSON schema validation**; **zip-traversal
protection** if zip import is added; **secret scanning / warning** if secrets detected;
imported content marked **user-provided**; any LLM-derived content stays **not_verified**
until evidence. (Mirrors the existing handoff/MCP "untrusted DATA" stance.)

## 8. Export safety rules
Export may include sensitive project content: **show a sensitivity notice before
download**; **omit tokens/secrets/integration credentials**; include generated-at
timestamp + source/stage/version; include the standard disclaimer (**not a
bug-free/secure/compliant/production-ready guarantee**); **account/workspace exports
require auth + role permission** (later).

## 9. Relationship with intake
Import should **feed `/projects/new/intake`** as structured starting input — reuse the
existing intake pipeline rather than a parallel system:
- markdown/PRD file → intake text + `type=prd`
- GitHub repo URL → intake repo input + `type=github_repo`
- Vercel/preview URL → intake URL + `type=product_url` (or `ai_built_app`)
- Simsa JSON artifact → restore preview context or seed a new intake draft
(Not implemented; `type=ai_app` in the brief maps to the existing `ai_built_app`/
`product_url` types.)

## 10. Route / UX planning (future)
`/projects/[id]/export` (exists), `/projects/import`, `/projects/new/intake?source=import`,
`/account/data`, `/workspace/export`. **Now-safe path:** keep project export as-is; add an
import entry point later that routes into intake; defer account/workspace export until the
auth/workspace model.

## 11. Account/workspace export dependencies
Account/workspace-wide export requires the **auth + workspace model** (Stage 171) — to
scope "all my projects" to an identity/workspace and enforce role permission — plus
**activity-log** data (not yet built). Integration metadata may be exported but **never
tokens**.

## 12. Suggested implementation phases
- **Phase 1** Project export polish + **sensitivity labels** (now-safe; no auth).
- **Phase 2** `/projects/import` UI that **feeds intake** (text/URL first; no file parser).
- **Phase 3** markdown/JSON **file import** with size limits + schema validation + secret
  warning.
- **Phase 4** Simsa-artifact **re-import** (restore preview context).
- **Phase 5** GitHub/Vercel **import via integrations** (Stage 174; read-first).
- **Phase 6** Account/workspace export **after auth/workspace model**.

## 13. Non-goals
No import parser, no PDF generation, no account/workspace export, no auth/OAuth, no
migration, no payment/billing (payment **TBD**, Korea-compatible first, no Stripe), no
hosted execution. No code this stage.

## 14. Stage 173 decision — **Option A: Export/import surface plan ready**
Export exists (project-scoped, client zip + central-plane `/export`); import is entirely
missing. The taxonomy, safety rules, and an **intake-fed import** model are defined.
Now-safe path: polish project export (sensitivity labels) + plan an import entry that
routes into intake; defer account/workspace export to post-auth. Proceed to Stage 174.

## 15. Recommended next stage
**Stage 174 — GitHub / Vercel Integration UX + Safety Model.** **Do not merge** the train
PR until the foundation checkpoint + Bae approval.
