> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 110 — Stage Plan to Agent Run Plan

**Date:** 2026-06-23
**Train:** Agent Workflow Train (Stage 110~116) · branch `feat/stage-110-agent-run-plan` · PR #144 (do not merge until Stage 116).

## Goal
Turn the Intake **Stage Plan** (Stage 107) into a deterministic **Agent Run Plan** — role-based work for builders / reviewers / fixers / verifiers / operators. Dashboard-local, **preview-only**: no agent execution, no backend, no DB, no persistence, no external API.

## Product principle
Simsa is not a coding agent. It shows *what each role should do next, what input they need, what evidence they should return, and which acceptance items the work connects to* — "Simsa tells builders and agents what to build, review, fix, compare, and verify next."

## Helper — `apps/dashboard/src/lib/intake-agent-run-plan.mjs` (+ `.d.mts`)
`buildAgentRunPlan({ type, rawInput }): AgentRunPlan` — pure, deterministic; **reuses** `buildIntakeStagePlan`. One task per stage.

`AgentRunPlan`: `{ intakeType, title, summary, tasks[], primaryRole, recommendedFirstTaskId, confidence }`.
`AgentRunTask`: `{ id (task-N), stageNumber, stageTitle, role, status, task, inputs[], acceptanceItems[], expectedEvidence[], recommendedTool, nextDecision }`.

## Stage kind → role / tool / status / next-decision (deterministic, conservative)
| Stage kind | Role | Recommended tool | Status | Next decision |
|---|---|---|---|---|
| clarify | operator | Human review | needs_decision | not_verified |
| acceptance | reviewer | Human review | candidate | defer |
| review | reviewer | GitHub PR review | needs_evidence | fix |
| fix | fixer | Claude Code | planned | rerun |
| evidence | verifier | Test run | needs_evidence | not_verified |
| release | operator | Human review | needs_decision | accept |

- **Tool wording is "Recommended tool", never "Executed by"** — tools are not invoked. Allowed tools: human_review / claude_code / codex / github_pr_review / browser_check / test_run / none. (Tool label uses "Claude Code", not "Claude".)
- **Inputs** reference Intake draft · Acceptance Map · Stage Plan · the per-type artifact (e.g. "Pasted PRD/spec text", "Repository reference").
- **Expected evidence** is expected, not collected (clarification notes, review notes, test/build result, PR/commit link, …).
- **primaryRole / recommendedFirstTaskId** derive from the Stage Plan's recommended start stage.
- **Status vocabulary**: planned / candidate / needs_evidence / not_verified / needs_decision. Forbidden: passed / complete / verified / production_ready.

## UI — `/projects/new/intake`
After "Create intake draft", a common **"Agent Run Plan"** card for all types (order: intake draft → type-specific preview → Acceptance Map → Stage Plan → **Agent Run Plan**): summary · primary role · recommended first task · ordered task cards (stage, role, status, task, recommended tool, next decision, inputs, acceptance items, expected evidence). Recommended-first task highlighted. Labeled "Preview only — Agent Run Plan is deterministic and not yet executed or saved." Not persisted.

## Deterministic limitations (intentional)
Derived from the Stage Plan via fixed mappings — no model, no execution, no fetch, no persistence. Tasks/tools/evidence are *recommended/expected*, not run/collected.

## Verification
- `apps/dashboard`: **269/269** tests (+8 agent run plan), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 11.9 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
agent execution / central-plane / Anthropic / Codex / GitHub API / DB / migration / deploy / domain — none.

## Next
Stage 111 — Acceptance Item Evidence Model.
