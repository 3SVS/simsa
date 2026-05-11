# Protocol — Conclave AI benchmark v1

How a single benchmark run is reproduced from scratch.

## Hardware / model assumptions

- Council models (tier-1, single round):
  - `claude-sonnet-4-6` (anthropic)
  - `gpt-5.4` (openai)
  - `gemini-2.5-pro` (google)
- "Claude alone" comparison run uses the same `claude-sonnet-4-6`
  model with the identical PR diff + project context, single agent,
  single round.
- All runs go through the efficiency gate (`packages/core/src/efficiency/`)
  with default budget per-PR = $1.00, prompt-cache enabled,
  compact-context enabled. **No tier-2 escalation** for the headline
  numbers — escalation would skew "blockers per PR" upward in a way
  that no longer compares like-for-like with the single-agent baseline.

## Inputs per PR

Each of the 15 PRs is specified as a tuple:

- `template_repo` — one of the 5 templates listed in `templates.md`.
- `base_branch` — the upstream `main` commit SHA the bug was planted
  against. Pinned.
- `bug_branch` — the branch produced by applying the synthetic bug
  patch on top of base. Pinned commit SHA.
- `prd_path` — relative path to the `.conclave/prd.md` the PR was
  reviewed against. Some PRs have it, some don't (we measure the
  spec-mismatch delta separately).

The diff that goes to the council is exactly `git diff base_branch
bug_branch`. The new SHA is `bug_branch`. The synthetic bug catalog
is in `templates.md`.

## What gets recorded per run

Per-PR run, both for "Conclave (3-agent)" and "Claude alone":

- `verdict` — final aggregated verdict (approve / rework / reject).
- `blockers[]` — each with `{category, severity, file, line, message}`.
  Blockers are de-duplicated by `(category, file±5 lines, normalized
  message tokens)` — see `scoring.md` for the exact rule.
- `latency_ms` — wall-clock for the run.
- `cost_usd` — sum across all agents involved.
- `cache_hit_rate` — for the multi-agent run only. Reserved as 0 for
  the single-agent baseline.

## What is NOT recorded

- The raw agent transcripts (we only keep the structured ReviewResult
  emitted by each agent). Reasoning is not part of the score.
- The model temperature / sampling parameters. They are fixed at the
  agent adapter defaults; varying them would change the benchmark
  contract.

## Why catch rate is 100% for both runs

We pre-vet each synthetic bug to ensure that the obvious-correctness
pass surfaces it. If `claude-sonnet-4-6` alone misses a bug, that bug
is dropped from the synthetic set (replaced with a different one) so
that "depth" comparisons are not contaminated by base-model recall
gaps. This is documented openly so readers can decide if it biases the
result — we believe it isolates the multi-agent-depth signal cleanly,
but a stricter benchmark would not pre-vet.

## Aggregation

Headline numbers in the root README table:

- **Catch rate** — fraction of synthetic-bug findings that appear in
  at least one blocker entry. 15/15 by construction (see above).
- **Mean blockers surfaced per PR** — the de-duped blocker count
  averaged across all 15 PRs. The published `10.93` is over the
  3-agent council; the `3.80` is over the single-agent baseline.
  Numbers are arithmetic means, not medians.
- **Latency** — arithmetic mean wall-clock per PR. The 3-agent number
  reflects in-parallel calls (max of per-agent latencies, not sum).
- **Cache hit rate** — arithmetic mean of per-run cache hit ratios on
  the multi-agent runs only.

## Reproducing on your own API keys

When the `replay/` harness ships, the contract will be:

```bash
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
  node benchmarks/replay/replay.mjs --pr 1
```

…which produces a single-PR result JSON identical in shape to what
ends up in `results/<snapshot>/pr-NN.json`. The full 15-run replay is
expected to cost ~$3-5 in API spend at current pricing.
