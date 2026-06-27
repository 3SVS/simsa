# Simsa Autopilot Operating Model

> **Status:** Policy / governance specification (durable). This document defines *how* Simsa should
> reduce human micro-approval burden while preserving hard gates for production-risk actions. It
> describes intent and rules only — it does **not** implement runtime automation, does **not** enable
> auto-merge, and does **not** change production behavior. Implementation lands in later, separately
> approved stages (see §19 Roadmap).

---

## 1. Purpose

Simsa is an **AI software acceptance and governance layer** for agent-driven development. It is not
merely a code-review tool, not merely CI, and not merely PR automation. Its role is to:

- **collect evidence** deterministically from git, diffs, CI, and read-only production observation;
- **classify risk** of each change by file path, pattern, and known policy;
- **separate human gates** so production-risk actions always require explicit human approval;
- **orchestrate agent handoff** (lead implementation + challenge cross-review);
- **preserve auditability** — every automated decision carries the evidence pack that justified it.

The product thesis: an acquirer or enterprise buyer underwrites "which agent changes can ship without
a human, and why." Simsa makes that explainable and auditable.

## 2. Current problem

- Too many micro-approvals. The cadence of `readiness → code-readiness PR → merge → report` consumes
  Bae's attention on work that frequently has **zero production impact**.
- The genuinely risky surface is small and concentrated: **deploy, D1 schema/data, env/secret, auth
  activation, sign-up policy, payment, DNS/OAuth, broad launch, destructive actions**.
- Folding low-risk approvals into autopilot — while hardening the risky few — is the leverage.

## 3. Operating principle

- Automate evidence collection.
- Auto-advance low-risk work.
- Stop on risk elevation.
- Preserve hard human gates.
- **Never bundle merge, deploy, D1 apply, env, and launch into one approval.** Each production-risk
  action keeps its own exact-phrase gate.

## 4. Risk tier model

| Tier | Name | Examples | Autopilot | Human gate |
| --- | --- | --- | --- | --- |
| **0** | Informational / docs-only | docs, reports, planning docs, comments | auto-open/auto-merge eligible if CI/checks pass and no sensitive claims | only for user-facing/legal/brand copy |
| **1** | Low-risk code, no production impact | tests, pure helpers, type definitions, non-deployed read-only code | auto PR / CI / evidence / merge eligible under strict policy | optional summary only |
| **2** | Runtime code, deploy required, no data mutation | read-only API endpoint, UI display, routing/rewrite | PR/merge may be automated if low-risk | **production deploy remains human gate** |
| **3** | Production data / schema / env / auth risk | D1 schema apply, env/secret, auth policy, workspace/member writes, project claim | — | **hard human gate required (exact phrase, no auto-apply)** |
| **4** | Critical / irreversible / external-facing | destructive cleanup, payment, public launch, DNS, OAuth prod, account deletion, bulk migration, customer-data access | — | **hard human gate, possibly two-step; rollback/containment plan mandatory** |

## 5. Auto-advance rules

Auto-advance is permitted **only when ALL** of the following hold:

- Tier 0 or Tier 1
- no migration files
- no deploy files
- no `wrangler.toml` changes
- no `.env`/secrets
- no auth/signup policy changes
- no payment/OAuth/DNS/CORS changes
- no production API behavior change
- no D1 writes
- no destructive SQL
- no `workspace_projects` UPDATE
- no project claim
- no invite/share
- no broad launch copy
- CI green
- branch up-to-date
- diff under configured threshold
- evidence pack generated
- at least one agent self-review
- no unresolved cross-review blocker

## 6. Stop triggers

Stop and require human review if any of the following appears:

- migration added/changed
- `wrangler.toml` changed
- deployment workflow changed
- env/secret surface touched
- auth/signup policy touched
- payment/OAuth/DNS/CORS touched
- deploy needed
- production D1 apply needed
- data write path added
- destructive SQL detected
- `workspace_projects` UPDATE detected
- project claim introduced
- invite/share permission introduced
- broad launch copy introduced
- CI fails
- diff threshold exceeded
- agent reviews conflict
- risk tier ≥ 2 without explicit policy
- production baseline drifts
- D1 row drift detected
- approval phrase ambiguity appears

## 7. Hard human gates

The following **always** require explicit human approval with an exact phrase:

- production central-plane deploy
- production dashboard deploy
- production D1 schema apply
- production D1 data mutation/backfill
- env/secret changes
- `AUTH_ENABLED` changes
- `AUTH_SIGNUP_MODE` changes
- OAuth production setup
- payment/billing setup
- DNS/domain/CORS production changes
- destructive cleanup
- smoke account deletion
- project claim/backfill
- workspace/member production write behavior
- invite/share launch
- public sign-up opening
- public launch
- MCP/npm publish
- customer data export/delete
- rollback that disables auth or changes production behavior

## 8. Exact approval phrase policy

Approval phrases are exact, scoped, and bound to a specific action. Examples:

- PR merge: `PR #<number> merge approved.`
- central-plane deploy: `<feature> central-plane production deploy approved.`
- dashboard deploy: `<feature> dashboard production deploy approved.`
- D1 apply: `<feature> production D1 apply approved.`
- env/secret: `<feature> production env provisioning approved.`
- public launch: `<feature> public launch approved.`

An approval for one action never implies approval for another (merge ≠ deploy ≠ D1 apply ≠ launch).

## 9. Claude/Codex handoff protocol

1. Simsa creates a **task packet** from an issue/stage.
2. **Lead agent** implements on a branch.
3. Lead agent runs required **verification**.
4. Lead agent writes a **self-review**.
5. **Challenge agent** performs **cross-review**.
6. Lead agent fixes only **high/medium** findings.
7. Simsa compiles the **evidence pack**.
8. Simsa assigns a **risk tier**.
9. Simsa **decides**: auto-advance · request Bae approval · hold/contain.
10. Bae receives only a **decision summary** when human input is needed.

## 10. Single-agent vs dual-agent routing

- **Dual-agent (lead + challenge) required:** auth · migrations · payment · permissions · deploy ·
  data model · broad launch · critical bug fixes.
- **Single-agent sufficient:** docs · tests · copy · narrow UI fixes · pure helpers · low-risk
  read-only instrumentation.

## 11. Evidence pack format

Each task produces an evidence pack (JSON + rendered markdown) with the fields:

- task/stage id
- branch / base / head
- PR number
- changed files
- diff risk scan
- migration risk (yes/no)
- deploy risk (yes/no)
- D1 mutation risk (yes/no)
- env/secret risk (yes/no)
- auth/signup risk (yes/no)
- payment/OAuth/DNS risk (yes/no)
- user-facing launch risk (yes/no)
- tests run
- CI status
- preview/deploy status
- production baseline (if relevant)
- D1 drift (if relevant)
- agent self-review
- cross-review summary
- unresolved blockers
- rollback/containment plan
- recommended decision
- required approval phrase (if any)

## 12. Deterministic evidence rules

- Risk booleans must come from **git diff, CI, file-path scan, and known policy** — never from agent prose.
- Agent prose must **not** be treated as proof; it lives only in the `agentSelfReview` / `crossReviewSummary` fields.
- Web/CLI claims must be backed by **captured command output**.
- Production facts must be **read-only observations** unless separately approved otherwise.
- **No secrets in logs. No token dumps.**

## 13. GitHub labels

- `simsa:risk-0-docs`
- `simsa:risk-1-low`
- `simsa:risk-2-runtime`
- `simsa:risk-3-prod-data`
- `simsa:risk-4-critical`
- `simsa:auto-eligible`
- `simsa:human-gate`
- `simsa:deploy-required`
- `simsa:d1-required`
- `simsa:env-required`
- `simsa:auth-required`
- `simsa:blocked`
- `simsa:ready-for-bae`
- `simsa:autopilot-held`

## 14. GitHub status checks

- Simsa Risk Classification
- Simsa Diff Safety Scan
- Simsa Evidence Pack
- Simsa Agent Self-Review
- Simsa Cross-Review
- Simsa Human Gate Required
- Simsa Auto-Merge Eligibility

Auto-merge is permitted only when **Simsa Human Gate Required** is absent **and** **Simsa Auto-Merge
Eligibility** passes.

## 15. Telegram/Slack summary format

```
[Simsa] <title>
Risk: Tier <n> <label>
Changed: <one-line what changed>
No: <deploy / D1 / writes / claim — what did NOT change>
CI: <green/red>
Production impact: <none / pending deploy / …>
Recommendation: <auto-merge eligible / approve / hold>
Approval needed: "<exact phrase>"
[Approve] [Hold] [Ask cross-review] [Rollback plan] [More detail]
```

Example:

```
[Simsa] PR #174 Bridge Endpoint
Risk: Tier 1 low, no production impact
Changed: read-only /workspace/membership/me on main
No: deploy, D1 mutation, workspace writes, claim
CI: green
Recommendation: auto-merge eligible
Approval needed: "PR #174 merge approved."
```

## 16. Stage compression rules

- **Docs-only:** readiness + PR + merge can become one autopilot flow.
- **Low-risk code:** code-readiness + merge can be auto, or one human summary.
- **Runtime code:** PR/merge can auto if low-risk; **production deploy remains a gate**.
- **D1 migration:** code PR/merge can be separate; **apply remains a hard gate**.
- **Env/auth/payment/DNS:** never compress the production-mutation gate.
- **Observation:** auto-run and notify only on anomaly.

Old flow: `readiness → PR → merge → deploy readiness → deploy → observation`
New flow: `agent work → PR/CI/evidence → auto-merge or approval → deploy-readiness summary → human deploy approval → auto observation`

## 17. Initial autopilot rollout policy

**Start in shadow mode:**

- classify risk
- generate evidence pack
- comment on the PR
- recommend auto / hold / human gate
- **do not auto-merge yet**

**Then allow auto-merge only for:**

- Tier 0 docs
- Tier 1 tests / pure helpers
- no runtime / deploy / migration / env / auth / payment / D1 risk
- CI green
- branch up-to-date
- evidence pack exists
- no unresolved blocker

## 18. Explicit non-goals

- No production auto-deploy in the initial rollout.
- No automatic D1 apply.
- No automatic env/secret changes.
- No automatic auth policy changes.
- No automatic public launch.
- No automatic destructive cleanup.
- No automatic customer-data actions.

## 19. Roadmap

Implementation stages (each separately approved):

- **Stage 257A** — Simsa Evidence Pack Generator code-readiness PR.
- **Stage 258A** — Simsa Risk Classifier code-readiness PR.
- **Stage 259A** — Telegram/Slack Decision Summary PR.
- **Stage 260A** — Low-Risk Auto-Merge readiness gate.
- **Stage 261A** — Agent Handoff Workflow PR.

Separate bridge runtime path (independent of autopilot):

- **Stage 256** — Auth Workspace Bridge Deploy Readiness Gate.
- **Stage 257** — Auth Workspace Bridge Production Deploy Gate.

---

# Part II — Product Boundary & Receipt Policy

> **Status:** Policy amendment (Stage 256B-1). Defines *what Simsa is allowed to judge*, *how it
> reports*, and *where its durable moat lives*. Like Part I, this is intent/governance only — no
> runtime implementation, no scoring engine, no auto-merge. It constrains future implementation
> stages so Simsa does not drift into being a fake judge, a numeric-scoring tool, an AI-slop
> generator, or a closed-loop internal-policy machine.

## 20. No Numeric Scoring Policy

**Policy version:** 1.0 (introduced 2026-06-27).

Simsa **must not** assign generic numeric scores such as: "Idea Quality 82/100", "PRD Score 76/100",
"Founder Score", "Market Potential Score", or "Originality Score".

**Reason:** numeric scores create false authority and imply Simsa is judging market success, founder
quality, originality, or investment worthiness — none of which it is qualified to certify (see §22).

Instead Simsa uses **readiness states**:

- Ready
- Conditionally Ready
- Needs Clarification
- Needs Evidence
- Needs Expert Review
- Not Applicable
- Not Judged
- Do Not Build Yet

For every evaluated artifact Simsa explains: what is ready · what is unclear · what evidence is
missing · what is safe to do next · what should not happen yet.

## 21. Intent-Based Evaluation

Simsa evaluates artifacts against the **user's declared intent**, not a universal idea-quality score.

Simsa identifies: user intent · target first user · problem statement · desired behavior change ·
MVP boundary · non-goals · acceptance criteria · known assumptions · evidence gaps · risk gates.

When intent is too unclear to generate or evaluate a PRD, Simsa **asks clarifying questions** rather
than guessing. Simsa does **not** judge whether an idea is good or bad in absolute terms.

## 22. Qualification Boundary

Simsa **can** assess: clarity · completeness · internal consistency · buildability · testability ·
implementation alignment · release readiness · risk exposure · evidence gaps · next safe action.

Simsa **must not** certify: market success · investment worthiness · founder quality · legal
compliance · medical correctness · financial outcome · scientific truth · final originality ·
domain-specific claims without evidence or expert review.

When Simsa lacks qualification or evidence, it must say one of: **Unknown · Needs Evidence · Needs
Expert Review · Not Judged · Out of Scope for Simsa.**

## 23. Novel Product Gate

For products that do not fit an existing category, Simsa **must not penalize** the absence of standard
category conventions. Instead it evaluates the quality of the **product hypothesis**:

declared intent · target first user · problem clarity · behavior to be changed · core workflow ·
assumptions · evidence gaps · first testable milestone · MVP boundary · failure signal · learning
plan · safety/risk constraints · expert review needs.

Simsa asks: What must be true for this idea to work? · Who must care first? · What behavior would
prove interest? · What is the smallest test? · What should not be built yet? · What evidence would
change the plan? · What requires domain expert validation?

## 24. Adaptive Receipt Rules

Receipts **adapt to project type and current stage**. Each evaluated area is marked: **Required ·
Recommended · Optional · Later · Not Applicable · Unknown.** Every *Not Applicable* item must carry a
reason.

Examples:

- Billing is **Required** for paid SaaS or commerce; **Not Applicable** for internal tools, research
  prototypes, one-off event tools, or OSS developer tools unless monetization is explicitly in scope.
- Invite/share is **Required** for team products; **Later** for single-user MVPs.
- Privacy/account deletion is **Required** before public launch; may be **Later** for internal
  prototypes with no external users.

## 25. Receipt Taxonomy

1. **Idea Receipt** — clarity · target first user · problem urgency · differentiation · feasibility · assumptions · next questions.
2. **PRD Receipt** — buildability · requirements completeness · user flows · acceptance criteria · edge cases · data/permission/privacy gaps · launch blockers.
3. **Build Receipt** — implementation vs PRD · changed files · acceptance-criteria coverage · tests · unresolved gaps · agent self-review · cross-review.
4. **Release Gate Receipt** — PR/merge/deploy/migration/env safety · risk tier · changed/not-changed · evidence · human-gate requirement · rollback/containment plan.
5. **Progress Receipt** — what improved over time · what became clearer · what was implemented · what risks were reduced · what blockers remain · next safest action.
6. **Technology Recommendation Receipt** — Discover/Assess/Trial/Adopt/Hold/Reject · why relevant now · expected benefit · adoption risk · compatibility · operational burden · rollback path · smallest useful experiment · adoption criteria · reasons not to adopt.

Each receipt must distinguish: **missing-and-blocking · missing-but-later · missing-because-not-applicable
· unknown-because-evidence-insufficient · outside-Simsa's-qualification · requires-expert-review.**

## 26. Anti-Slop Rules

Simsa must avoid: generic checklist scoring · unsupported confidence · pretending outdated knowledge
is current · recommending trendy tools without fit analysis · treating every project as SaaS ·
treating every missing category as a blocker · hiding uncertainty · over-optimizing for Simsa's own
internal process instead of user value · producing summaries that cannot be tied back to evidence.

Every major recommendation must include: evidence · assumptions · unknowns · project-specific
reasoning · what changed · what improved · what is still weak · what is safe to do next · what must
not happen yet.

## 27. Standards Drift Guard

Simsa's own judgment rules must be **versioned and reviewed**. Each policy carries: policy version ·
date introduced · reason introduced · examples where it applies · examples where it should not apply ·
known failure modes · review cadence.

Simsa must be able to say: *"Our current standard may be outdated. A technology/risk/process review is
recommended."*

## 28. Technology Radar

Simsa maintains a technology radar for product/engineering recommendations. Each technology or method
is classified: **Discover · Assess · Trial · Adopt · Hold · Reject.**

Each recommendation includes: why relevant now · expected benefit · adoption risk · compatibility with
current stack · operational burden · rollback path · smallest useful experiment · adoption criteria ·
reasons not to adopt. **Simsa must not recommend a technology just because it is new.**

## 29. Aggregated Trend Signals

Simsa may generate ecosystem-level insights **only from anonymized and aggregated metadata.**

Allowed signals: project category · stage reached · common blockers · common missing PRD fields ·
common tech stacks · common agent workflows · common risk gates · common launch blockers ·
adopt/hold/reject patterns for technologies · build-to-release conversion rates.

Never exposed: raw user ideas · proprietary PRDs · code · customer names · workspace-specific strategy
· identifiable company/user data · secrets or credentials.

Trend insights must be: anonymized · aggregated · permission-aware · thresholded to avoid exposing
individual projects · opt-out capable · **separated from model-training consent.**

## 30. Independent Technical Moat

Simsa's independent moat is **not** foundation-model ownership or GPU infrastructure. The moat is:

- Acceptance Graph
- Receipt Schema
- Policy Engine
- Evidence Pack Generator
- Risk Classifier
- Agent Handoff Protocol
- Connector Layer
- Audit Log
- Deployment Modes
- Standards Radar
- Privacy-Preserving Trend Layer

**Acceptance Graph:**
`Idea → Clarifying Answers → PRD → Acceptance Criteria → Build Tasks → PR → Tests → Evidence → Gate Decision → Receipt`

**Enterprise / on-prem thesis:** Simsa sells the **governance layer, not the model.** Customers may
bring their own model, cloud, Git, CI, and LLM runtime; Simsa brings receipt, gate, policy, evidence,
approval, and audit.

> Simsa's proprietary value is not that it generates AI output. It is that it makes AI-generated
> product and engineering work **acceptable, reviewable, auditable, and governable.**
