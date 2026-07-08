> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 113 — Intake Run to Benchmark Handoff

**Date:** 2026-06-23
**Train:** Agent Workflow Train (Stage 110~116) · branch `feat/stage-110-agent-run-plan` · PR #144 (do not merge until Stage 116).

## Goal
Bridge a **saved agent workflow record** (Stage 112/112B) to the benchmark
concept as a **handoff preview**. It shows how a saved workflow could be turned
into a comparison-ready benchmark plan — candidate agents, acceptance targets,
and the questions a benchmark should answer. **Nothing is executed, compared,
persisted, or decided.**

```
Saved Agent Workflow Record → Benchmark Handoff Preview (this stage)
```

## Product principle
A Simsa benchmark answers *which agent output best satisfies the acceptance
workflow, with the right evidence, for the right stage, under the right decision
criteria* — not merely "which agent is better". Stage 113 prepares that bridge.
Vocabulary: benchmark handoff / comparison-ready / candidate agents / expected
evidence / acceptance criteria / preview. Avoided as current claims: executed
benchmark / winner / passed / verified / best agent (these appear only inside the
`notIncludedYet` disclaimers, as explicit negations).

## Helper — `apps/dashboard/src/lib/intake-benchmark-handoff.mjs` (+ `.d.mts`)
`buildBenchmarkHandoffPreview(input): BenchmarkHandoffPreview` — pure,
deterministic, dashboard-side. Inputs are the saved record's `unknown` JSON
snapshots, so every accessor is defensive (malformed → conservative fallback,
never throws).

```ts
BenchmarkHandoffPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  benchmarkGoal: string;
  agentCandidates: BenchmarkHandoffAgentCandidate[];   // role, label, recommendedTool, taskIds, stageNumbers, expectedEvidence
  acceptanceTargets: BenchmarkHandoffAcceptanceTarget[]; // acceptanceItemTitle, area, stageNumbers, evidenceTypes, decisionCriteria
  comparisonQuestions: string[];
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
}
```

### Agent candidates (from Agent Run Plan tasks)
Tasks are grouped by `role + recommendedTool` (e.g. *Reviewer / GitHub PR review*,
*Fixer / Claude Code*, *Verifier / Test run*). Each candidate carries its
`taskIds`, `stageNumbers`, and unioned `expectedEvidence`. Clamped **2–6**. If
fewer than 2 groups derive, conservative fallbacks are added (*Reviewer / Human
review*, *Verifier / Test run*). Unknown role/tool values are coerced into the
allowed enums (`operator` / `none`).

### Acceptance targets (from Evidence Plan expectations)
One target per evidence expectation: acceptance item title, area, stage numbers,
evidence type labels, and **decision criteria** (base set + a line keyed to the
expectation's decision impact — fix/rerun/defer/accept/not_verified). Clamped
**3–8**, topped up with generic targets if too few.

### Benchmark goal / confidence
Goal = `Compare candidate outputs for: {title}` when a source summary exists,
else a generic "compare candidate agent outputs against the saved acceptance
workflow" line. Confidence reuses a snapshot's `confidence` when real candidates
and targets were derived, otherwise `low`.

### Always-present disclaimers (`notIncludedYet`)
"No benchmark is executed in this preview." · "No agent output is compared yet."
· "No benchmark result is persisted yet." · "No winner or final decision is
selected yet."

## UI — `/projects/new/intake`
The **Benchmark Handoff Preview** renders inside the **opened saved workflow
record detail** (under "Saved workflow plans" → Open). It is derived
deterministically from the opened record via `useMemo` and shows: benchmark goal,
candidate agents (label + stages/tasks + expected-evidence chips), acceptance
targets (item, area, stages, evidence chips, decision criteria), comparison
questions, "Not included yet", and confidence. Labeled **"Preview only —
benchmark handoff is not executed or persisted."** It only appears after a record
is opened.

## Deterministic limitations (intentional)
Composed purely from saved snapshots — no benchmark execution, no agent-output
comparison, no winner selection, no model/GitHub call, no persistence.

## No execution / persistence / migration
- No central-plane endpoint added (computed dashboard-side from the saved record).
- **No D1 migration**, no write to existing benchmark tables, no benchmark result
  persistence.
- No agent execution, evidence upload, decision/outcome persistence, deploy, or
  domain change.

## Verification
- `apps/dashboard`: **286/286** tests (+9 handoff), typecheck clean, build green
  (`/projects/new/intake` 16.4 kB). Lint = pre-existing `export/page.tsx`
  exhaustive-deps warning only.
- `apps/central-plane`: **1164/1164** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 114 — Agent Run Decision and Outcome Link.
