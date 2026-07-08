> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 117 — Beta Readiness / Team Usage Planning

**Date:** 2026-06-23
**Branch:** `docs/stage-117-beta-readiness-planning` · **Base:** `main` @ `0f4eb19`
**Type:** planning / checkpoint only. **No code, backend, DB, deploy, or domain change.**

This document opens the next train — **Stage 117~124 — Beta Readiness / Team
Usage** — defining how Simsa moves from a working product loop to safe beta usage
by real teams. It is decision-ready for Bae and detailed enough for future handoff.

---

## 1. Current product state

**Live (production):**
- Public: `trysimsa.com`, `trysimsa.com/demo`, `simsa.dev`
- App: `app.trysimsa.com` — intake route (`/projects/new/intake`), saved agent
  workflow records, benchmark/decision/evolution previews; existing
  `/projects/new` idea-to-spec flow
- Backend: central-plane Worker; D1 migration 0046 applied;
  `workspace_agent_workflow_records` tenant-scoped by `user_key`

**Live product chain:** Intake → Acceptance Map → Stage Plan → Agent Run Plan →
Evidence Plan → Save → Saved workflow list/detail → Benchmark Handoff Preview →
Decision / Outcome Link Preview → Evolution Action Pack Preview.

**Still NOT real (intentional):**
- No full user authentication (identity is a client-supplied `userKey`)
- No team/workspace model, no invite system
- No paid billing for these features
- No real agent execution, no real benchmark execution
- No evidence upload
- No outcome / scorecard / action-pack persistence *from the agent workflow chain*
  (the Stage 74~85 experiment-side persistence is separate and unrelated to the
  intake workflow chain)

> Honesty note carried forward: saved workflow records are **tenant-scoped via the
> existing client-supplied `userKey` convention** — this is tenant scoping, **not
> full session/auth security.** Do not market it as secure team storage.

---

## 2. Why beta readiness is the next train

The product loop now exists end-to-end. The next risk is **not** core product
imagination — it is whether real users can *safely try it, understand it, and give
useful feedback* without exposing the product to auth, cost, data-safety, or
support problems. The work shifts from "what should the product do" to "can
strangers use this without it breaking trust or leaking content."

Concretely, three gaps block a real (even private) beta:
1. **Data control** — users can save records but cannot delete/archive them.
2. **Comprehension** — nothing onboards a user into "preview-only, no execution."
3. **Operability** — no feedback channel, no admin view, no usage/cost boundary.

---

## 3. Beta user profile

Likely segments:
- AI / vibe-coding founders who built a prototype and need launch-readiness review
- Small product teams using Claude Code / Codex / Cursor
- Agencies building client software with AI assistance
- Startup teams comparing outputs from multiple AI coding agents
- Internal 3SVS / Simsa pilot users

**Primary beta ICP:** *AI-built app teams who already have a prototype, repo, PR,
or product URL and need an acceptance review before shipping.* They map directly
onto the existing intake types (`github_repo`, `pull_request`, `product_url`,
`ai_built_app`) and feel the "is this actually ready to ship?" pain the workflow
chain addresses.

---

## 4. Team usage assumptions

- Early beta is **single-user first**; team/workspace invite comes later.
- Current `userKey` scoping is enough for **private internal smoke**, but **not**
  enough for public multi-user beta (no real identity, no recovery, no sharing
  boundary).
- Beta should start **controlled / invite-only**.
- **Avoid open signup** until auth/workspace boundaries are decided (Stage 123).
- Treat any saved content as potentially user-sensitive until deletion + retention
  controls exist (Stage 118).

---

## 5. Current risks before beta

- Client-supplied `userKey` is **not full auth** (clearing localStorage loses
  access; no cross-device identity; not a security boundary against a determined
  actor, only against accidental cross-tenant listing).
- Saved records are **snapshots that may include user-provided text excerpts**
  (`source_summary`, `raw_input_excerpt`, and the plan snapshots derived from
  pasted input) — i.e. potentially sensitive content at rest.
- **No delete/archive endpoint** for saved workflow records yet.
- **No in-app data retention policy.**
- **No admin/beta console** to inspect or clean up records (incl. the Stage 116
  smoke record `wawr_qbxvly98wa` under `uk_stage116_smoke_a`).
- **No feedback capture flow** inside the app.
- **No in-app support/contact workflow.**
- **No usage/cost controls** for future AI/agent features.
- **No onboarding** explaining preview-only vs executed results — users may
  believe a "Saved workflow plan" means work was done.

---

## 6. Stage 117~124 proposed plan

| Stage | Title | Core deliverable |
| --- | --- | --- |
| 117 | Beta Readiness / Team Usage Planning | this doc (planning only) |
| 118 | Saved Workflow Management Hardening | archive/soft-delete + delete for saved workflow records (keep tenant scoping); UI to remove smoke/test records |
| 119 | Beta Feedback Capture | lightweight in-app "Send feedback" (mailto/simple form), context-tagged, no raw-paste auto-send |
| 120 | Preview-only Onboarding / Empty States | first-run explainer + empty states clarifying "preview-only, no execution; saved = saved plan" |
| 121 | Admin Beta Console for Saved Workflows | admin list of records by `userKey` (metadata-first), archive/delete smoke/test records |
| 122 | Usage Limits / Cost Boundary UI | saved-record count surfacing + boundary copy; groundwork for future LLM/agent cost limits (no charging) |
| 123 | Auth / Workspace Boundary Decision | decide real auth vs invite/manual beta; workspace/identity model proposal |
| 124 | Private Beta Checkpoint | readiness review → invite-only beta go/no-go |

Notes:
- **Stage 118 likely adds delete/archive** for saved workflow records (first real
  data-control gap; needs a migration or a status column — to be scoped then).
- **Stage 119** can be deliberately lightweight (mailto first).
- **Stage 123** is the pivotal decision: add real auth (e.g. Supabase/OAuth
  session) **or** keep invite/manual beta with the current `userKey` model.

---

## 7. Auth / tenant / workspace boundary

**Current (honest):**
- Dashboard `getUserKey()` creates/uses a client-side `userKey` (anonymous,
  localStorage-persisted).
- Central-plane routes scope every read/write by `userKey`.
- This prevents cross-`userKey` listing/detail access (verified: cross-tenant
  detail returns 404, list excludes other users).
- This is **tenant scoping, not full identity/auth.** Same model as the existing
  workspace benchmark/experiment/credit APIs.

**Recommended beta policy:**
- **Internal / private (invite-only) beta** until the auth/workspace boundary is
  decided (Stage 123).
- **Do not market saved records as secure team storage** yet.
- **Do not invite sensitive/confidential pastes or uploads** without stronger auth
  and deletion controls (Stage 118 + Stage 123).

---

## 8. Usage limits and cost boundary (proposal only — not implemented)

- Deterministic preview features remain **low-cost** (pure client/D1 reads/writes).
- Any future **LLM/agent execution must carry explicit usage limits** (reuse the
  existing credit/allowance dry-run machinery from Stages 19~32 where applicable).
- **Saved-workflow count limits** per `userKey` may be needed to bound D1 growth.
- Admin view should show **record counts by `userKey`**.

---

## 9. Admin / support needs (proposal only)

- Admin list of saved workflow records **by `userKey`** (key-gated, like the
  existing `/admin/usage-stats` / `/admin/credits` pattern).
- Inspect **metadata** (id, type, title, status, timestamps, counts) — not
  necessarily full sensitive snapshots.
- Ability to **archive/delete** smoke/test records (e.g. the Stage 116 smoke row).
- **Feedback/contact link** in app.
- A **support note** explaining preview-only behavior.

---

## 10. Feedback capture plan (proposal only)

- Start lightweight: in-app **"Send feedback"** CTA → `mailto:` or a simple form.
- Capture **context** (route, selected intake type, record id if the user opts in).
- **Do not auto-send raw pasted content**; the user chooses what to attach.
- No implementation in Stage 117.

---

## 11. Launch readiness checklist

**Product clarity**
- [ ] Preview-only labels are clear on every preview section
- [ ] User understands no agent execution happened
- [ ] "Saved workflow" reads as *saved plan*, not completed work

**Data safety**
- [ ] Delete/archive exists for saved workflow records (Stage 118)
- [ ] Retention note exists (in-app + docs)
- [ ] Sensitive-content warning shown before save

**Operational**
- [ ] Smoke test path documented (done — Stage 116 checkpoint)
- [ ] Rollback path documented (done — Stage 116 checkpoint)
- [ ] Admin/support path exists (Stage 121)

**Beta control**
- [ ] Invite-only or manual access decision made (Stage 123)
- [ ] Usage limits defined (Stage 122)
- [ ] Feedback channel defined (Stage 119)

Current status: **Operational** mostly satisfied; **Product clarity**, **Data
safety**, and **Beta control** are the open work for Stages 118~124.

---

## 12. Recommended next stage

**Stage 118 — Saved Workflow Management Hardening.**

Suggested scope:
- Add **archive/soft-delete (and/or delete)** for saved workflow records.
- Keep **tenant scoping** (delete/archive must be `userKey`-scoped; cannot touch
  another tenant's record).
- Add a **UI action** to remove smoke/test records (incl. the Stage 116 smoke row).
- **No auth overhaul yet** (that is Stage 123).

**Why 118 before feedback/admin/onboarding:** before inviting any beta user to
save workflow records, users *and* operators need a safe way to **remove or
archive** saved records. Shipping save without delete is a data-control gap that
makes every later stage (feedback, admin, onboarding) riskier. Delete/archive is
the prerequisite for responsibly inviting real users to create records.

---

*Planning only. No production feature, migration, route, auth, billing, deploy,
domain, or npm change is part of Stage 117.*
