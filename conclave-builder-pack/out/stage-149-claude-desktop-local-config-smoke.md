> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 149 — Claude Desktop Local Config Smoke

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (Stage 148~153 train, PR #152) · **Base:** `main` @ `481fd72`
**Type:** private dogfood preparation. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Prepare and validate the **Claude Desktop local MCP config smoke** for Simsa MCP
Basic: verify the local build/path, generate a safe Basic-only config, and produce an
operator checklist + evidence template so **Bae** can run the app-side smoke. This
stage does **not** claim Claude Desktop success — that requires Bae to update the app
config, restart, and confirm tool discovery/calls.

## 2. What the terminal can verify (done here)
- The package **builds** and the required runtime files exist in `dist`.
- `smoke:basic` passes (Basic-only registration + dispatch, no creds/network).
- A config helper resolves the **absolute path** to `dist/index.js` for this checkout
  and prints a Basic-only config with **empty `env`** and **no credentials**.

## 3. What Bae must verify manually (app-side)
Terminal cannot prove Claude Desktop integration. Bae must: add the `simsa-basic`
entry to Claude Desktop's MCP configuration, **restart** the app, open a new chat, and
confirm the tools are discovered/callable and that **no credential prompt** and **no
connected/risky tools** appear in Basic-only mode. Do not treat this stage as a full
Claude Desktop pass until Bae records the evidence in §9.

## 4. Build / path verification (terminal, this checkout)
```bash
pnpm --filter @conclave-ai/mcp-workspace build
pnpm --filter @conclave-ai/mcp-workspace smoke:basic
```
Confirmed present: `dist/index.js`, `dist/server.js`,
`dist/mcp-basic-preview-tools.mjs`, `dist/mcp-basic-tools.mjs`.
`smoke:basic` → `mode: basic_only · tools: 9 · network: not required · credentials: not required` (exit 0).

## 5. Local config JSON
Generate the exact config for your machine (resolves the absolute path automatically):
```bash
pnpm --filter @conclave-ai/mcp-workspace print:claude-desktop-basic-config
```
It prints (path shown here as a placeholder; the helper inserts your real absolute path):
```json
{
  "mcpServers": {
    "simsa-basic": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/conclave-ai/packages/mcp-workspace/dist/index.js"
      ],
      "env": {}
    }
  }
}
```
The helper (`scripts/print-claude-desktop-basic-config.mjs`) is **read-only**: it
resolves the path, errors clearly if `dist/index.js` is missing (run the build first),
prints JSON with empty `env`, includes **no credentials**, and **does not modify** any
Claude Desktop config file. On Windows the path is emitted with escaped backslashes
(valid JSON); macOS/Linux use forward slashes.

> Open Claude Desktop's MCP/server configuration and add a server entry equivalent to
> the JSON above. The exact settings location or config file path may vary by OS and
> Claude Desktop version.

## 6. Operator checklist (for Bae)
1. Pull the latest train branch.
2. Run `pnpm install` if dependencies changed.
3. `pnpm --filter @conclave-ai/mcp-workspace build`.
4. `pnpm --filter @conclave-ai/mcp-workspace smoke:basic` (expect exit 0, 9 tools).
5. `pnpm --filter @conclave-ai/mcp-workspace print:claude-desktop-basic-config` and copy the JSON.
6. Add the `simsa-basic` server entry to Claude Desktop's MCP configuration.
7. Restart Claude Desktop.
8. Open a new chat.
9. Confirm the Simsa Basic tools are visible or callable.
10. Ask for an acceptance map from a safe sample idea (see §7).
11. Ask for a handoff link.
12. Confirm **no credential prompt** appears.
13. Confirm **no connected/risky tools** (`run_pr_review`, `post_pr_comment`, etc.) appear in Basic-only mode.
14. Capture pass/fail evidence (§9).

## 7. Manual test prompts (safe, no private data)
```text
Use Simsa Basic to create an acceptance map for this product idea:
"Build a small landing page for an AI software review tool. It should explain the product, show three use cases, and include a request-access form."
```
Then:
```text
Use Simsa Basic to create a stage plan from the same idea.
```
Then:
```text
Use Simsa Basic to create a Simsa Web App handoff link for this preview.
```

## 8. Expected results
- Acceptance map preview appears; stage plan preview appears.
- Handoff link starts with `https://app.trysimsa.com/projects/new/intake`.
- `requiresPayment: false`, `mutatesState: false`, `usesHostedExecution: false`.
- No credentials requested; no connected/risky tools in Basic-only mode.

## 9. Evidence template
```text
## Claude Desktop Local Config Smoke Evidence

Date/time:
OS:
Node version:
Repo commit:
Build result:
smoke:basic result:
Config method:            (print:claude-desktop-basic-config / manual)
Server path:              (absolute path; redact home dir if sharing)
Claude Desktop restarted: yes/no
Tools visible/callable:   yes/no
Tool list observed:
Acceptance map prompt result:
Stage plan prompt result:
Handoff link result:
Boundary metadata observed:
Unexpected connected tools visible: yes/no
Credential prompt shown:  yes/no
Errors/warnings:
Pass/fail:
Notes:
```
Do not include real tokens or private customer content.

## 10. Known limitations
- The terminal validates build/path/config/smoke only; **app-side discovery and tool
  calls must be confirmed by Bae** in Claude Desktop. Claude Desktop success is **not**
  asserted here.
- Exact Claude Desktop config file location is intentionally **not** claimed (varies by
  OS/version); guidance is generic.
- This is `node dist/index.js` via **local absolute path** — not a registry install
  (the package remains unpublished).

## 11. Stage 149 decision
**Option A — Ready for Bae manual Claude Desktop smoke.** Terminal build, path, config
generation, and `smoke:basic` all pass; the operator checklist + evidence template are
ready. No publish.

## 12. Recommended next stage
**Stage 150 — Claude Code / Terminal Local Smoke** (validate the same Basic-only server
from the Claude Code / terminal MCP path, which is more terminal-driven and can capture
more evidence automatically). **Do not merge** the train PR until the Stage 153
checkpoint + Bae approval.
