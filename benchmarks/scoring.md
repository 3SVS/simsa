# Scoring — what counts as a "blocker"

The headline `10.93` and `3.80` numbers are blocker counts averaged
over 15 PRs. This document defines exactly what a blocker is and how
duplicates are collapsed across agents.

## A blocker is a triple

Each entry on the council's output that has all three of:

1. `severity ∈ { "blocker", "major" }`. Nits and style issues are
   excluded — reviews on a vibe-coder Next.js template surface a long
   tail of those and counting them would inflate the multi-agent
   number unfairly (more agents = more nits found, but nits aren't
   what the council is for).
2. `category ∈ { spec-mismatch, security, a11y, testing, regression,
   correctness, deploy-safety }`. The full enum is in
   `packages/failure-classifier/`.
3. A `file` or `path` field pointing at an actual file in the diff.
   "Architecture" blockers without a file pointer are excluded from
   the count to keep the metric anchored to checkable claims.

## De-duplication

The three council agents often surface the same underlying bug from
slightly different angles. We do NOT count them as three.

Dedupe key: `(category, file, line ± 5, normalized_message)` where
`normalized_message` is the message lowercased, with `\s+` collapsed
to `_` and dropping any agent-name token. Two entries with the same
key fold into one — the score doesn't reward "three agents agreed."
What the score rewards is **breadth** of distinct findings.

This is the most consequential design choice in the rubric:
multi-agent depth is measured as the *additional unique findings* the
council surfaces beyond the single-agent baseline, not as a tally of
agreements.

## What this means for "Claude alone"

The single-agent baseline runs Claude (the same `claude-sonnet-4-6`
model) on identical inputs and reports its blockers under the same
dedupe rule applied to itself. Self-dedupe is rare but non-zero — a
single agent occasionally reports the same bug twice in a long
review. Roughly: ~5% reduction on the raw count.

## What `10.93` actually means

3-agent council, 15 PRs:

- Sum of distinct (post-dedupe) blocker entries across all PRs.
- Divide by 15.
- Mean = **10.93** blockers per PR.

This number is not normalized against PR size. Some PRs in the
synthetic set are larger than others; we publish the unnormalized
mean rather than the median or a size-weighted average because (a)
the headline is "how much depth does multi-agent buy" and (b) the
sample is small enough that mean and median are within 0.4 of each
other anyway. See `results/<snapshot>/summary.json` for both numbers
once the raw data is published.

## What's NOT counted

- Suggestions / polish / "consider also doing X" notes.
- Findings outside the diff (e.g. "this whole file is bad" without a
  specific line). Out-of-diff lint is useful but unfair to multi-agent
  counts because more agents = more general-purpose linting noise.
- Findings the agent itself marks as `severity: "nit"`.
- Multi-line findings collapsed onto a `range`. The dedupe key uses
  the first line of the range, so a finding spanning lines 12–45 dedupes
  against another finding at line 14 of the same file in the same
  category, which is the right behavior.

## Open questions in the scoring rubric

We genuinely don't know:

1. Whether 5-line proximity is the right dedupe radius. A larger
   radius (say 20 lines) would compress the multi-agent number; a
   smaller one (1 line) would inflate it. We chose 5 because it's
   wider than a function body but narrower than a module, which
   matches the usual scope of a single bug.
2. Whether category enum should be richer. Today `correctness` is a
   bucket for "wrong logic but not in another category" — that's
   ~12% of all blockers and could plausibly split into more
   informative subcategories. Once results are published the split
   becomes auditable.

These are listed openly so the eventual `conclave-benchmarks` repo
can attract pushback on choices we'd rather hear about before they
calcify.
