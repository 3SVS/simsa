# Vercel Pro setup — allowing Conclave AI bot commits

Most Vercel projects (Hobby + default Pro settings) work with Conclave
AI out of the box — no configuration required. This page is only for
teams that have explicitly enabled stricter commit-author verification.

## When you need this

Symptoms:

- Conclave's autofix bot pushes a commit to your PR.
- The push triggers a Vercel preview deploy.
- Vercel responds with `Deployment Blocked: The deployment was blocked
  because the commit email <X> could not be matched to a GitHub account.`

This means your team has **"Verify Commit Authors"** turned on (Vercel
Pro / Enterprise feature). It rejects commits whose author email
cannot be matched to a GitHub user / org member.

## Why our commits are normally fine

Conclave AI's autofix bot authors commits as:

```
conclave-ai-code-council[bot]
3620556+conclave-ai-code-council[bot]@users.noreply.github.com
```

This is the canonical noreply email GitHub assigns to apps installed
via the GitHub Apps API. The exact same format Dependabot
(`49699333+dependabot[bot]@users.noreply.github.com`) and GitHub Actions
(`41898282+github-actions[bot]@users.noreply.github.com`) use. Vercel's
default "Verify Commit Authors" implementation recognises these as
valid GitHub identities.

## When it can still block

Some teams configure a stricter rule:

- "Only deploy commits authored by team members"
- Custom webhook gating that explicitly rejects bot accounts
- A misconfiguration where the author allow-list omits installed apps

In those cases:

### Option 1 — allow `conclave-ai-code-council[bot]` in Vercel settings

1. Vercel dashboard → your project → **Settings** → **Git**
2. Find the **"Deployment Authorization"** section (Pro+).
3. If you see an "Allowed Authors" or similar allow-list, add:
   - GitHub App: **Conclave AI Code Council** (or whichever name displays)
   - or the noreply email pattern
     `*+conclave-ai-code-council[bot]@users.noreply.github.com`
4. Save.

### Option 2 — turn off commit-author verification

If you don't need commit-author verification for any reason, the
simplest fix is:

1. Same Settings → Git page.
2. Toggle **"Verify Commit Authors"** off.
3. Save.

Trade-off: any committer (including external PR contributors) will be
able to trigger deploys. Most indie / small-team projects keep this off.

### Option 3 — disable Vercel for the bot

If you only want human-authored deploys and view bot commits as a
no-op for production, you can:

1. Settings → Git → **Ignored Build Step**.
2. Add a script that skips builds when the commit author is the
   conclave bot:
   ```bash
   if git log -1 --format="%ae" | grep -q "conclave-ai-code-council\[bot\]"; then
     echo "skip — conclave autofix commit"
     exit 0
   fi
   exit 1
   ```

Builds will fire only on non-bot commits; the bot's autofix commits
get reviewed by Conclave + merged but skip Vercel preview. The next
human commit triggers a normal deploy.

## Stuck PR right now? How to unblock

If you have a PR with a previously-stuck Conclave autofix commit:

- **Easiest**: push any new commit to the same branch. Vercel will
  deploy whatever the new HEAD is.
- **Or**: amend the existing commit author with the new format and
  force-push (needs git access):
  ```bash
  git commit --amend --no-edit \
    --author="conclave-ai-code-council[bot] <3620556+conclave-ai-code-council[bot]@users.noreply.github.com>"
  git push --force-with-lease
  ```
- **Or**: turn off "Verify Commit Authors" temporarily, redeploy, turn
  back on if you prefer.

## Netlify, Cloudflare Pages, Render

Same pattern, different UI:

- **Netlify**: Site settings → Build & deploy → **Build hooks** /
  **Deploy contexts**. Look for "Author verification" or similar.
- **Cloudflare Pages**: Pages project → Settings → Builds & deployments
  → **Branch deployments**. CF Pages doesn't enforce author
  verification by default.
- **Render**: Service settings → **Branch protection**. Disabled by
  default.

## Future: Conclave-side mitigations

We may add an opt-in `conclave-config.skip-deploy-on-autofix` flag in
a future release that adds the `[skip ci]` marker to autofix commit
messages. Most build systems (Vercel, Netlify, GitHub Actions) honour
this and skip deploys, eliminating the gate friction. Tracking issue:
to be filed.
