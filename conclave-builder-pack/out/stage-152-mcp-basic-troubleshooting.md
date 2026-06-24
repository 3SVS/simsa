# Stage 152 — Failure / Troubleshooting Docs

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (Stage 148~153 train, PR #152) · **Base:** `main` @ `481fd72`
**Type:** documentation. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Give a private-dogfood operator a runbook to diagnose the common MCP Basic failures —
build/path, host can't start the server, tools missing/extra, preview/handoff call
problems, sensitive-field omission, and credential/connected/publish/payment confusion
— each with Symptom / Likely cause / Check / Fix / Safety note. Companion entries are
added to the package README `## Troubleshooting`.

## 2. Troubleshooting coverage
15 entries (mirrored in `packages/mcp-workspace/README.md` → `## Troubleshooting`):

### 1. `dist/index.js` not found
- **Symptom:** host/smoke reports the entry is missing.
- **Likely cause:** the package was not built.
- **Check:** `ls packages/mcp-workspace/dist/index.js`.
- **Fix:** `pnpm --filter @conclave-ai/mcp-workspace build`.
- **Safety note:** don't hand-edit `dist/`; rebuild instead.

### 2. `smoke:basic` fails
- **Symptom:** the in-process smoke prints `FAILED` / non-zero exit.
- **Check:** `pnpm --filter @conclave-ai/mcp-workspace build` then `… smoke:basic`.
- **Fix:** build first, re-run. If it still fails, **do not** attempt host config yet.
- **Safety note:** a failing local smoke means the host will also fail — fix locally first.

### 3. `smoke:basic:stdio` fails
- **Symptom:** the real-process stdio smoke fails or hangs.
- **Check:** `pnpm --filter @conclave-ai/mcp-workspace smoke:basic:stdio`.
- **Fix:** confirm Node version, build output, and the local absolute path. Do **not**
  proceed to GUI host dogfood until stdio smoke passes.
- **Safety note:** don't add credentials to "make it work" — Basic-only needs none.

### 4. Claude Desktop cannot see `simsa-basic`
- **Likely cause:** wrong absolute path · build not run · app not restarted · config
  saved in the wrong/inactive host config · invalid JSON.
- **Fix:** regenerate with `print:claude-desktop-basic-config`, rebuild, **restart**
  Claude Desktop, open a **new** chat.
- **Safety note:** the config helper never writes the host file — paste it yourself and
  validate the JSON.

### 5. Host shows only 9 tools
- **Expected** in Basic-only mode. With empty `env`, exactly the 9 Basic tools appear.
- **Fix:** none needed. To get connected tools, intentionally set `CONCLAVE_USER_KEY`.

### 6. Host shows connected tools in Basic-only mode — **BLOCKER**
- **Likely cause:** `CONCLAVE_USER_KEY` (or another connected-mode var) is set.
- **Fix:** remove `env` from the local MCP config and restart the host.
- **Safety note:** if it persists with empty `env`, **stop and report** — do not publish.

### 7. `run_pr_review` appears in Basic-only mode — **BLOCKER**
- **Fix:** stop dogfood and report. Basic-only must not expose execution-like tools.

### 8. `post_pr_comment` appears unexpectedly
- **Explain:** it should appear **only** in connected mode with post-comment config
  explicitly enabled, and still requires `confirm:true`. In Basic-only it must be absent.

### 9. Tool call returns `missing_input` or `invalid_type`
- **Likely cause:** empty input, or an unsupported `type`.
- **Fix:** provide a safe product-idea summary and a `type` such as `idea` (allowed:
  `idea`, `prd`, `product_url`, `github_repo`, `pull_request`, `ai_built_app`).
- **Safety note:** this is a safe, expected validation response — not a crash.

### 10. Snapshot tools return a sparse/empty preview
- **Likely cause:** the snapshot tool received too little prior context.
- **Fix:** call `preview_acceptance_map`, `preview_stage_plan`,
  `preview_agent_run_plan`, `preview_evidence_plan` first, then pass their previews into
  the graph/blocker/memory/template tools.

### 11. Handoff link omits `title`/`summary`
- **Likely cause:** the input looked like a token/secret/authorization header/private key.
- **Fix:** use a safe summary without secret-like patterns. **Do not** force secrets
  into a handoff URL — omission is the tool protecting you.

### 12. Handoff link does not save anything
- **Expected.** The link only opens the Simsa Web App with safe query context — it
  does not save workflows, create accounts, start sessions, or trigger payment.

### 13. Operator expects npm install from registry
- **Explain:** the package is **not published** yet. Use the local absolute-path config
  only (`node …/dist/index.js`).

### 14. Operator thinks payment/Stripe is required
- **Explain:** MCP Basic requires **no payment**. Payment provider is **TBD** and a
  Korea-compatible provider evaluation is separate. **Stripe is not assumed.**

### 15. Host asks for credentials
- **Explain:** Basic-only mode requires **no credentials**. If credentials are
  requested, check the host config and remove `env` entries, then restart.

## 3. Diagnostic commands
```bash
pnpm --filter @conclave-ai/mcp-workspace build
pnpm --filter @conclave-ai/mcp-workspace smoke:basic
pnpm --filter @conclave-ai/mcp-workspace smoke:basic:stdio
pnpm --filter @conclave-ai/mcp-workspace qa:basic-tools
pnpm --filter @conclave-ai/mcp-workspace print:claude-desktop-basic-config
```

## 4. Basic-only expected vs blocker behavior
- **Expected:** exactly 9 tools; no credentials; no network; `missing_input`/
  `invalid_type` for bad input; sparse previews when snapshot context is thin; handoff
  saves nothing.
- **Blocker:** connected tools or `run_pr_review`/`post_pr_comment` visible with empty
  `env`; any Basic tool calling network/central-plane; credential prompt in Basic-only;
  handoff URL containing sensitive input; payment/Stripe/hosted-execution behavior;
  server crash on malformed input.

## 5. Handoff link troubleshooting
Omission of `title`/`summary`/`previewId` is **by design** when input matches secret
patterns (entries #11, #12). The link is safe-context only and persists nothing; a
"nothing happened" result after clicking is the Web App opening with prefilled query —
not a failure.

## 6. Connected / risky tool troubleshooting
Connected tools (entries #6–#8) require `CONCLAVE_USER_KEY`. Their appearance in
Basic-only mode is a publish blocker. `post_pr_comment` additionally needs
`CONCLAVE_ENABLE_PR_COMMENT_POST=true` **and** `confirm:true` at call time.

## 7. Publish / payment misconceptions
Entries #13–#14: not published (local path only); no payment, provider TBD,
Korea-compatible first, Stripe not assumed.

## 8. Safety notes
- Do not paste real tokens into prompts or config.
- Do not add `CONCLAVE_USER_KEY` unless intentionally testing connected mode.
- Do not enable `post_pr_comment` during Basic dogfood.
- Do not publish the package.
- Do not assume Stripe/payment support.
- Do not use private customer code as test input.

## 9. Stage 152 decision
**Failure and troubleshooting docs are ready for private dogfood operators.** README
`## Troubleshooting` expanded with the 15 entries; this stage doc is the operator
runbook. No publish.

## 10. Recommended next stage
**Stage 153 — Private Dogfood Checkpoint** (train summary + merge/publish decision for
PR #152, pending Bae approval; gather any host evidence). **Do not merge** until then.
