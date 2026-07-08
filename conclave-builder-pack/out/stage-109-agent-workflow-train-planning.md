> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 109 — Agent Workflow Train Planning

**Date:** 2026-06-23 · **Branch:** `docs/stage-109-agent-workflow-planning` · base `main` `4bcdb6e`
**Planning only — no product code, no backend, no DB, no deploy.**

## 1. Current product state
**Public surface:** `trysimsa.com` (landing + `/demo` + `/privacy` + `/terms`), `simsa.dev` (developer surface).
**Product surface:** `app.trysimsa.com`, `/projects/new/intake` — deterministic intake previews → **Acceptance Map** → **Stage Plan** (Stage 101~108, dashboard-local, preview-only, not persisted).
**Existing deeper systems (already shipped):** PR review · fix packs/instructions · PR comments · review history · rerun comparison · benchmarks (Stage 64~73) · experiments (71~73) · outcome decision + scorecard (74~76) · evolution action packs + follow-up + impact + learning/timeline (77~85). These live in `apps/central-plane` + `apps/dashboard` with D1 persistence and are gated by the manual `deploy-central-plane` workflow.

## 2. Agent Workflow Train goal
**Turn the deterministic Stage Plan into an executable Agent Workflow Plan.** Connect:
`Intake → Acceptance Map → Stage Plan → Agent Run Plan → Evidence → Comparison → Decision → Evolution Action Pack`.
Simsa is **not** a coding agent. Simsa tells builders/agents *what to build, review, fix, compare, and verify next* — it is the acceptance layer, not the builder.

## 3. Train stages 109~116
```
109 — Agent Workflow Train Planning            (this doc)
110 — Stage Plan → Agent Run Plan              (dashboard-local, deterministic)
111 — Acceptance Item Evidence Model           (dashboard-local, deterministic)
112 — Persisted Agent Run Records              (FIRST persistence — separate Bae approval)
113 — Intake Run → Benchmark Handoff           (reuse Stage 64~73)
114 — Agent Run Decision & Outcome Link        (reuse Stage 74~76)
115 — Evolution Action Pack from Agent Workflow (reuse Stage 77~85)
116 — Agent Workflow Train Checkpoint          (merge/deploy decision)
```
110~111 stay dashboard-local/deterministic. **112 is the first persistence/migration stage and must be explicitly approved before any DB/D1 work.**

## 4. Proposed data flow
```
WorkspaceIntakeDraft (101)
 → IntakeAcceptanceMap (106)
 → IntakeStagePlan (107)
 → AgentRunPlan (110)            ← dashboard-local preview model first
 → AcceptanceItemEvidence (111)  ← dashboard-local preview model first
 → AgentRunRecord (112)          ← persisted (central-plane/D1)
 → AgentRunComparison (113)      ← reuse benchmark
 → AgentRunDecision (114)        ← reuse outcome/scorecard
 → EvolutionActionPack (115)     ← reuse action pack systems
```
Through Stage 111 these are pure in-browser preview models (same pattern as 101~108): no fetch, no AI, no persistence.

## 5. Dashboard-local vs persisted boundary
| Model / Feature | Stage | Local first? | Persist later? | Notes |
|---|---|---|---|---|
| AgentRunPlan | 110 | yes | yes | derived deterministically from Stage Plan |
| AcceptanceItemEvidence | 111 | yes | yes | connects acceptance items to proof/status placeholders |
| AgentRunRecord | 112 | **no** | yes | needs central-plane route + D1 migration |
| BenchmarkHandoff | 113 | partial | yes | reuse existing benchmark structures (Stage 65 persisted) |
| DecisionOutcome | 114 | partial | yes | reuse outcome decision/scorecard (74~76) |
| EvolutionActionPack | 115 | partial | yes | reuse evolution action pack systems (77~85) |

## 6. Proposed model names (tentative)
```
AgentRunRole: builder | reviewer | fixer | verifier
AgentRunPlanStage: { stageNumber, stageTitle, role, task, inputs[],
                     expectedEvidence[], acceptanceItems[], recommendedTool, status }
AgentRunEvidence: { evidenceType, label, status, source, notes }
AgentRunDecision: accept | fix | rerun | defer | not_verified
```
**Status vocabulary (consistent with Simsa):** `planned · candidate · needs_evidence · not_verified · issue_found · accepted · needs_decision`. Avoid `passed / guaranteed / production_ready` until backed by real evidence.

## 7. Stage-by-stage implementation plan
- **110 — Stage Plan → Agent Run Plan**: dashboard-local deterministic helper `IntakeStagePlan → AgentRunPlan`. Role mapping: clarify→reviewer/operator · acceptance→reviewer · review→reviewer/verifier · fix→fixer/builder · evidence→verifier · release→reviewer/operator. `.mjs`+`.d.mts` + tests + UI section on `/projects/new/intake`. No backend.
- **111 — Acceptance Item Evidence Model**: dashboard-local model mapping `AcceptanceMapItem → expectedEvidence + status placeholder`. No DB.
- **112 — Persisted Agent Run Records**: ★ first persistence — migration + central-plane routes + dashboard save/load. **Requires explicit Bae approval before starting.**
- **113 — Intake Run → Benchmark Handoff**: connect agent run plans to the existing benchmark system (reuse Stage 64~73; prefer reuse over duplication).
- **114 — Agent Run Decision & Outcome Link**: connect results to decision/outcome/scorecard (reuse Stage 74~76).
- **115 — Evolution Action Pack from Agent Workflow**: unresolved/fix/rerun items → action pack (reuse Stage 77~85).
- **116 — Checkpoint**: verify, document, merge/deploy decision.

## 8. Persistence / migration gate
**No migration until Stage 112.** Stage 112 must be explicitly approved. Tentative table names (NOT implemented yet, names follow frozen `workspace_*` convention):
```
workspace_agent_run_plans
workspace_agent_run_evidence
workspace_agent_run_decisions
```
These would mirror the existing persisted-benchmark/experiment migration pattern (additive, nullable, applied via the manual `deploy-central-plane` workflow).

## 9. Reuse of existing Simsa systems
Reuse (do not reinvent): workspace PR reviews · review history · comparison · fix instructions · PR comments · benchmarks · experiments · outcome decision · scorecard · evolution action packs · follow-up · impact · learning/timeline.
Mental model:
```
Stage Plan      → what should happen
Agent Run Plan  → who/what should do it
Evidence        → what happened
Comparison      → which result is better   (reuse benchmark)
Decision        → accept / fix / rerun / defer   (reuse outcome decision)
Evolution       → next action               (reuse action pack)
```

## 10. Risk analysis
| Risk | Mitigation |
|---|---|
| Overbuilding before the persistence boundary is clear | Keep 110~111 local/deterministic; persist only from 112 |
| Confusing users with too many workflow layers | One linear flow on `/projects/new/intake`; reuse existing labels |
| Duplicating benchmark/experiment concepts | 113~115 reuse Stage 64~85 systems, not new ones |
| Simsa looking like a coding agent | Copy stays "tell builders/agents what's next", not "Simsa builds it" |
| DB migration too early | Hard gate: no migration before approved Stage 112 |
| Unclear role labels | Fixed small set: builder/reviewer/fixer/verifier |

## 11. Success criteria
**Train:** by Stage 116, Simsa shows how a generated Stage Plan becomes an agent-ready workflow with evidence, comparison, and decisions — reusing existing benchmark/experiment/evolution systems.
**Stage 109:** Bae has a clear train plan and can approve Stage 110 without ambiguity.

## 12. Recommended next stage
**Stage 110 — Stage Plan → Agent Run Plan** — dashboard-local, deterministic, preview-only (no backend/DB/deploy). Persistence is deferred to the gated Stage 112.
