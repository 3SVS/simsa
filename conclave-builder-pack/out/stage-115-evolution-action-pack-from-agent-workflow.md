> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 115 — Evolution Action Pack from Agent Workflow

**Date:** 2026-06-23
**Train:** Agent Workflow Train (Stage 110~116) · branch `feat/stage-110-agent-run-plan` · PR #144 (do not merge until Stage 116).

## Goal
Add a deterministic **Evolution Action Pack Preview** from a saved agent workflow
record. It turns the workflow's unresolved signals (evidence gaps, decision
candidates, unresolved risks, fix/rerun/defer signals, items that still need
proof) into **candidate next actions**, preparing the future connection to the
existing Stage 76~85 evolution action pack system.

```
Saved Agent Workflow Record → Evolution Action Pack Preview (this stage)
```

**Not** an actual/persisted action pack, not a saved evolution action pack, not
fix execution — a deterministic preview only.

## Product principle
Do not claim an action pack was generated or saved. Vocabulary: action pack
preview / suggested next action / candidate fix instruction / follow-up candidate
/ needs evidence / not verified. Avoided: action pack created / fix executed /
verified / passed / resolved / production ready (only `notIncludedYet` negations
use these). Message: *Simsa does not stop at comparison or decision — it turns
unresolved workflow signals into candidate next actions.*

## Helper — `apps/dashboard/src/lib/intake-evolution-action-preview.mjs` (+ `.d.mts`)
`buildEvolutionActionPackPreview(input): EvolutionActionPackPreview` — pure,
deterministic, dashboard-side. Inputs are the saved record's `unknown` snapshots
(+ optional handoff and decision/outcome previews), so every accessor is
defensive (malformed → conservative fallback, never throws).

```ts
EvolutionActionPackPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  recommendedFocus: EvolutionActionType;     // clarify|collect_evidence|create_fix_instructions|rerun_agent|defer_scope|prepare_release_review
  actions: EvolutionActionPreviewItem[];      // id,type,title,priority,rationale,sourceSignals,relatedAcceptanceItems,relatedStageNumbers,suggestedInstruction,expectedEvidence
  followUpQuestions: string[];
  notIncludedYet: string[];
  confidence: "low" | "medium" | "high";
}
```

### Action derivation behavior (3–7 actions)
Derived from Evidence Plan expectations + acceptance map + stage plan, mapped:
- `not_verified` / needs-evidence expectations → **collect_evidence**
- `missing_detail` items / open clarification questions → **clarify**
- fix decision impacts → **create_fix_instructions**
- rerun decision impacts → **rerun_agent**
- defer decision impacts → **defer_scope**
- release stage/gate or release-readiness evidence → **prepare_release_review**

Each action carries a fixed `suggestedInstruction` (phrased as *to-do*, never as
already done), `expectedEvidence` (derived evidence type labels or a type
default), source signals, and related items/stages. Actions are sorted by
priority then a stable type order, capped at 7, and topped up with conservative
fallbacks to guarantee at least 3.

### Priority behavior (conservative)
- **high**: fix / rerun signals; release-readiness blocker (release item
  `not_verified`); collect_evidence when ≥3 not_verified items.
- **medium**: missing evidence; defer scope; unclear acceptance item;
  prepare_release_review without a blocker.
- **low**: fallback/optional follow-up actions.

**Recommended focus** defaults to **`collect_evidence`** (nothing is collected
yet); it switches to `create_fix_instructions` only when fix signals dominate
(≥2 fix impacts).

### Follow-up questions / disclaimers
3–6 questions (base + one context-specific by intake type: github_repo → commit/PR
for the fix; product_url → walkthrough/screenshot; ai_built_app → draft area to
fix; pull_request → which item the PR proves). `notIncludedYet`: no action pack
persisted · no fix executed · no agent rerun · no evidence collected
automatically.

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 114
Decision / Outcome Link Preview, derived via `useMemo` from the opened record +
handoff + decision/outcome preview. Shows: recommended focus, suggested action
cards (id, type, priority, title, rationale, source signals, related items/stages,
suggested instruction, expected-evidence chips), follow-up questions, "Not
included yet", confidence. Labeled **"Preview only — no action pack, fix, rerun,
or evidence collection is created."** Appears only after a record is opened.

## Deterministic limitations (intentional)
Composed purely from saved snapshots — no persisted action pack, no write to
evolution tables, no fix instruction execution, no agent rerun, no evidence
collection, no benchmark execution, no model/GitHub call, no central-plane
mutation.

## No persistence / migration / execution
No D1 migration; no write to existing evolution action pack tables; no
central-plane endpoint; no agent execution, evidence upload, deploy, or domain
change.

## Verification
- `apps/dashboard`: **306/306** tests (+11 evolution-action), typecheck clean,
  build green (`/projects/new/intake` 20.1 kB). Lint = pre-existing
  `export/page.tsx` exhaustive-deps warning only.
- `apps/central-plane`: **1164/1164** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 116 — Agent Workflow Train Checkpoint.
