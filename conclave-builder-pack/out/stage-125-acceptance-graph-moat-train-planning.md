> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 125 — Acceptance Graph / Moat Train Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-125-acceptance-graph-moat-planning` · **Base:** `main` @ `635418f`
**Type:** planning / strategy only. **No code, backend, DB, migration, deploy, domain, MCP publish, or billing change.**

Opens the next major train — **Stage 125~132 — Acceptance Graph / Moat** —
defining how Simsa moves from "workflow previews + saved records" to a defensible
data moat, and how the **paid Web App vs free MCP** distribution boundary works.
Decision-ready for Bae; detailed enough for future handoff.

---

## 1. Current product state

**Live (production, main `635418f`):**
- Public: `trysimsa.com`, `trysimsa.com/demo`, `simsa.dev`
- App: `app.trysimsa.com` — intake flow → Acceptance Map → Stage Plan → Agent Run
  Plan → Evidence Plan → Save → saved list/detail → Benchmark Handoff Preview →
  Decision/Outcome Link Preview → Evolution Action Pack Preview → archive/restore/
  delete → admin console (`/admin/workflows`) → safe feedback → preview-only /
  usage / auth boundary copy
- Backend: central-plane Worker; D1 `workspace_agent_workflow_records` (migration
  0046, applied); tenant scoping via client-supplied `userKey`

**Intentionally NOT active:** full auth · team workspace · open signup · billing/
payment · hosted agent execution · real benchmark execution · evidence upload ·
outcome/action-pack persistence from the agent workflow chain.

---

## 2. Why moat planning is next

Simsa now has a working beta loop. The next strategic question is **not** "what
feature next" — it is **what data and workflow structure becomes defensible over
time.** The moat is **not** "we have a better model" (models commoditize). The
moat is:

> Simsa learns how acceptance workflows, evidence gaps, agent outputs, decisions,
> and follow-up actions relate **across projects**.

---

## 3. Product moat thesis

> **Simsa becomes valuable because it builds an Acceptance Graph across AI-built
> software workflows.**

The Acceptance Graph connects:
`intake type → acceptance item → stage → agent role/task → expected evidence →
actual evidence (later) → decision candidate → final human decision (later) →
action pack → follow-up → outcome improvement`.

This is more defensible than generic prompt templates: templates are copyable; an
accumulated, outcome-labeled graph of *what acceptance work actually needed what
evidence and led to what decision* is not.

---

## 4. Acceptance Graph concept

**Nodes:** Project · Intake artifact · Acceptance item · Acceptance area · Stage ·
Agent task · Evidence expectation · Evidence artifact (future) · Benchmark handoff
· Decision candidate · Human decision (future) · Action item · Follow-up ·
Outcome signal.

**Edges:** `generated_from` · `belongs_to` · `requires_evidence` ·
`assigned_to_role` · `blocks_release` · `suggests_decision` · `creates_action` ·
`followed_up_by` · `improved_by`.

**Important:** at first this is **conceptual and derived from existing saved
workflow snapshots** (the JSON already stored in `workspace_agent_workflow_records`
contains acceptance map + stage plan + agent run plan + evidence plan). **Do not
implement graph storage in this train yet** — Stage 126 derives a read-only view
without a new migration.

---

## 5. Data we should collect

**Now (structural, low-sensitivity — derivable from existing snapshots):**
intake type frequency · acceptance area frequency · common missing evidence types
· common not_verified reasons · stage kinds producing the most fix/rerun/defer
candidates · tool/role recommendations chosen most often · saved workflow count ·
archive/delete frequency · feedback themes · benchmark handoff preview usage ·
decision candidate distribution · action preview distribution.

**Later (only with consent or paid workspace):** actual evidence artifacts · final
human decisions · outcome improvements · agent/tool performance over time.

---

## 6. Data we should NOT collect by default

raw pasted product content for training · private source code · secrets/tokens ·
full private repo content · customer confidential data · complete workflow
snapshots for model training **without consent**.

**Policy:** *Use structural metadata and anonymized patterns first. Use raw
content only for the user's own saved workflow experience. Do not train on raw
private content by default.* This is a trust precondition for the moat.

---

## 7. MCP distribution strategy

**New strategy (Bae):** **Simsa Web App = paid operating system; Simsa MCP =
free/basic distribution layer.**

MCP attaches to agent hosts: Claude Code · ChatGPT · Cursor · Codex · others.

**MCP Basic offers:** acceptance map preview · stage plan preview · agent run plan
preview · evidence expectations · decision candidate preview · fix instruction
preview · "Open/Save in Simsa" link.

**MCP must NOT (initially):** hosted agent execution · paid benchmark execution ·
state mutation without explicit user confirmation · production deploy · arbitrary
shell execution · secret access · billing actions.

**MCP always communicates:** *Preview is free/basic. Save, history, team, admin,
benchmark execution, and advanced workflows live in the Simsa Web App.*

(Note: the existing `packages/mcp-workspace` from Stage 61 is the seam to build
MCP Basic on; Stage 131 specs the boundary — it does not necessarily publish.)

---

## 8. Free MCP vs Paid Web App boundary

| Tier | Includes |
| --- | --- |
| **Free MCP Basic** | lightweight preview · acceptance map · stage plan · evidence expectations · decision candidate · limited usage · no/limited storage · "Open in Simsa" CTA |
| **Simsa Web App (paid / beta)** | saved workflow records · history · archive/delete · admin console · team/workspace (later) · benchmark handoff management · decision/outcome history (later) · action pack management (later) |
| **Future paid execution** | hosted LLM review · hosted benchmark execution · evidence analysis · fix instruction generation · PR comment automation |

**Rule:** MCP drives users into the Web App for **persistence, payment, and
advanced operations**. **Payment happens on the Simsa Web App, not inside MCP.**

---

## 9. Pricing / credit boundary

**Do not introduce complex credits yet.**
- **Private beta:** free/manual · deterministic preview · controlled access.
- **Early paid:** workspace- or seat-based plan · saved workflow limits ·
  review/history limits · admin/team features.
- **Later usage credits:** hosted AI review · hosted benchmark execution ·
  evidence analysis · hosted fix instruction generation.
- **External agent costs:** by default, external Claude/Cursor/Codex/OpenAI usage
  stays under the **user's connected provider account**. Simsa does **not** absorb
  external provider costs until hosted execution is explicitly introduced.

(The existing Stage 19~32 credit/allowance dry-run machinery can be reused when
hosted execution arrives — no need to rebuild.)

---

## 10. Liability / hallucination risk policy

**Simsa may claim:** workflow preview · evidence planning · decision support ·
acceptance operations.

**Simsa must NOT claim:** bug-free · secure · compliant · production-ready · final
approval · legal/medical/financial certainty.

**Core status policy:** AI-generated outputs are **candidate until evidence-backed**;
no evidence → **not_verified**; **final decisions remain with the user/team.**

**Product disclaimer (recommended):** *"Simsa provides workflow previews and
evidence-based review support. It does not guarantee that software is bug-free,
secure, compliant, or production-ready. Final decisions remain with the user or
team."*

**MCP execution warning:** *"External tool or agent calls may follow the connected
provider's cost and data handling policies. Review before running."*

These align with the preview-only / usage / auth copy already shipped in Stages
120~123.

---

## 11. Stage 125~132 proposed plan

| Stage | Title | Core deliverable |
| --- | --- | --- |
| 125 | Acceptance Graph / Moat Train Planning | this doc (planning only) |
| 126 | Acceptance Graph Derived View v1 | **derive** graph nodes/edges from existing saved snapshots (no new migration); show graph summary, not full viz |
| 127 | Recurring Blocker Detection | surface repeated acceptance/evidence blockers across saved workflows |
| 128 | Agent/Tool Recommendation Memory | which role/tool recommendations recur / get chosen |
| 129 | Template Effectiveness Signals | which intake types/templates yield clearer acceptance maps |
| 130 | Outcome Improvement Graph Planning | plan how outcomes (later, with consent) attach to the graph |
| 131 | MCP Basic Boundary Spec | spec free MCP Basic vs paid Web App (does not necessarily publish MCP) |
| 132 | Moat Train Checkpoint | readiness review → merge/deploy decision |

Notes:
- **Stage 126** should derive an Acceptance Graph view from existing saved
  workflow snapshots **without a new migration** (read-derived; dashboard-local
  or central-plane read endpoint).
- **Stage 131** specs the MCP/Web boundary; publishing MCP is a separate later
  decision.

---

## 12. Success criteria

- **Train (by Stage 132):** Simsa has a clear moat architecture + first
  graph-derived signals showing how acceptance workflows, evidence gaps, and
  decisions compound over time.
- **Stage 125:** Bae has a clear strategy for the data moat, MCP distribution,
  free-vs-paid boundary, and liability policy before implementation starts.

---

## 13. Recommended next stage

**Stage 126 — Acceptance Graph Derived View v1.** Scope:
- dashboard-local or central-plane **read-derived** view,
- **no new migration if possible**,
- derive graph nodes/edges from saved workflow records,
- show a **graph summary**, not a full visualization yet.

---

*Planning only. No production feature, migration, route, MCP publish, billing,
deploy, domain, or npm change is part of Stage 125.*
