# @simsa/smoke-verifier

Playwright-driven smoke checks against a live deploy URL after autofix
push. Closes the gap between "build + tests pass" and "user-facing flows
actually work".

## Why

Conclave's existing autofix loop verifies:

- ✅ `pnpm build` succeeds
- ✅ `pnpm test` passes
- ❌ **the deployed app actually loads**

That last one is the gap. Real failures we've seen in the wild:

- Supabase free-tier auto-paused → `TypeError: fetch failed` on every
  API call (eventbadge, 2026-05-07)
- Env var missing on Vercel after migration
- Third-party API quota hit
- DB migration not applied to remote
- `next.config.mjs` change broke the prod build but not the local one

A 30-second Playwright smoke against the real deploy preview catches
all of those before the verdict ships to the user.

## Quick start

Add `.conclave/smoke.yaml` to your repo:

```yaml
# Smoke checks for eventbadge — runs after every autofix push, against
# the deploy preview URL.
steps:
  - name: home page loads
    goto: /
  - expect-status: 200
  - expect-text:
      text: "이벤트 만들기"

  - name: create-event flow loads
    goto: /events/new
  - expect-status: 200
  - expect-text:
      selector: "form"
      visible: true
```

Conclave's autofix pipeline reads it (when present) and runs the steps
against the freshly-deployed preview URL after `git push`. The result
becomes part of the cycle-end report:

```
✅ Build + tests passed (cycle 1/3)
✅ Smoke verified live (3/3 steps)
   ✓ home page loads (200)
   ✓ create-event flow loads (200)
   ✓ form visible
```

Or, if smoke fails:

```
✅ Build + tests passed (cycle 1/3)
❌ Smoke broken on live deploy
   ✗ home page loads — got 503, want 200
   ⊘ create-event flow loads (skipped after halt)
→ Cycle marked as deploy-broken — handing back to human
```

## Step kinds

| Step | Effect |
|---|---|
| `goto: <path>` | Navigate to `<base-url><path>` |
| `expect-status: <N>` | Most-recent goto must have returned `N` |
| `expect-text: { text, selector?, visible? }` | Selector contains text, OR page contains text |
| `click: <selector>` | Playwright `page.click(selector)` |
| `fill: { selector, value }` | Playwright `page.fill` |
| `wait-for: <selector>` | `page.waitForSelector` (with optional `timeoutMs`) |

## Config keys

```yaml
stepTimeoutMs: 15000      # per-step timeout (default 15s)
continueOnFailure: false  # halt on first failure (default) vs collect all
userAgent: "Conclave AI smoke verifier"
steps: [...]
```

## AI Slop check (v2)

Beyond pass/fail steps, smoke verifier scans deployed HTML for known
LLM placeholder leakage:

- `// TODO: implement` left in source
- `Lorem ipsum` placeholder text
- `your-api-key` / `your-secret` literal strings
- `<INSERT_X>` markers
- `I would suggest...`, `This is a placeholder` AI commentary

Hits surface in the report alongside step failures. Useful for catching
worker-generated changes that "look complete" but contain placeholder
content.

## Wiring into autofix-pipeline

Hook is opt-in via `.conclave/smoke.yaml` presence. When file is absent,
smoke verification is skipped silently and the cycle behaves as today
(build + tests only).

## Why not just use Vercel deploy preview's built-in checks?

Vercel doesn't run e2e tests on previews — it just serves the static
build. Smoke verifier specifically tests the **live runtime** behavior
of the user-facing flows that are most often broken by autofix.
