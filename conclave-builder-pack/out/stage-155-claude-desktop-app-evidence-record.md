# Stage 155 — Claude Desktop App-side Evidence Record

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (Stage 154~159 train, PR #153) · **Base:** `main` @ `de6f7e6`
**Type:** evidence record (docs-only). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

This is the durable record where Bae's actual Claude Desktop app-side evidence is
captured. Until that evidence is supplied, the record is honestly marked **Pending** —
Claude Desktop success is **not** claimed.

## 1. Goal
Provide a reusable, durable evidence record for the Claude Desktop app-side dogfood,
define the bar to move from Pending → Passed (Status A) or → Blocked (Status C), and
record the current status honestly.

## 2. Current evidence status
**Status B — Evidence intake prepared, manual app-side run pending.**

Terminal-side evidence is complete; Claude Desktop **app-side** evidence has not been
recorded yet. This will only change to Status A or C when Bae supplies actual app-side
evidence in §9.

## 3. What has been verified by terminal
On `main`/this branch (HEAD of the train), re-verified this stage:
- `build` ✓
- `smoke:basic` → exit 0 (mode basic_only, 9 tools, network/credentials not required)
- `smoke:basic:stdio` → exit 0 (real process: initialize, tools/list = 9, 3 tool calls)
- `qa:basic-tools` → exit 0 (9 tools + snapshot chaining + malformed + sensitive omission)
- `print:claude-desktop-basic-config` → valid Basic-only config (empty `env`, no credentials)
- mcp-workspace tests **74/74**, monorepo typecheck **57/57**

## 4. What remains manual
Only Bae can record these (GUI, not driveable from this terminal):
- actual Claude Desktop app **restart** after adding the `simsa-basic` entry
- actual app-side **tool discovery** (the Simsa Basic tools appearing in the app)
- actual app-side **tool call output** (preview + handoff responses in the app)
- absence of a **credential prompt** and of **connected/risky tools** in the app UI

## 5. Evidence required for Status A (passed)
Recorded evidence that:
- Claude Desktop recognizes the local `simsa-basic` server.
- Simsa Basic tools are visible or callable.
- At least **4** Basic tools are successfully invoked: `preview_acceptance_map`,
  `preview_stage_plan`, `preview_evidence_plan`, `create_web_app_handoff_link`.
- **No credential prompt** appears in Basic-only mode.
- Connected/risky tools are **not** visible; `run_pr_review` **not** visible;
  `post_pr_comment` **not** visible.
- Handoff link starts with `https://app.trysimsa.com/projects/new/intake`.
- No real token / private code / customer-confidential data is captured.

## 6. Evidence that triggers Status C (blocked)
- Claude Desktop cannot start the local MCP server.
- `simsa-basic` does not appear after restart.
- Tool discovery fails, or tool calls consistently fail.
- Basic-only mode asks for `CONCLAVE_USER_KEY`.
- Connected/risky tools appear in Basic-only mode (`run_pr_review` / `post_pr_comment`).
- Handoff leaks sensitive data.
- Payment / Stripe / hosted execution appears.

## 7. Evidence template
(Use the "Evidence template for Bae" in §8; mirrors the Stage 154 intake template.)

## 8. Redaction checklist
Before sharing evidence, redact:
- local usernames in absolute paths
- private repo names if needed
- screenshots containing unrelated private chats
- tokens · keys · private customer code · confidential customer data · real
  authorization headers

Do not share secrets of any kind.

## 9. Current recorded evidence

**Status: Pending**

No Bae app-side evidence has been supplied in this stage yet.

### Evidence template for Bae
```text
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

## 10. Stage 155 decision
**Option A — Evidence record created, app-side evidence pending.** The record is ready;
Claude Desktop app-side status remains **Status B — prepared, pending Bae manual run**.
Publish stays held.

## 11. Recommended next stage
**Stage 156 — Claude Desktop Evidence Review / Gap Analysis** (once Bae fills §9: review
the evidence against the Status A bar, flag any gaps/blockers, and decide whether the
dogfood is complete enough to inform a publish-readiness decision at Stage 159).
**Do not merge** the train PR until the Stage 159 checkpoint + Bae approval.
