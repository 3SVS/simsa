> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 156 — Claude Desktop Evidence Review / Gap Analysis

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (Stage 154~159 train, PR #153) · **Base:** `main` @ `de6f7e6`
**Type:** evidence review / gap analysis (docs-only). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

This stage provides the structure to **review** Bae's Claude Desktop app-side evidence
against the Status A bar and to **enumerate the exact gaps** while it is pending. No
app-side success is claimed.

## 1. Goal
Define how to review Bae's Claude Desktop evidence, score each requirement
(PASS/PENDING/BLOCKED/NOT_APPLICABLE), map current evidence to the Status A
requirements, identify missing gaps, and attach a remediation playbook — keeping MCP
publish held.

## 2. Current evidence status
> **Superseded by Stage 157 (2026-06-24):** Bae then supplied actual app-side evidence;
> the core flow is now **Status A (with caveats)** — see
> `stage-157-claude-desktop-evidence-update-mcp-branding-gap.md`. The matrix below was
> written while evidence was still pending; the review method, gap categories (G1–G8),
> and remediation playbook remain valid for any future re-runs.

**Status B — Evidence intake prepared, manual app-side run pending.** *(original state
of this stage; see supersede note above.)* No Bae app-side evidence had been supplied;
terminal evidence is complete but **does not** replace actual Claude Desktop app-side
evidence.

## 3. Review method
When Bae fills the Stage 155 §9 template, score each row of the §4 matrix:
- **PASS** — evidence supplied and meets the requirement.
- **PENDING** — evidence not yet supplied.
- **BLOCKED** — evidence supplied and shows failure.
- **NOT_APPLICABLE** — not required for Basic-only dogfood.

Any **BLOCKED** row → classify the run Status C and route to the matching gap
category (§6) + remediation (§7). All app-side rows PASS (and no BLOCKED) → Status A.
No numeric scores.

## 4. Evidence requirements matrix
| # | Requirement | Evidence needed | Current evidence | Status | Gap | Remediation |
|---|-------------|-----------------|------------------|--------|-----|-------------|
| 1 | Claude Desktop recognizes local `simsa-basic` | server appears in host MCP list after restart | none supplied | **PENDING** | G1 | Bae runs Stage 154 template |
| 2 | Basic tools visible/callable | tool list or successful call in app | none | **PENDING** | G1 | Bae runs template |
| 3 | 9 Basic tools observed (or equivalent call access) | tool count / callable set | none | **PENDING** | G1 | Bae runs template |
| 4 | `preview_acceptance_map` app-side call succeeds | app response (kind acceptance_map) | none | **PENDING** | G1 | Bae runs template |
| 5 | `preview_stage_plan` app-side call succeeds | app response (kind stage_plan) | none | **PENDING** | G1 | Bae runs template |
| 6 | `preview_evidence_plan` app-side call succeeds | app response (kind evidence_plan) | none | **PENDING** | G1 | Bae runs template |
| 7 | `create_web_app_handoff_link` app-side call succeeds | app response (kind web_app_handoff_link) | none | **PENDING** | G1 | Bae runs template |
| 8 | Handoff URL starts with `https://app.trysimsa.com/projects/new/intake` | URL in app output | none | **PENDING** | G1 | Bae runs template |
| 9 | No credential prompt in Basic-only mode | observation/screenshot | none | **PENDING** | G1/G4 | Bae runs template; if prompted → G4 |
| 10 | Connected tools not visible in Basic-only | tool list observation | none | **PENDING** | G1/G5 | Bae runs template; if visible → G5 |
| 11 | `run_pr_review` not visible | tool list observation | none | **PENDING** | G1/G5 | as above |
| 12 | `post_pr_comment` not visible | tool list observation | none | **PENDING** | G1/G5 | as above |
| 13 | No token/private code/confidential data captured | redaction confirmation | none | **PENDING** | G1 | Bae runs template + redaction checklist |
| 14 | Boundary metadata visible or inferable | app output / inferred from tool kind | none | **PENDING** | G1 | Bae runs template |
| 15 | Errors/warnings recorded | template fields | none | **PENDING** | G1/G8 | Bae records OS/Node/CD version + non-secret errors |

Terminal cross-reference (already PASS, for comparison, **not** a substitute for
app-side rows): `smoke:basic`, `smoke:basic:stdio` (initialize + tools/list = 9 +
3 calls), `qa:basic-tools` (9 tools + chaining + malformed + sensitive omission), all
exit 0; `print:claude-desktop-basic-config` emits a valid Basic-only config (empty
`env`, no credentials).

## 5. Current gap analysis
App-side evidence status remains **Status B — prepared, pending Bae manual run**.
Terminal evidence is complete, but it does not replace actual Claude Desktop app-side
evidence. Open gaps (all **G1 — missing app-side evidence**):
- Pending: app **restart** evidence
- Pending: app-side **tool discovery** evidence
- Pending: app-side **tool-call** evidence (items 4–8)
- Pending: **credential prompt absence** evidence
- Pending: **connected/risky tool absence** evidence (items 10–12)

## 6. Gap categories
- **G1** — Missing app-side evidence
- **G2** — Tool discovery issue
- **G3** — Tool call issue
- **G4** — Credential/env leak
- **G5** — Connected/risky tool exposure
- **G6** — Handoff/sensitive-data issue
- **G7** — Documentation/operator confusion
- **G8** — Host/version/environment issue

## 7. Remediation playbook
- **G1:** Bae runs the Claude Desktop dogfood checklist and fills the evidence template.
- **G2:** verify build, absolute path, config JSON, Claude Desktop restart, new chat/session.
- **G3:** compare terminal stdio QA output with the app-side error, capture the exact
  (non-secret) error text, test one tool at a time.
- **G4:** remove `env` from the Basic-only config, restart the host, rerun.
- **G5:** stop dogfood, inspect `env` and the registration plan — **publish blocker**.
- **G6:** test with a safe synthetic prompt, verify `omittedFields`/`warnings` behavior,
  do not force secret-like content into the URL.
- **G7:** update README / troubleshooting docs before the checkpoint.
- **G8:** record OS, Node version, Claude Desktop version, config method, exact
  non-secret error.

## 8. Publish readiness implication
**MCP publish remains held.** Reasons: terminal stdio and tool-by-tool QA passed;
private dogfood docs are ready; **Claude Desktop app-side evidence remains pending**.
Public publish should not proceed until app-side evidence is **Status A**, or an
explicit Bae override is recorded.

## 9. Stage 156 decision
**Option A — Gap analysis ready, app-side evidence pending.** The evidence review matrix
is ready; Claude Desktop app-side status remains **Status B** with **G1
missing-app-side-evidence** gaps. Publish held.

## 10. Recommended next stage
**Stage 157 — Claude Desktop Manual Evidence Pack / Operator Submission** (a clean,
copy-ready submission pack Bae fills once and returns, which Stage 158 folds into the
record and Stage 159 checkpoints). **Do not merge** the train PR until the Stage 159
checkpoint + Bae approval.
