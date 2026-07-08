> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 104 — GitHub Repo Intake v1

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Make the `github_repo` intake type useful: paste a repo URL or `owner/repo` and get a deterministic **review plan** for the implementation. **No GitHub API, clone, or remote file fetch** — Stage 104 reasons only from the owner/repo (and path) shape.

## Product principle
A repo is an implementation artifact mapped back to product acceptance. Simsa turns a repo reference into "how to review it", never claiming to know the contents (not fetched).

## Helper — `apps/dashboard/src/lib/intake-github-repo.mjs` (+ `.d.mts`)
`buildGitHubRepoIntakePreview(rawInput): GitHubRepoIntakePreview` — pure, deterministic, throw-free:
- **Parsing**: `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo`, PR URLs (`/pull/123`), tree URLs (`/tree/main`); strips `.git`; validates owner/repo chars; bad input → fallback (`owner/repo:"Unknown"`, `unknown`, `low`), never throws.
- **repoNameSignals**: name/path keyword hits (`dashboard/app/api/server/docs/sdk/monorepo/...`).
- **likelyRepoType**: `app / docs / api / library / monorepo / unknown` (heuristic over owner/repo).
- **reviewFocusAreas**: per repo type (app: flow/onboarding/errors/config/release; api: contract/errors/auth/limits/deploy; docs/library/monorepo/unknown variants).
- **candidateAcceptanceItems**: purpose clarity, build/test discoverable, env vars documented without exposing secrets, main flows have checks, error/edge states, release readiness.
- **missingQuestions**: 3–6, with type-specific additions; **PR URL** adds "review the PR change or the whole repo?" (prioritized so it survives the 6-cap).
- **confidence**: `high` for recognized type, `medium` for parsed-but-unknown, `low` for unparseable.
- `SAMPLE_GITHUB_REPO = example/ai-built-task-app` (fictional).

## UI — `/projects/new/intake` (github_repo type only)
After "Create intake draft" with `GitHub repo` selected, a **"GitHub repo preview"** card shows normalized repo · owner · repository · repo URL · likely repo type · review focus areas · candidate acceptance items · missing questions · confidence. "Use example repo" button (populates input + deterministic parse only — no fetch). Labeled **"Preview only — no GitHub API, clone, or remote file fetch."** Other types unchanged; existing `/projects/new` untouched.

## Deterministic limitations (intentional)
Reasons from the repo *reference* only — no API, no clone, no file/package.json read, no dependency/security scan. Surfaces a *review plan + questions*, not findings about actual code.

## Verification
- `apps/dashboard`: **229/229** tests (+11 repo), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 6.18 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
GitHub API / clone / remote fetch / package.json fetch / dependency scan / security scan / central-plane / Anthropic / DB / migration / deploy / domain — none.

## Next
Stage 105 — Existing App Recovery Assessment.
