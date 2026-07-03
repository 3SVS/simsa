# Release process

All 18 packages version-bump + publish in lockstep (monorepo pre-1.0
policy). The `.github/workflows/release.yml` GitHub Action does the
work — you almost never run `npm publish` locally.

## Prerequisites (one-time)

- `NPM_TOKEN` secret on the GitHub repo — Automation-type token scoped
  to the `@simsa` org with Publish permission. Rotate annually.
- `ORCHESTRATOR_PAT` secret on the GitHub repo — a Personal Access
  Token with `repo` + `workflow` scopes. **REQUIRED** because PIA-1's
  `bump-workflow-cli-version.mjs` step modifies
  `.github/workflows/{review,rework,merge}.yml` to keep the
  `cli-version` default in lockstep with the just-bumped
  `packages/cli/package.json` `.version`. The default `GITHUB_TOKEN`
  cannot push commits that touch workflow files (GitHub blocks
  workflows from self-rewriting by design). Without the PAT, the
  bump succeeds locally on the runner but `git push` is rejected
  with "refusing to allow a GitHub App to create or update workflow
  ...". Caught LIVE on release run #25104136096 / cli@0.14.1 attempt.
  - Create at https://github.com/settings/tokens/new (Classic, scopes
    `repo` + `workflow`) and register with
    `gh secret set ORCHESTRATOR_PAT --repo <org>/<repo> --body "ghp_..."`.
- Workflow permissions: `Settings → Actions → General → Workflow
  permissions` set to **Read and write** (needed for the commit + tag
  the workflow pushes back to `main`).
- Manual (`workflow_dispatch`) runs are **gated to `main`**. The
  workflow fails fast with an actionable error if dispatched from a
  feature branch — guards against accidentally pushing that branch
  into `main` via the release pipeline.

## Option A — Ship from the GitHub UI (recommended)

1. `Actions → release → Run workflow`.
2. Branch: `main`.
3. Bump: `patch` (bug fix), `minor` (backward-compat feature), or
   `major` (breaking change).
4. Click **Run workflow**.

What it does:
- Checks out `main`.
- Runs `pnpm install --frozen-lockfile`, `typecheck`, `build`, `test`.
- Bumps every package under `packages/*` via
  `pnpm -r exec npm version <bump> --no-git-tag-version`.
- Commits `chore(release): v<new-version>` + tags `v<new-version>` +
  pushes both back to `main`.
- Publishes via `scripts/release/publish-unpublished.mjs`, which wraps
  `pnpm -r --filter <new-pkgs> publish --access public --no-git-checks`
  but first queries `npm view <name>@<version>` per workspace package
  and skips the ones already on the registry. This makes the workflow
  idempotent when its own tag pushes (`v$X.Y.Z` and the floating
  `v0.4` tag) re-fire it. `NPM_CONFIG_PROVENANCE` is enabled when the
  repo is public.

## Option B — Cut the tag locally

Use this when you want to review + commit the version bump manually
before releasing.

```bash
pnpm -r --filter "./packages/*" exec npm version patch --no-git-tag-version
git add -A
git commit -m "chore(release): v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

The tag push triggers the workflow's second path — it skips the bump
step (already done) and goes straight to publish.

## Verification

After the workflow finishes:

```bash
npm view @simsa/core versions --json   # should show the new version
npm view @simsa/cli version            # should match
```

Every package publishes in lockstep, so checking core + cli is enough
to confirm the release landed.

## Troubleshooting

- **Workflow fails at "Publish to npm" with 401/403** → `NPM_TOKEN`
  secret is missing, expired, or doesn't have `@simsa` scope.
- **Workflow fails at bump commit push** → repo workflow permissions
  aren't "Read and write." Fix in repo settings.
- **"All package versions already on registry — skipping publish"** →
  expected. `publish-unpublished.mjs` saw every workspace package
  already at the requested version on npm. Most common cause: this
  workflow run was triggered by its own tag push (the `workflow_dispatch`
  run pushed `v$X.Y.Z` + the floating `v0.4`, both of which re-fire the
  `push: tags: ["v*"]` trigger). The re-runs exit 0 cleanly.
