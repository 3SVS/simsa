# CLI JSON output — public contract

Two CLI commands emit machine-readable JSON for downstream tooling
(`conclave autofix`, dashboards, benchmarks, GitHub Actions workflows):

- `conclave review --json` → single JSON object on stdout, one line.
- `conclave audit --output json` (or `--json-out <path>`) → multi-line
  pretty-printed JSON.

This document is the **public contract**: any field documented here is
backward-compatible across `0.x` minor bumps and across `1.0`.
Unannotated fields surfaced by the implementation today are NOT
contract — they may change without notice.

## Stability commitment

| Rule | Why |
|---|---|
| Documented field NAMES never change between 0.x minor releases. | Downstream parsers can pin against `0.16.x` and trust 1.0 won't move them. |
| Documented field TYPES never widen mid-`0.x`. A string field stays a string; a number field stays a number. | Pinned shapes let consumers choose strict schemas. |
| New fields may be added, but always at field-level (additive). | Old parsers ignoring unknown keys keep working. |
| Field REMOVAL only happens at major bumps with one-minor-cycle deprecation lead. | Same policy as the `version: 1` config schema (see `pre-1.0-surface-audit.md`). |
| Order of array elements is stable per documented sort key (e.g. severity for findings). Object key order is NOT contract — parse by name. | Stream-friendly without forcing a JSON-canonicalization step. |

Source of truth: `packages/cli/src/lib/review-json-output.ts` (review)
and `packages/cli/src/lib/audit-output.ts` (audit).

---

## `conclave review --json`

Exits with the matching status code (`0` approve, `1` rework, `2`
reject); the structured payload is the **only** stdout content. All
diagnostic / progress messages are routed to stderr when `--json` is
set so the parser can `json.loads(p.stdout)` without preprocessing.

### Top-level shape

```json
{
  "verdict": "approve" | "rework" | "reject",
  "domain": "code" | "design" | "mixed",
  "tiers": { … },
  "agents": [ … ],
  "metrics": { … },
  "episodicId": "ep_…",
  "sha": "abc123…",
  "repo": "owner/name",
  "prNumber": 42,
  "plainSummary": { … }
}
```

| Field | Type | Always present? | Notes |
|---|---|---|---|
| `verdict` | string enum | yes | `approve` / `rework` / `reject`. The council's final verdict. |
| `domain` | string enum | yes | `code` / `design` / `mixed`. Auto-detected from changed files unless `--domain` overrode. |
| `tiers` | object | yes | Tier-level verdicts; see below. Flat-council runs still emit this with tier-1 reflecting the run + tier-2 = `0/""`. |
| `agents` | array | yes | Per-agent results (one entry per agent that produced a `ReviewResult`). |
| `metrics` | object | yes | Efficiency-gate aggregate; see below. |
| `episodicId` | string | yes | Stable id under `.conclave/episodic/`. Pass to `conclave record-outcome --id` to attribute merge/reject outcomes back. |
| `sha` | string | yes | The reviewed commit SHA. |
| `repo` | string | yes | `owner/name` form, e.g. `acme/my-app`. |
| `prNumber` | number | only when reviewing a real GitHub PR | Absent for plain `git diff` runs. |
| `plainSummary` | object | only when `output.plainSummary.enabled` | English/Korean rewrite; shape pinned by `PlainSummary` in core. |

### `tiers`

```json
{
  "tier1Count": 3,
  "tier1Verdict": "approve" | "rework" | "reject",
  "tier2Count": 0,
  "tier2Verdict": "" | "approve" | "rework" | "reject"
}
```

When `TieredCouncil` is in use (config `council.domains.<domain>` set):
both tiers carry actual participant counts and per-tier verdicts.
`tier2Verdict` is the empty string when no escalation happened.

When the legacy flat `Council` is used (no `domains` config):
`tier1Count` = total agents in the council, `tier1Verdict` = the final
council verdict, `tier2Count` = 0, `tier2Verdict` = `""`.

### `agents[]`

```json
{
  "id": "claude" | "openai" | "gemini" | "design" | "ollama" | "grok" | "sa_<spawned-agent-id>",
  "verdict": "approve" | "rework" | "reject",
  "blockers": [
    {
      "severity": "blocker" | "major" | "minor" | "nit",
      "category": "<free-form>",
      "message": "<short imperative>",
      "file": "src/x.ts",
      "line": 42
    }
  ],
  "summary": "<paragraph>"
}
```

`id` may be `sa_<spawned-agent-id>` when a Sprint E5 spawned agent
participated (operator-only feature; BYO users won't see these).
`blocker.file` / `blocker.line` are optional. `category` is free-form
text — see `docs/pre-1.0-surface-audit.md` for the canonical
focus-tag set, but agents may emit categories outside it.

### `metrics`

```json
{
  "calls": 12,
  "tokensIn": 28_500,
  "tokensOut": 1_840,
  "costUsd": 0.0421,
  "latencyMs": 18_300,
  "cacheHitRate": 0.62,
  "rag": { … }
}
```

`rag` is the Sprint D RAG-injection telemetry — see
[RAG injection telemetry](#rag-injection-telemetry) below.

---

## `conclave audit`

`conclave audit --output json` writes the bundle to stdout;
`conclave audit --json-out path/to/report.json` writes to a file (and
implies `--output json` if not set). The shape is identical between
the two paths.

### Top-level shape

```json
{
  "repo": "owner/name",
  "sha": "abc123…",
  "scope": "all" | "ui" | "code" | "infra" | "docs",
  "domain": "code" | "design" | "mixed",
  "filesAudited": 42,
  "filesInScope": 80,
  "sampled": false,
  "discoveryReason": "…",
  "findings": [ … ],
  "perAgentVerdict": [ … ],
  "budgetUsd": 2.0,
  "spentUsd": 1.42,
  "budgetExhausted": false,
  "batchesRun": 3,
  "batchesTotal": 3,
  "metrics": { … },
  "ragInjection": { … }
}
```

| Field | Type | Notes |
|---|---|---|
| `scope` | string enum | What the user passed via `--scope` (or the config default). |
| `filesAudited` / `filesInScope` | numbers | "Audited" is what actually fed into LLM batches; "in scope" is what discovery returned. They differ when `--max-files` truncates. |
| `sampled` | boolean | True when `filesAudited < filesInScope` and discovery hit the cap. |
| `findings[]` | array | Deduplicated across agents (key = file + 5-line-bucket + category + severity). Sorted by severity desc, then category, then file. |
| `perAgentVerdict[]` | array | Per-agent batch counts: `{ agent, approvedBatches, reworkBatches, rejectBatches }`. |
| `budgetUsd` / `spentUsd` / `budgetExhausted` | numbers + boolean | Hard ceiling enforced at $10 (audit) regardless of config. `budgetExhausted: true` means the audit ran out of budget mid-way and the report is partial. |
| `batchesRun` / `batchesTotal` | numbers | Same semantics — partial when `batchesRun < batchesTotal`. |
| `metrics` | object | Same shape as `review --json`'s `metrics` (sans the `rag` sub-object — audit's RAG telemetry sits at top level under `ragInjection`). |
| `ragInjection` | object | See below. Optional — emitted when at least one RAG source contributed context. |

### `findings[]`

```json
{
  "severity": "blocker" | "major" | "minor" | "nit",
  "category": "<free-form>",
  "file": "src/components/Button.tsx",
  "line": 84,
  "message": "<imperative>",
  "agents": ["claude", "openai"],
  "subsystem": "ui" | "code" | "infra" | "docs"
}
```

`agents` is the union of agents that flagged this `(file, line, category,
severity)` cell. `subsystem` is a coarse derivation from the file path
and is more stable than the agent-supplied `category`.

---

## RAG injection telemetry

Surfaced under `metrics.rag` in `review --json` and at top level
`ragInjection` in `audit`'s JSON. Shape is identical:

```json
{
  "answerKeysLocal": 12,
  "answerKeysPromoted": 4,
  "answerKeysExternal": 7,
  "answerKeysOssPatterns": 2,
  "answerKeysSpecUpdates": 1,
  "failureCatalogLocal": 18,
  "failureCatalogPromoted": 3,
  "failureCatalogExternal": 5,
  "failureCatalogOssPatterns": 1,
  "failureCatalogSpecUpdates": 0
}
```

Each field is the count of context entries that were available to
agents in this pass, broken out by source:

| Source | Where it comes from |
|---|---|
| `*Local` | The repo's own `.conclave/answer-keys/` + `.conclave/failure-catalog/` (incl. bundled solo-cto-agent seeds). |
| `*Promoted` | `/seeds/promoted/<domain>` (Sprint C — community user feedback that crossed the threshold). |
| `*External` | `/references/<domain>` (Phase 4 — curated external references). |
| `*OssPatterns` | `/seeds/oss-patterns/<domain>` (Sprint E2 — bugfixes mined from popular OSS PRs). |
| `*SpecUpdates` | `/seeds/spec-updates/<domain>` (Sprint E3 — React/Next.js/Tailwind/etc. release-note diffs). |

`*OssPatterns` and `*SpecUpdates` are optional fields — older CLIs
emit zero in their place. Treat their absence as `0`.

---

## Versioning the JSON contract

This document tracks the shape as of `@simsa/cli@0.16.2` /
`v0.14.2`. Breaking changes (rename, remove, type widen) are
forbidden across `0.x` minor releases and require:

1. A new field carrying the new shape, shipped one minor before the
   old field is removed.
2. A line in `CHANGELOG.md` under `### Breaking` calling out the
   field + cutover version.
3. A row in this doc's "Stability commitment" table updated with the
   new policy.

For the consumer side: pin against the documented fields, ignore
extras, and assume `0.x.y → 0.x.(y+1)` is safe.
