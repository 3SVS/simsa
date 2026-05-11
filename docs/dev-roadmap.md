# Conclave AI development roadmap (operator + dev-loop reference)

> **Source of truth:** this file.
> Bae's nickname for it: "개발로드맵".
> The autonomous dev-loop (`.github/workflows/dev-loop.yml`) reads this
> file every run to figure out the next task. Edit this file to change
> what gets built next.

## Operating contract

- **One item per dev-loop run.** Pick the lowest-numbered pending item,
  ship it (code + tests + commit + release if needed), update
  `.dev-loop-state.json`, then exit. Don't try to do two items in one run.
- **Verify before advancing.** A run only advances `lastShipped` if a
  commit + push actually landed AND `pnpm test` passed. Otherwise the
  state stays put and `consecutiveFailures` increments.
- **Hard stop conditions.**
  - `consecutiveFailures >= 3` → freeze the loop, write a status note,
    wait for a human.
  - Per-run cost cap exceeded → exit early, mark the partial result.
  - Daily cost cap exceeded → freeze.
- **Never destructive.** No force-push to main. No `git reset --hard`.
  No skip-ci on commits unless the change is workflow-only.

## Status tracker

The dev-loop reads `.dev-loop-state.json` at the repo root for
{currentItem, lastShipped, consecutiveFailures, frozen, ...}. When
`currentItem` matches an item below, that's the next thing to build.
When all items in a horizon complete, currentItem advances to the
first item of the next horizon.

---

## H1 — Reliability + DX  ✅ ALL SHIPPED (2026-04-27)

Pre-requisites for any other user adopting the system. Don't skip.

1. **`conclave init --reconfigure` automatic migration.** ✅ cli@0.13.16
2. **Install dashboard** — `conclave status` CLI + `/admin/install-summary`. ✅ cli@0.13.17
3. **Secret-drift detection in `conclave doctor`.** ✅ cli@0.13.18
4. **autofix worker retry-with-feedback.** ✅ cli@0.13.19
5. **Per-install monthly cost cap + alert.** ✅ cli@0.13.20

---

## H1.5 — Whole-Product Verification

These are the three capabilities Bae says are part of the original
design intent for conclave: not just per-PR review, but full-product
audit. The packages exist (`packages/cli/src/commands/audit.ts`,
`packages/visual-review/`, design-agent + spec hints) but **end-to-end
verification on a real repo has never been done**. Per-PR review caught
console.log; the whole-product story is unproven.

These are intentionally separate from H1's reliability work because
they're a different kind of debt — "feature shipped but not validated"
vs. "feature operational but not robust".

Bae's directive: do NOT run audit yet. Build/verify these first, THEN
run on eventbadge.

**A. `conclave audit` whole-project end-to-end.** ✅ cli@0.13.21
Actually scan a real repo (eventbadge), produce the prioritized GitHub
issue, validate that the issue list maps to real defects (no
hallucinations, no missed obvious ones). Fix any RCs that surface (will
likely be ≥2-3 like the per-PR loop had). Live cost: $2-10 once. Output:
a GitHub issue on eventbadge that Bae can scan and feel "yes, conclave
saw the right things".
RCs fixed: audit-1 (`gh issue create` now passes `--repo` so `--cwd`
runs land in the right repo), audit-2 (`--output both` no longer
double-writes stdout when issue creation fails). 9 new hermetic tests
added (21 total in audit.test.mjs). Actual audit run on eventbadge is a
separate Bae-triggered action.

**B. `conclave review --visual` against design system baseline.** ✅ cli@0.13.22
DesignAgent + Playwright capture + pixelmatch already exist. Wire the
design-spec input (`.conclave/design/baseline/`) so DesignAgent compares
the PR's preview URL screenshots against a stored baseline (or against
a Figma export if we ship that integration). Verify it actually fires
on a UI PR, surfaces design-drift blockers (color token mismatch,
layout regression, contrast, cropped text), AND those blockers can be
autofixed by the worker (v0.13.7 already enabled design-domain autofix
when blocker.file is set).
Implementation: new `design-baseline.ts` module (routeToFilename, saveDesignBaseline,
matchBaselinesToArtifacts), `ReviewContext.designBaselineDrift` field in core,
DesignAgent buildVisionContent updated to interleave BASELINE→CURRENT pairs
before PR before→after pairs, SYSTEM_PROMPT updated with baseline-drift guidance,
`--capture-baseline` CLI flag to save golden reference. 17 new hermetic tests
(10 in design-baseline.test.mjs, 7 in vision-mode.test.mjs).

**C. `conclave audit --spec docs/spec.md`** ✅ shipped 2026-04-28
(cli@0.13.23). Hermetic deterministic classifier — no LLM call, $0
to run. Spec markdown is parsed for bullets (any indent / `-`*`+`),
each feature is classified PRESENT / PARTIAL / MISSING by keyword
overlap against the codebase (path matches weighted ×3). Output:
stdout / `--output issue` (creates a "Conclave Spec Gap" GitHub issue
with checklist of missing/partial features) / both / json. 7 new
hermetic tests in audit.test.mjs.

Acceptance criteria: all three run on eventbadge end-to-end, output
reads as "this is what I'd expect a senior reviewer to flag", Bae
confirms the audit / visual / spec outputs match his mental model of
eventbadge's actual gaps.

---

## H2 — Review quality

Foundation already exists in `core/memory/` (answer-keys +
failure-catalog seeds shipped, federated-* code present). Just not
wired live.

6. **answer-keys live retrieval.** ✅ shipped 2026-04-28 (commit 6c90ef8,
   manual dev). Merged PR's pre-merge "removed blockers" (categories
   caught in earlier rework cycles, resolved before merge) land on the
   AnswerKey. Future councils retrieve them via the same BM25 path —
   matching on the original blocker words ("console.log", "missing
   test"), not just category labels — so "this repo flags X" is learned
   automatically. EpisodicEntry gains cycleNumber + priorEpisodicId;
   AnswerKey gains removedBlockers; classifier walks the chain on merge.
   13 new hermetic tests.
7. **failure-catalog active gating.** ✅ shipped 2026-04-28 (commit
   18ccb64, manual dev). `applyFailureGate(outcome, retrieved, ctx)`
   runs deterministically after `council.deliberate` — tokenizes each
   retrieved failure entry's title+body+tags, matches against the
   diff's added-line tokens (≥2 overlap, length ≥4, stopword-filtered,
   hyphens split), and injects a sticky Blocker via a synthetic
   `failure-gate` agent for any match the council didn't already
   cover (same category + same file). Verdict escalates:
   blocker→reject, major/minor→rework, never downgrades a council
   reject. Wired into review.ts; config knobs `memory.activeFailureGate`
   (default true) + `memory.activeFailureGateMinOverlap` (default 2).
   11 hermetic tests.
8. **Per-repo blocker-vs-nit calibration.** ✅ shipped 2026-04-28
   (commit 94222a7, manual dev). OutcomeWriter detects overrides
   (merge that lands on a rework/reject verdict) and auto-records one
   calibration entry per blocker category in
   `.conclave/calibration/{domain}/{repo}.json`. Step-function thresholds
   on the failure-gate side: 0–1 overrides untouched, 2 demote one
   severity step (blocker→major, major→minor, minor→skip), 3+ skip
   entirely. Sticky verdict logic now treats "minor" as informational
   only, so demoted stickies stop blocking merges over time. Nits
   excluded from counting; same-category dedup across agents in one
   merge. 17 new hermetic tests.
9. **Diff splitter** ✅ shipped 2026-04-28 (commit 0903777, manual
   dev). PRs over 500 changed lines bin-pack their per-file `diff --git`
   blocks into chunks (≤500 lines each, ≤20 files each by default),
   run council per chunk, integrate verdicts. `splitDiff` never breaks
   a single file mid-diff — oversize files become their own chunk.
   `integrateChunkOutcomes` merges per agent (blockers concatenated
   + deduped, verdict severity-max, summaries joined, tokens/cost
   summed). Config: `efficiency.diffSplitter` /
   `diffSplitterMaxLines` / `diffSplitterMaxFilesPerChunk`. 15 new
   hermetic tests.
10. **Agent score routing** ✅ shipped 2026-04-28 (commit b697e34, manual
    dev). Decision #19's weighted vote now affects council verdicts: a
    reject from an agent whose score < 0.5 is demoted to rework
    (advisory). Brand-new agents (< 5 samples) keep full weight by
    default. `tallyWeighted(results, weights, threshold)` is the shared
    rule; Council + TieredCouncil both consume it. `deriveAgentWeights`
    converts AgentScore[] into the weight map. review.ts wires it up
    through computeAllAgentScores. Config knob
    `council.agentScoreRouting` (default true) opts out. 14 new
    hermetic tests.

---

## H3 — Self-evolve

H2 has to be live first or this just feeds noise.

11. **Autofix patch → answer-key auto-register.** ✅ shipped 2026-04-28
    (commit 3de2d7e, manual dev). When the autofix worker successfully
    addresses a council blocker and the resulting PR merges, the
    (blocker, patch) pair becomes a permanent answer-key with
    `solutionPatch` populated. Sidecar handoff: autofix writes
    `<memoryRoot>/pending-solutions/<repo>__pr-<N>__cycle-<C>.json`,
    review reads it on cycleNumber > 1 and folds patches into
    writeReview's solutionPatches; recordOutcome's classifier
    matches removed blockers against solutionPatches via
    matchPatchToRemoved (same category + message-substring overlap
    or file match) and emits per-pair answer-keys with pattern
    `autofix-solution/<category>`. 10 new hermetic tests
    (4 classifier + 6 sidecar).
12. **Rework-loop failure → failure-catalog.** ✅ shipped 2026-04-28
    (commit 6526b59, manual dev). When autofix bails (no-patches,
    max-iterations, budget, build-failed, tests-failed, etc.),
    `writeReworkLoopFailure(store, input)` persists a FailureEntry
    tagged `rework-loop-failure` + the bail status + every
    distinct blocker category. The H2 #7 active gate surfaces
    these as sticky blockers on subsequent reviews whose diff
    tokens overlap. Stable id keyed on (bailStatus, seed.category,
    seed.message[:60]) so re-runs don't spawn duplicates.
    autofix.ts hooks the writer right before the final return
    when status starts with `bailed-`. 7 new hermetic tests.
    `mapCategory` exposed as a public export. (Active "pre-apply
    dedupe" — automatic workaround application — remains a
    follow-up; this ship is the WRITE side.)
13. **Worker prompt auto-tuning.** ✅ shipped 2026-04-28 (commit
    8fe896f, manual dev). At autofix start the CLI retrieves
    `rework-loop-failure` entries (written by H3 #12) and synthesizes
    one short hint line per entry via `extractPriorBailHints`.
    WorkerContext.priorBailHints carries the lines;
    buildCacheablePrefix splices them into a dedicated "Past worker
    bails — avoid these failure modes" section in the cache prefix
    (own block so prompt-cache hits stay intact). Retrieval query
    seeded with the first remaining blocker's (category, message) so
    hints surface only when run shape resembles past bails. 13 new
    hermetic tests (8 extractor/renderer + 5 cache-prefix).
    Deterministic text synthesis only — LLM-driven self-tuning is a
    follow-up.
14. **Federated baseline live.** ✅ shipped 2026-04-28 (commit
    7904804, manual dev). New `federated.autoPush` config flag
    (default false). When enabled alongside `federated.enabled` +
    `federated.endpoint`, every `conclave record-outcome` event
    auto-pushes the deltas the classifier just wrote — answer-keys
    + failures — through the existing HttpFederatedSyncTransport.
    Pulls stay on the explicit `conclave sync` path so latency
    doesn't land on every merge. autoPushOutcome helper hard-skips
    with a reason on every misconfig path; transport throws are
    caught and surfaced via the result's error field, never
    propagated. 8 new hermetic tests.
15. **Regression-detection meta-loop.** ✅ shipped 2026-04-28
    (commit ead2210, manual dev). After the H2 #7 active gate runs,
    a relaxed-overlap scan re-checks retrieved failures against the
    diff at minTokenOverlap=1 (vs the gate's default 2). Any catalog
    pattern matching at the lower bar that neither council nor gate
    raised counts as a catch regression. detectCatchRegressions
    filters meta-tagged entries (so it doesn't recurse on its own
    output), dedupes by (category, title[:60]), caps at 5.
    writeCatchRegression persists each detection as a FailureEntry
    tagged 'catch-regression' so the next retrieval surfaces it.
    review.ts emits a stderr ⚠️ alert and writes one entry per
    detection, both best-effort. 10 new hermetic tests.

---

## H4 — Pre-1.0 cleanup (5 items)

Source: `docs/pre-1.0-surface-audit.md` action items. Each item is
independently shippable in roughly 5-40 LOC. None of them is the
actual 1.0 gate (the gate is accumulated outcome data + container
validation against real traffic), but they remove the rough edges a
new BYO user sees on the way in.

16. **CLAUDE.md command count** — header still says "17 commands";
    actual is 22 commands as of v0.16.2. One-line edit.
17. **`migrate` deprecation notice** — print a one-line "deprecated
    since 1.0; will be removed in 2.x" warning when the command runs.
    ~5 LOC in `packages/cli/src/commands/migrate.ts`.
18. **`sync` de-emphasize in `--help`** — `federated.autoPull` is now
    default true, so manual sync is power-user-only. Drop from the
    prominent HELP list; keep accepting the command.
19. **`conclave review --json` schema as public contract** — document
    the JSON output shape (including the `metrics.rag` field from
    Sprint D) in `docs/getting-started.md` so consumers can pin it.
    ~40 LOC of docs.
20. **`version: 1` schema commitment + `--dev` gate convention** —
    note in `docs/configuration.md` that the v1 config parser stays
    around for one minor cycle after v2 lands. Document the canonical
    `--dev` flag convention for future internal-only commands.

---

## H5 — Orchestrator template (DX multiplier, 1 item)

21. **`@conclave-ai/orchestrator-template` package** — reusable GitHub
    Actions YAML that a user's repo wires in once. Original
    `solo-cto-agent` port promise from ARCHITECTURE.md §Monorepo Layout.
    With this in place, a user runs `npx @conclave-ai/orchestrator-template
    install` (or equivalent) and their `.github/workflows/` has conclave
    wired without copy-pasting from this repo's own dev-loop. Currently
    the only wired workflows are this repo's own `dev-loop.yml` and
    `release.yml`, so users have nothing to install — copy-paste is the
    de-facto onboarding step, and that's the friction this fixes.

---

## H6 — Agent SDK migration (council capability uplift, 2 items)

Decisions #8 and #9 were intentionally diverged on 2026-04-19 because
one-shot review didn't need the agent-SDK weight (see
`docs/decision-status.md`). The reopen trigger is exactly this
horizon: when a council agent starts wanting **mid-review tool use** —
fetch external context, query a spec by ID, look up federated baseline
entries mid-deliberation — the SDK abstractions stop being overhead
and start carrying their own weight.

22. **agent-claude → `@anthropic-ai/claude-agent-sdk`** — moves
    `agent-claude` from one-shot `submit_review` to a loop-capable
    reviewer. Enables MCP server calls mid-review (the council can
    "investigate" an unclear PR by pulling related files from the repo
    via filesystem MCP instead of relying purely on diff + RAG hits).
    Trade-off: ~3.9 MB added bundle weight and the loop's safety
    surface (anti-infinite, anti-tool-spam guards already in
    `core/guards.ts` are the foundation).
23. **agent-openai → `@openai/agents` v0.8.x** — same shape change for
    the OpenAI side. Unlocks structured tool workflows + computer-use
    when those become useful for review (e.g., screenshot-driven design
    review). The base SDK doesn't expose these cleanly; the agents SDK
    is the path.

Both migrations preserve the public `Agent` interface in `core/agent.ts`
— callers don't change. Internal implementation switches from "one
structured-output call" to "loop until done."

---

## H7 — Pluggable expansion (trigger-based, ~10 items)

Ship only when a user requests an agent or platform outside the current
set, OR a use case lands that needs one. Each item is independently
shippable; the order below is rough first-request probability. Decision
#32 already designates these as deferred-pending-trigger.

**Agents** — mirror `packages/agent-claude` shape.

24. **agent-qwen** — Alibaba Qwen series. Strong multilingual +
    Chinese code corpus. Likely first request from Asian users.
25. **agent-bedrock** — AWS Bedrock surface for org-mandated
    AWS-only-LLM policies (enterprise BYO).
26. **agent-vertex** — Google Cloud Vertex for the same reason on GCP.
27. **agent-cheetah** — Triton-hosted self-hosted option mentioned in
    decision #28.

**Platforms** — mirror `packages/platform-railway` shape.

28. **platform-fly** — Fly.io deploy-status adapter.
29. **platform-replit** — Replit deploy-status adapter.
30. **platform-vertex-deploy** — Google Cloud Run / App Engine.
31. **platform-docker-local** — local Docker Compose detection for the
    self-hoster path.

**SCM** — first one is the largest unlock; bitbucket + gitea are
incremental once the gitlab adapter exists.

32. **scm-gitlab** — GitLab webhook + MR adapter.
33. **scm-bitbucket** — Bitbucket pipeline adapter.
34. **scm-gitea** — self-hosted Gitea adapter.

---

## H8 — Ecosystem (post-PMF, demand-driven)

Build only after the SaaS path has paying users and per-PR economics
are validated against revenue. Today these would dilute focus.

35. **Multi-user tenancy polish** — install isolation, per-user billing
    seat, organization seats + RBAC, audit log. Partial today (each
    install maps to one user); needs to become first-class.
36. **Template marketplace** — `conclave init --template react-fullstack`
    style. Curated templates with PRD + answer-keys + failure-catalog
    pre-seeded for common app shapes (Next.js commerce, ai-chatbot,
    monorepo, etc.).
37. **Public dashboard** — public-facing review history, merge patterns,
    category trends per repo. Opt-in marketing surface; doubles as
    social proof for new visitors.
38. **Fine-tune layer for heavy users** — when a user's answer-keys
    cross a threshold (~500 entries), offer a fine-tuned router model.
    Council cost halves; opt-in. Genuinely earned by power users with
    enough RLHF substrate to make a fine-tune worth it.

---

## Superseded / archived (intentionally not building)

Items present in `ARCHITECTURE.md` (2026-04-19 lock) that the operating
model has since routed around. Listed here so a future reader doesn't
re-prioritize them by accident. These are *archived*, not *invalidated*
— if a future trigger condition fires, the original intent is the right
starting point.

| Item | Original intent | Current substitute | Reopen trigger |
|---|---|---|---|
| `apps/vscode-extension` | Native IDE integration | MCP stdio (`conclave mcp-server`) — Cursor, Claude Desktop, Windsurf already consume it directly. | MCP becomes second-class on a hot IDE; bespoke extension delivers materially better UX than the stdio path. |
| `apps/web-dashboard` | Cost / trace visualization | Admin endpoints (`/admin/install-summary`, `/admin/learning-stats`) + self-hosted Langfuse cover the operator view. User-facing surface is the marketing landing. | SaaS has enough users that an in-product dashboard converts churn-risk users back to retention; a marketing page is no longer enough. |
| Mastra graph orchestration | Multi-agent graph runtime | `Council.deliberate()` + `TieredCouncil` is hand-rolled and ~150 LOC — lighter than the Mastra dependency. The "Mastra" label is retained in ARCHITECTURE.md as historical context only. | Council shape grows to a real DAG with conditional branches, parallel substages, and rollback paths that hand-rolled control flow can't express cleanly. |
| Semantic rules (`semantic/rules.json`) + Procedural playbooks promotion | Nightly Haiku compress → weekly semantic → monthly procedural | Episodic → answer-keys / failure-catalog direct write is producing usable RAG hits without the mid-tier compression layer. Intermediate layers added latency without lifting retrieval quality in dogfood. | Retrieval quality plateaus past ~10k entries and the cause is signal dilution rather than corpus quality. |

---

## Sprint sequencing (target — updated 2026-05-11)

- ~~Week 1-2~~: H1 (all 5 items). ✅ DONE 2026-04-27.
- ~~Week 3-4~~: H1.5 A / B / C. ✅ DONE 2026-04-28.
- ~~Month 2~~: H2 #6-#10. ✅ DONE 2026-04-28.
- ~~Month 3-4~~: H3 #11-#15. ✅ DONE 2026-04-28.
- **Now (2026-05)**: H4 cleanup. Each item ~30 minutes, independently
  revertable. Ship as small commits, not a single sweep.
- **After LS approval + first external installer + a few weeks of
  outcome data**: H5 orchestrator-template. The trigger for this is
  Bae or a third party actually trying to wire conclave into a new
  repo and hitting copy-paste friction.
- **Mid-2026, when a council agent starts wanting mid-review tool
  use**: H6 Agent SDK migration. The trigger is real, not arbitrary —
  wait for it. Premature migration adds 3.9 MB of bundle and a loop
  surface for zero feature lift.
- **2027 demand-driven**: H7 individual agent / platform / SCM
  packages as users request them. Don't build any of these
  speculatively.
- **2027+ post-PMF**: H8 Ecosystem once paying users + per-PR
  economics make the multi-tenancy / marketplace / fine-tune builds
  pay for themselves.
