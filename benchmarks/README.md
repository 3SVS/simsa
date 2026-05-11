# conclave-benchmarks (skeleton)

> **Status — pre-publication skeleton.** This directory will be lifted
> into a standalone `seunghunbae-3svs/conclave-benchmarks` GitHub repo
> once the raw scoring data is cleaned for release. The READMEs and
> protocol below define the contract that the eventual public repo will
> honor. Until then, raw per-PR run artifacts live in the private
> `.conclave/episodic/<sha>/` snapshots of the runs that fed
> `/blockers-per-pr = 10.93` in the root README's evidence table.

## Why this exists

The root README's evidence table cites:

| | **Conclave (3-agent)** | **Claude alone** |
|---|---|---|
| Catch rate (synthetic blockers) | 100% | 100% |
| Mean blockers surfaced per PR | **10.93** | 3.80 |

That `10.93` is an internal-dogfood number. A reader who wants to
verify it deserves three things:

1. The exact **15 PRs** (template repo · branch · diff hash) so they
   can replay the same diff against the same template state.
2. The **scoring rubric** that turned each verdict + blocker list into
   a comparable number — including how we de-duped near-identical
   findings between agents.
3. The **raw output** of each council run (verdict, blockers,
   per-agent transcript) so the score can be re-derived without trust.

This skeleton specifies (1) and (2). (3) is the part that's still
private — it requires an extraction pass over `.conclave/episodic/`
and a redaction step (no API keys, no proprietary URLs, no
account names that didn't agree to publication).

## Layout (planned)

```
benchmarks/
├── README.md               (this file — overview + status)
├── protocol.md             (how a run is reproduced, end to end)
├── templates.md            (the 5 Next.js templates + each synthetic bug)
├── scoring.md              (rubric: weight, dedupe, "blocker" definition)
├── results/
│   ├── 2026-04/            (snapshot directory — TBD format)
│   │   ├── pr-01.json
│   │   ├── pr-02.json
│   │   └── ...
│   └── README.md           (changelog of result snapshots)
└── replay/
    └── replay.mjs          (CLI: replay one PR end-to-end on your own keys)
```

What's checked in **now**: `README.md`, `protocol.md`, `templates.md`,
`scoring.md`.

What's still pending: `results/` (raw outputs) and `replay/` (a
hermetic replay harness). Both are gated on the redaction pass.

## When this gets split out

Trigger conditions:

1. At least one external user has cited the `10.93` number in public
   (issue / blog / PR) AND
2. The redaction pass has run on `.conclave/episodic/<sha>/` for all
   15 PRs without finding leaks.

Until both hold, the skeleton lives here so the source link in the
root README disclaimer doesn't 404. Once both hold:

```bash
git subtree split --prefix=benchmarks/ -b benchmarks-split
gh repo create seunghunbae-3svs/conclave-benchmarks --public --source=benchmarks-split
```

Root README footnote will be updated to point at the new repo URL.

## Not in scope

- This is not a model leaderboard. The point isn't "Claude vs GPT vs
  Gemini" — it's "one model vs three models reading the same PR." A
  proper model-pair shootout would need an order-of-magnitude more
  PRs and is not the question this benchmark answers.
- This is not a verdict-quality study. We measure depth (blocker
  count and category coverage) at a fixed catch rate of 100% for
  obvious bugs. Whether the additional 7 blockers per PR are
  actually worth surfacing is a follow-up study, not this one.
