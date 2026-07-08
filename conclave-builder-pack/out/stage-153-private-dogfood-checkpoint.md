> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 153 — Private Dogfood Checkpoint

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (PR #152) · **Base:** `main` @ `481fd72` · **HEAD:** `04e27f4`
**Type:** checkpoint (decision-ready). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Train summary
The MCP Manual Host QA / Private Dogfood Train validates the merged MCP Basic runtime
(main `481fd72`) for private/local use **before** any public publish.
- **148** — manual host QA planning (hosts, config strategy, 9-tool matrix, pass/fail,
  evidence checklist, publish blockers).
- **149** — Claude Desktop local config smoke prep: read-only `print:claude-desktop-basic-config`
  helper (absolute path, empty `env`, no credentials, never writes the host file),
  operator checklist + evidence template.
- **150** — real out-of-process stdio MCP smoke (`smoke:basic:stdio`): initialize →
  tools/list → tools/call via the SDK client.
- **151** — tool-by-tool QA (`qa:basic-tools`): all 9 tools, snapshot chaining,
  malformed input, sensitive-field omission.
- **152** — failure/troubleshooting docs (operator runbook + README `## Troubleshooting`).
- **153** — this checkpoint.

## 2. Dogfood readiness summary
Local/terminal dogfood is **ready**: build + 3 smokes/QA pass deterministically; a
read-only config helper produces a correct Basic-only host config; an operator
checklist + evidence template + a 15-entry troubleshooting runbook are in place. The
only outstanding item is the **GUI app-side** Claude Desktop run, which only Bae can
perform.

## 3. Claude Desktop evidence status — **Status B (Prepared, pending Bae manual run)**
Terminal build/path/config/checklist are complete, but Bae has **not yet** run the
actual Claude Desktop app-side test (tool visibility in the app UI, no credential
prompt, no connected/risky tools). Claude Desktop success is **not** claimed.

## 4. Terminal stdio smoke results
`smoke:basic:stdio` (real child process, SDK `Client` + `StdioClientTransport`,
Basic-only) — **pass**: initialize ok, `tools/list` = exactly 9 Basic tools
(connected/`run_pr_review`/`post_pr_comment` absent), `tools/call` ok for
`preview_acceptance_map`, `preview_stage_plan`, `create_web_app_handoff_link` with
boundary preserved. Exit 0.

## 5. Tool-by-tool QA results
`qa:basic-tools` — **pass** for all 9 tools (`ok`+expected `kind`+boundary), snapshot
chaining (intake previews → graph/blocker/memory/template), malformed input safe
(`missing_input`/`invalid_type`/`{}`→ok, no crash), and sensitive-field omission
(fake secret-like title/summary omitted + warned; no literal token string in source).
Exit 0.

## 6. Troubleshooting / operator docs status
**Ready.** `stage-152-mcp-basic-troubleshooting.md` (15 Symptom/Cause/Check/Fix/Safety
entries) + README `## Troubleshooting` expansion + a diagnostics command block + safety
notes. Covers build/path, smoke failures, host can't see the server, expected
9-tools-only, connected/`run_pr_review`/`post_pr_comment` blockers, validation
responses, sparse snapshots, handoff omission/“saves nothing”, npm/payment
misconceptions, credential prompts.

## 7. Safety boundary audit
- Basic-only: 9 tools, **no** connected tools / `run_pr_review` / `post_pr_comment`;
  **no** credentials/network/central-plane; **no** payment/Stripe/hosted execution;
  handoff persists nothing, creates no account/session, omits sensitive fields.
- Connected mode (with `CONCLAVE_USER_KEY`) unchanged; `post_pr_comment` still gated by
  `enablePostComment` + `confirm:true`.
- No literal secret/token strings in added sources (fake fixtures built at runtime;
  scripts/test are not packaged).

## 8. Test / build / typecheck results
- mcp-workspace tests **74/74** ✓ · typecheck ✓ · build ✓.
- `smoke:basic`, `smoke:basic:stdio`, `qa:basic-tools` all **exit 0**.
- monorepo typecheck **57/57** ✓.
- workspace-preview unchanged in this train (last verified **186/186**); dashboard
  unaffected (no `apps/dashboard` change).

## 9. What is intentionally not implemented
No MCP publish / npm publish / version bump (`@conclave-ai/workspace-preview` private;
`@conclave-ai/mcp-workspace` `0.8.2`, unpublished). No payment/billing, no Stripe or any
payment-provider assumption (provider **TBD**, Korea-compatible first). No hosted
execution, no central-plane change, no DB migration, no deploy, no auth/login/session,
no server-side handoff storage, no domain/DNS, no token/secret output. No GUI app-side
Claude Desktop result is asserted (Status B).

## 10. Merge readiness
**PR #152 is ready to merge** (pending Bae approval). State **OPEN**, **MERGEABLE**,
mergeState **CLEAN**, CI green (`typecheck-build (20)` + `(22)` SUCCESS), HEAD `04e27f4`.
PR description covers Stage 148~153. The PR adds docs + local dev/QA tooling (smoke/QA
scripts, config helper, troubleshooting) only — no product runtime change beyond the
already-merged Stage 141~147.

## 11. Publish decision
**Do not publish MCP now.** Keep `@conclave-ai/workspace-preview` private and
`@conclave-ai/mcp-workspace` unpublished. Local/terminal dogfood evidence is strong, but
Claude Desktop app-side evidence is still pending (Status B); publication requires a
separate Bae-approved release train.

## 12. Required conclusions
- PR #152 is **ready** for merge (after Bae approval).
- MCP package **should NOT** be published now.
- Dogfood docs are **ready**.
- Terminal stdio smoke **passed**.
- Tool-by-tool QA **passed**.
- Claude Desktop manual app-side evidence **pending** (Status B).
- Dashboard deploy **NOT** required · central-plane deploy **NOT** required · migration
  **NOT** required.

## 13. Recommendation — **Option A: Ready to merge PR #152 after Bae approval (publish held)**
Post-merge: **no deploy**, **no MCP publish**, **no npm publish**, **no central-plane
deploy**, **no migration**. Production impact is **none** — the package stays
unpublished, and nothing in production consumes these dev scripts/docs. Claude Desktop
app-side evidence remains a known pending item before any public publish.

## 14. Recommended next action (after merge)
**Bae runs the Claude Desktop app-side manual dogfood** using the Stage 149 operator
checklist (`print:claude-desktop-basic-config` → add `simsa-basic` → restart → new chat
→ exercise tools → confirm no credential prompt / no connected tools) and shares the
evidence per the Stage 149 template.

## 15. Recommended next train
**MCP Private Dogfood Evidence / Claude Desktop App QA** (default) — capture the
real GUI app-side evidence and fold it into a publish-readiness decision. Alternatives:
MCP Publish Readiness / Release Planning · Auth/Workspace + Korea-compatible Payment
Planning · Outcome Persistence.
