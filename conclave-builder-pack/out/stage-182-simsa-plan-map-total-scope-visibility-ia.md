> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 182 — Simsa Plan Map / Total Scope Visibility IA

**Date:** 2026-06-24
**Branch:** `docs/stage-182-simsa-plan-map` · **Base / deployed main:** `a1e767b` (`Release: Stage 176 — Simsa Stamp Thinking Motion Correction`) · live: https://app.trysimsa.com
**Type:** product planning / IA only. **No deploy, no MCP/npm publish, no migration, no auth/OAuth/payment/billing/hosted execution, no domain/DNS, no DB-backed roadmap persistence, no production write, no live-dashboard behavior change, no token/secret output.**

## 1. Product insight
Simsa's stage-by-stage acceptance workflow is careful and correct, but **a correct sequence
with an invisible end feels infinite.** The user's own friction across Stage 168~181 is the
proof: every stage was verified and merge-gated, yet without a visible *whole route* it was
hard to answer "how far does this go?" AI agents can be right at every step and still leave
the human uncertain, because **confidence is a property of the whole map, not of one step.**
Simsa's differentiation is *acceptance* — so the fix is not a generic task tracker but a
**Plan Map**: a persistent, project-level view of the entire acceptance journey that always
answers *where are we, what's done, what's next, what's blocked, what needs approval, what
isn't verified, and what happens if I approve.* The Plan Map turns the implicit
Stage / Train / Release-Checkpoint operating model into a visible artifact.

## 2. Current workflow inventory (concepts Simsa already has)
- **Intake** — `idea / prd / product_url / github_repo / pull_request / ai_built_app`
  (`WORKSPACE_INTAKE_TYPES`).
- **Product brief** → **acceptance items** (status `passed / failed / inconclusive /
  needs_decision`, surfaced as Passed / Issue found / Not verified / Needs decision).
- **Stage plan · evidence plan · agent run plan** (per-project generated structure).
- **Acceptance graph** (what must be true + evidence relationships).
- **Decision / outcome / evolution loop** (benchmark → experiment → decision → evolution
  action pack; Stages 64~76).
- **Builder-pack export** (client zip + central-plane `/export`) · **handoff links**
  (secret-free, Stage 139) · **copy-to-clipboard** artifacts.
- **Operating model** — **Stage** (one unit of work), **Train** (a numbered range merged as
  one `Release: Stage X~Y …` squash), **Release Checkpoint** (merge-readiness review).
- **Approval gates** — merge · deploy · migration · MCP/npm publish · auth/OAuth ·
  payment/billing · domain/DNS · production write · token/secret handling.
- **Live surfaces (post-Stage-181)** — intake i18n, review-stamp motion, `/account` local
  stub, GitHub project flow, benchmark/experiment/credits/admin screens.

## 3. Core UX model — the Plan Map
A **persistent project-level surface** that renders the project's acceptance journey as a
map, not a checklist. It always shows:
- **Project goal** (from the brief) and **current position** ("You are here").
- **Current Stage**, **current Train**, **next Release Checkpoint**.
- **Done / Current / Next / Later** lanes (the route, with how far remains).
- **Blockers** (stack, each pointing to a cause), **approval gates** (with risk + effect),
  **evidence state** + **`not_verified` count**, **planned agent runs / assignments**.
- **Recommended next action** and a plain **"What happens if I approve?"** explanation
  (and, explicitly, *what will NOT change*).
The Plan Map is **generated/derived** from existing project data first (read-only) — it does
not require new persistence to be useful.

## 4. Suggested routes / surfaces
- **Primary route (recommended):** `**/projects/[id]/map**` — the full Plan Map.
- **Near-term lightweight entry (recommended):** a **"Where are we?" panel** (a compact
  Plan-Map summary card) inside the existing project detail / overview — read-only, generated
  from current project data, no schema.
- **Future portfolio surface:** a **dashboard-level overview of all project maps**
  (`/projects` portfolio map) — gated on the auth/workspace model for multi-user.
- Alternatives considered: `/plan`, `/roadmap`, an in-detail "Plan Map" tab, a right-side
  persistent rail. Recommend `**/map**` as the canonical route with the "Where are we?" card
  as the always-visible entry.

## 5. Visual model (acceptance/evidence map, not a PM board)
- **Horizontal train timeline** (Trains as segments; the current Train highlighted; future
  Trains dimmed) — communicates "how far to go".
- **Vertical stage list** within the current Train (Done ✓ / Current ● / Next / Later).
- **Release-checkpoint cards** at Train boundaries (merge-readiness gates).
- **Gate badges** (merge / deploy / publish / migration / auth / payment / DNS) with risk
  colour (using the existing neutral + oxblood tokens, not alert red).
- **Evidence coverage bar** per stage/item + a prominent **`not_verified` count**.
- **Blocker stack** (each blocker → its cause: missing evidence or a pending gate decision).
- **Next-action card** + **Approval-required card** + a **"why this is next"** rationale.
- **Export / share / handoff** actions (secret-free).
Tone: calm, editorial, evidence-first — consistent with the review-stamp identity. It should
read as a **review map**, never a generic Kanban board.

## 6. Status taxonomy (EN / KO)
| status | EN | KO |
|---|---|---|
| planned | Planned | 계획됨 |
| ready | Ready | 준비됨 |
| in_progress | In progress | 진행 중 |
| blocked | Blocked | 막힘 |
| needs_approval | Needs approval | 승인 필요 |
| verifying | Verifying | 검증 중 |
| completed | Completed | 완료됨 |
| skipped | Skipped | 건너뜀 |
| not_verified | Not verified | 검증되지 않음 |
| deferred | Deferred | 보류됨 |
| failed_check | Failed check | 검사 실패 |
| merged | Merged | 머지됨 |
| deployed | Deployed | 배포됨 |
These extend (do not replace) the existing acceptance-item statuses (passed / failed /
inconclusive / needs_decision); item statuses map *into* Plan-Map stage status (e.g. an item
that is `inconclusive` → contributes to a stage's `not_verified`).

## 7. Gate model
The Plan Map must surface every approval gate explicitly. Gates: **merge · deploy · MCP
publish · npm publish · migration · auth/OAuth · payment/billing · domain/DNS · production
write actions · token/secret handling.** Each gate card shows:
- **Required approval** (who / what phrase, e.g. "PR #156 merge approved.").
- **Current status** (one of the taxonomy: needs_approval / ready / completed …).
- **Risk level** (low / medium / high — e.g. migration & payment = high).
- **Why the gate exists** (one line).
- **What will happen if approved** (concrete effect).
- **What will remain unchanged** (explicit non-effects — e.g. "merging this does not deploy").
This makes the operating discipline from Stages 177~181 (each action approval-gated, deploy
held until the stamp landed) a first-class, visible part of the product.

## 8. Relationship to the Acceptance Graph
- **Acceptance Graph = what must be true** (acceptance items + evidence relationships; the
  *truth* model).
- **Plan Map = how the work proceeds over time** (stages / trains / gates; the *route* model).
- **Connections:** stages **reference acceptance items**; an **evidence gap** in the graph
  **creates a plan item / `not_verified` marker** on the map; a **blocker** on the map
  **points back** to either a missing-evidence node in the graph or a pending gate decision.
  The graph answers "is it true?"; the map answers "what do we do next and how far is left?"

## 9. Relationship to export / import
- The Plan Map should later be **exportable as part of the builder pack** (a map snapshot:
  stages, gates, evidence coverage, next action) — **secret-free**.
- **Imported** Simsa artifacts should **restore a Plan-Map preview** (read-only; re-import ≠
  live connection).
- **External imports** (repo / PR / URL / PRD) **enter intake**, then **generate or update**
  a Plan Map.
- Exports must carry **generated-at + source/stage/version + a sensitivity notice**, and
  **never** include tokens/secrets/integration credentials.

## 10. Relationship to collaboration / auth
- **Before auth:** the Plan Map is **project-local / read-only / generated** — a derived view,
  with **no multi-user approval claims**.
- **Team ownership, assigned reviewers, and an approval audit trail require the auth/workspace
  model** (Stage 171 entities). `userKey` is tenant-scoping, **not** real identity, so it
  cannot back real multi-user approvals.
- **Post-auth:** the Plan Map should show **who approved which gate and when** (audit trail),
  role-aware gate visibility, and workspace-level ownership.

## 11. Relationship to the current live dashboard (post-Stage-181)
`app.trysimsa.com` now has intake i18n, review-stamp motion, and the `/account` stub live.
The Plan Map becomes the **next "confidence layer" above intake/account**: it helps users
understand the **full journey before they approve** any merge / deploy / publish / auth /
payment gate. It must **not imply real collaboration** until the auth/workspace model exists —
gate cards stay honest ("Blocked by identity decision") and the map is a generated view.

## 12. Now-safe vs gated implementation
**Now-safe**
- this planning doc; static IA; a **local/generated Plan-Map preview**; a **read-only Plan-Map
  tab/panel** derived from existing project data; copy explaining current/next stage;
  **secret-free export inclusion**.

**Needs implementation decision (no schema yet)**
- a persistent roadmap model; project-map schema; plan-item IDs; evidence linkage;
  stage/train/checkpoint storage.

**Auth / workspace-gated**
- team assignments; approval audit trail; role-aware gates; owner/admin approval state;
  workspace-level roadmap.

**Approval-gated**
- deploy; migration; MCP/npm publish; payment; auth/OAuth; production write; DNS/domain.

## 13. Suggested implementation phases
- **P1 — Plan-Map IA + taxonomy** (this stage).
- **P2 — Project-local read-only Plan-Map preview** (generated from existing data; now-safe).
- **P3 — Stage / train / checkpoint generated model** (deterministic derivation).
- **P4 — Evidence & `not_verified` linkage** (graph ↔ map).
- **P5 — Gate ledger + approval explanation** ("what happens if I approve?").
- **P6 — Exportable Plan Map** (secret-free builder-pack inclusion).
- **P7 — Auth/workspace-aware approvals + team ownership** (post-auth).
- **P8 — Cross-project portfolio map** (dashboard-level).

## 14. Product copy (samples)
**EN:** "You are here" · "Next recommended step" · "Approval required" · "Evidence still
missing" · "Not verified yet" · "This will not deploy anything" · "This stage prepares the
plan only" · "What happens if I approve?" · "Blocked by identity decision" · "Ready for
checkpoint".
**KO:** "현재 위치" · "다음 추천 단계" · "승인 필요" · "아직 부족한 증거" · "아직 검증되지
않음" · "이 작업은 배포를 실행하지 않습니다" · "이 단계는 계획만 준비합니다" · "승인하면
어떤 일이 일어나나요?" · "신원 결정이 필요합니다" · "체크포인트 준비됨".

## 15. Recommendation
- **Yes — make the Plan Map a first-class Simsa surface.** It is the missing confidence layer
  and directly addresses real user friction; it reinforces (rather than dilutes) the
  acceptance/review identity.
- **Recommended name:** **"Plan Map"** (EN) / **"심사 지도"** (KO) — concise, memorable, and
  on-brand ("make AI-built software work visible as a map"). Formal subtitle: **"Acceptance
  Roadmap / 수락 로드맵"**. Keep "전체 심사 지도" as the portfolio-level term. (Defer the final
  lock to the P2 build.)
- **Recommended near-term route:** primary `**/projects/[id]/map**`, with a **"Where are we?"
  card** in project detail as the always-visible entry.
- **Recommended first implementation stage:** **Stage 183 — Plan-Map read-only preview (P2)**
  — generated from existing project data, no persistence, no write, no auth.
- **What stays gated:** persistence/schema (decision), team/audit/role gates (auth/workspace),
  and deploy/migration/publish/payment/DNS (explicit Bae approval). The Plan Map **shows** the
  gates; it never bypasses them.

## 16. Stage 182 decision — **Option A: Plan Map IA ready**
The product insight, current-workflow inventory, UX model, route/surface recommendation,
visual model, status taxonomy (EN/KO), gate model, acceptance-graph / export / auth / live-
dashboard relationships, now-safe-vs-gated classification, phases, and copy are defined. **Plan
Map should be a first-class surface**, named **"Plan Map / 심사 지도"**, entered at
`/projects/[id]/map` + a "Where are we?" card, first built as a **read-only generated preview
(Stage 183)**. No implementation occurred; persistence/team/approval remain gated.

## 17. Recommended next stage
**Stage 183 — Plan Map Read-only Preview Implementation** (now-safe P2 slice: generated,
read-only, project-local, no persistence/auth/write). Auth/Identity Foundation remains the
major strategic dependency for *real* multi-user approvals and audit trail, but a
read-only/generated Plan Map can ship before auth as long as it makes no real multi-user
approval claims.
