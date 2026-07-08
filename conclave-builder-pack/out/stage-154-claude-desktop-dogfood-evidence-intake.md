> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 154 — Claude Desktop App-side Dogfood Evidence Intake

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (Stage 154~159 train) · **Base:** `main` @ `de6f7e6`
**Type:** evidence intake (docs-only). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

This stage adds **no product functionality**. It packages an evidence-intake kit so Bae
can run the **actual Claude Desktop app-side** dogfood of Simsa MCP Basic and record
the result. Until Bae runs it, app-side status stays **Status B (pending)** — success
is **not** claimed.

## 1. Goal
Prepare and capture Claude Desktop app-side dogfood evidence: a step-by-step operator
checklist, safe test prompts, a reusable evidence template, pass/fail criteria,
classification statuses, and redaction/safety rules.

## 2. Current MCP Basic state
- MCP Basic **9 tools** registered in the server runtime; Basic-only mode works without
  credentials (merged Stage 141~147, main `de6f7e6`).
- Terminal `smoke:basic`, real-process `smoke:basic:stdio`, and `qa:basic-tools` all
  pass (Stage 150~151).
- Troubleshooting/operator docs ready (Stage 152).
- **Claude Desktop app-side evidence: pending.** MCP package remains **unpublished**.

## 3. Local pre-check results (this checkout, terminal)
- `build` ✓
- `smoke:basic` → exit 0 (mode basic_only, 9 tools, network/credentials not required)
- `smoke:basic:stdio` → exit 0 (initialize ok, 9 tools, 3 tool calls)
- `qa:basic-tools` → exit 0 (9 tools + chaining + malformed + sensitive omission)
- `print:claude-desktop-basic-config` → prints a valid Basic-only config with
  `command:"node"`, the absolute path to `dist/index.js`, and **`env: {}`** — **no
  credentials printed**.

## 4. Claude Desktop operator checklist (for Bae)
1. Pull the latest `main` (or this Stage 154 branch).
2. Run `pnpm install` if dependencies changed.
3. `pnpm --filter @conclave-ai/mcp-workspace build`.
4. `pnpm --filter @conclave-ai/mcp-workspace smoke:basic` (expect exit 0, 9 tools).
5. `pnpm --filter @conclave-ai/mcp-workspace smoke:basic:stdio` (expect exit 0).
6. `pnpm --filter @conclave-ai/mcp-workspace qa:basic-tools` (expect exit 0).
7. `pnpm --filter @conclave-ai/mcp-workspace print:claude-desktop-basic-config`.
8. Copy the generated `simsa-basic` config.
9. Add it to Claude Desktop's MCP/server configuration.
10. Keep `env` **empty** for Basic-only mode.
11. **Restart** Claude Desktop.
12. Open a **new** chat.
13. Confirm the Simsa Basic tools are visible or callable.
14. Confirm **no credential prompt** appears.
15. Confirm **connected tools do not appear** in Basic-only mode.
16. Run the safe prompts (§6).
17. Capture evidence using the template (§7).
18. Redact paths or local usernames if sharing screenshots.
19. Do **not** paste real tokens / private code.

## 5. Local config guidance
Generate the per-machine config (resolves the absolute path automatically; never
writes the host file):
```bash
pnpm --filter @conclave-ai/mcp-workspace print:claude-desktop-basic-config
```
It prints (path shown here as a placeholder; the helper inserts your real absolute path):
```json
{
  "mcpServers": {
    "simsa-basic": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/conclave-ai/packages/mcp-workspace/dist/index.js"],
      "env": {}
    }
  }
}
```
> The exact Claude Desktop settings location or config file path may vary by OS and
> Claude Desktop version. Add a server entry equivalent to the JSON above in that
> host's MCP configuration file.

## 6. Safe test prompts (no private data)
Scenario:
> Build a small landing page for an AI software review tool. It should explain the
> product, show three use cases, and include a request-access form.

1. `Use Simsa Basic to create an acceptance map for this product idea: "<scenario>"`
2. `Use Simsa Basic to create a stage plan from the same idea.`
3. `Use Simsa Basic to create an agent run plan from the same idea.`
4. `Use Simsa Basic to create an evidence plan from the same idea.`
5. `Use Simsa Basic to create a Simsa Web App handoff link for this preview.`

Expected: preview responses appear; boundary metadata appears or is inferable;
`requiresPayment:false`, `mutatesState:false`, `usesHostedExecution:false`; handoff URL
starts with `https://app.trysimsa.com/projects/new/intake`; no credentials requested;
no connected/risky tools exposed.

## 7. Evidence template
```text
# Claude Desktop App-side Dogfood Evidence

Date/time:
Tester:
OS:
Claude Desktop version:
Node version:
Repo commit:
Branch:
Build result:
smoke:basic result:
smoke:basic:stdio result:
qa:basic-tools result:
Config helper result:
Config method:
Server path redacted: yes/no
Claude Desktop restarted: yes/no

Tool discovery:
- Simsa Basic tools visible/callable: yes/no
- Number of Simsa Basic tools observed:
- Connected tools observed in Basic-only mode: yes/no
- run_pr_review observed: yes/no
- post_pr_comment observed: yes/no
- Credential prompt shown: yes/no

Prompt results:
1. acceptance map:
2. stage plan:
3. agent run plan:
4. evidence plan:
5. handoff link:

Boundary checks:
- requiresPayment false observed: yes/no/unclear
- mutatesState false observed: yes/no/unclear
- usesHostedExecution false observed: yes/no/unclear
- handoff createsPersistence false observed: yes/no/unclear
- handoff containsSecrets false observed: yes/no/unclear

Errors/warnings:
Screenshots or text snippets captured:
Redactions applied:
Pass/fail:
Notes:
```

## 8. Pass/fail criteria
**Pass:** Claude Desktop recognizes the local `simsa-basic` server; Simsa Basic tools
are visible/callable; at least acceptance map, stage plan, evidence plan, and handoff
link work; no credentials required; no connected/risky tools visible in Basic-only
mode; no secret/private input captured.

**Fail / blocker:** Claude Desktop can't start the local server; tools don't appear;
tool calls fail consistently; Basic-only asks for `CONCLAVE_USER_KEY`; `run_pr_review`
or `post_pr_comment` appears in Basic-only mode; handoff leaks sensitive data;
payment/Stripe/hosted execution appears.

## 9. Evidence classification
- **Status A — passed:** Bae's evidence shows simsa-basic recognized, ≥4 preview tools
  callable, handoff works, no credential prompt, no connected/risky tools, no
  secrets/private code captured.
- **Status B — intake prepared, manual run pending:** this stage's state (checklist +
  template ready; Bae has not yet run the app-side test).
- **Status C — blocked:** app-side config cannot start or tools cannot be discovered.

**Current status: B — evidence intake prepared, manual app-side run pending.**

## 10. Redaction and safety rules
- Do not paste real tokens into prompts.
- Do not paste private customer code; do not capture private repo contents.
- Redact local usernames / absolute paths if sharing screenshots.
- Keep Basic-only `env` empty.
- Do not add `CONCLAVE_USER_KEY` unless intentionally testing connected mode in a later stage.
- Do not enable `post_pr_comment`.
- Do not publish the package.

## 11. Stage 154 decision
**Option A — Evidence intake ready.** The Claude Desktop evidence-intake package
(checklist + config helper + prompts + template + criteria + redaction rules) is ready;
Bae can run the manual app-side dogfood. App-side evidence remains **Status B (pending)**.

## 12. Recommended next stage
**Stage 155 — Record Bae Claude Desktop App-side Evidence** (paste Bae's completed
evidence template into a recorded artifact, classify Status A/C, and note any
follow-ups). **Do not merge** the train PR until the Stage 159 checkpoint + Bae approval.
