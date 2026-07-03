# Pre-1.0 surface audit

**Date:** 2026-05-10  
**Latest published:** `@simsa/cli@0.16.2` (lockstep `v0.14.2`)

This audit inventories every public surface of conclave-ai and classifies
each item against a 1.0 stability commitment. It is the input to the
"pre-1.0 surface review before bumping past 0.x" carryover from the
2026-05-10 launch-readiness check.

Classification legend:

| Tag | Meaning |
|---|---|
| ✅ **stable** | Commit to backward-compat at 1.0. Renames/removals require deprecation cycle. |
| 🟡 **stable-target** | Intend to keep at 1.0 but flag/name may still move. Usable today; expect minor breaks before 1.0. |
| 🔬 **operator-only** | Runs only with admin / internal token. Not part of the BYO-user 1.0 contract. Free to evolve. |
| ⏳ **dev-only** | Internal scaffold or migration helper. Hide from `--help`, gate behind `--dev`, or remove. |
| 🚫 **deprecate** | Slated for removal before or during 1.0. Add deprecation notice + replacement pointer. |

---

## 1. CLI commands (22)

Surface enumerated from `packages/cli/src/index.ts` HELP block (auth/source-of-truth). Order matches the `switch` statement.

| Command | Class | Notes |
|---|---|---|
| `init` | ✅ stable | First-run setup. Writes `.conclaverc.json`. Behavior locked since v0.4. |
| `config` | ✅ stable | Persistent credential storage (`get` / `set` / `list`). v0.7.4 contract is intuitive and load-bearing. |
| `audit` | ✅ stable | Full-project health check. Distinct from `review` (which is PR-scoped). Hard budget ceiling already enforced. |
| `review` | ✅ stable | Core BYO entry point. JSON output schema (incl. `metrics.rag` from Sprint D) is a public contract. |
| `rework` | ✅ stable | Apply worker-generated patch for a pending council `rework` verdict. Pairs with `review --autonomy`. |
| `autofix` | ✅ stable | Autonomous loop: review → patch → build → test → commit. L2 autonomy (final merge stays manual). |
| `record-outcome` | ✅ stable | Manual outcome capture for episodic memory. Used by humans + the GitHub App webhook. |
| `poll-outcomes` | ✅ stable | Auto-classify pending reviews against live PR state. Cron-friendly. |
| `seed` | 🟡 stable-target | Bootstrap from bundled `solo-cto-agent` failure catalog (decision #18). Useful on first-run. May be auto-folded into `init` post-1.0 (one fewer command). |
| `migrate` | 🚫 deprecate | Solo-cto-agent → conclave-ai migration helper. Solo-cto-agent 1.4.x stays installable (decision #27) but new users won't have it. Plan: deprecation notice in 0.17, removal in 1.x. |
| `scores` | ✅ stable | Per-agent performance scores (decision #19). Useful diagnostic; rarely reads, but valuable when needed. |
| `sync` | 🟡 stable-target | Manual federated sync. With `federated.autoPull` default true, manual sync is now power-user only. Keep but de-emphasize in `--help`. |
| `mcp-server` | ✅ stable | MCP stdio server for IDE clients (decision #11). Wire format is the IDE integration contract. |
| `repos` | ✅ stable | Multi-repo watchlist (`add` / `remove` / `list`). v0.12 contract. |
| `watch` | ✅ stable | Local daemon — polls watched repos, dispatches reviews. Pairs with `repos`. |
| `doctor` | ✅ stable | Discoverable health check. Exit code is the contract; output text is allowed to evolve. |
| `status` | ✅ stable | One-line install summary; `--verbose` for breakdown. v0.13.16. |
| `login` | ✅ stable | Device Flow auth for Conclave SaaS. v0.16. |
| `logout` | ✅ stable | Revoke + remove `~/.conclave/auth.json`. |
| `whoami` | ✅ stable | Print current SaaS user. Matches `git`/`gh` convention. |
| `feedback` | ✅ stable | v0.16.10 / Sprint B. Closes the self-evolve loop on the user side. |
| `help` / `--help` / `-h` / `--version` / `-v` | ✅ stable | Built-in. |

**Stable on commit:** 18  
**Stable-target (may rename/restructure):** 2 (`seed`, `sync`)  
**Deprecate:** 1 (`migrate`)  
**No `🔬 / ⏳`** — every command is part of the BYO contract.

---

## 2. Admin endpoints (20)

All under `/admin/*`, gated by `INTERNAL_CALLBACK_TOKEN` or `requireInstallAuth`. **Operator-only contract** — none of these is part of the 1.0 BYO-user surface, so all are 🔬 by definition. Listed here so we don't accidentally expose one without intending to.

| Method + path | Source | Class |
|---|---|---|
| `GET /admin/webhook-status` | `routes/admin.ts:28` | 🔬 |
| `POST /merge/notify` | `routes/admin.ts:100` | 🔬 |
| `GET /admin/install-summary` | `routes/admin.ts:166` | 🔬 |
| `POST /dev-loop/notify` | `routes/admin.ts:283` | 🔬 |
| `POST /admin/rebind-webhook` | `routes/admin.ts:328` | 🔬 |
| `POST /admin/classify-feedback` | `routes/feedback.ts:177` | 🔬 |
| `GET  /admin/learning-stats` | `routes/learning-stats.ts:53` | 🔬 |
| `POST /admin/run-oss-pr-miner` | `routes/oss-patterns.ts:31` | 🔬 |
| `POST /admin/promote-seeds` | `routes/promoted-seeds.ts:38` | 🔬 |
| `POST /admin/prompt-variants` | `routes/prompt-variants.ts:49` | 🔬 |
| `GET  /admin/prompt-variants` | `routes/prompt-variants.ts:83` | 🔬 |
| `POST /admin/prompt-variants/:id/status` | `routes/prompt-variants.ts:99` | 🔬 |
| `POST /admin/prompt-variant-outcomes` | `routes/prompt-variants.ts:126` | 🔬 |
| `GET  /admin/prompt-evaluation` | `routes/prompt-variants.ts:162` | 🔬 |
| `POST /admin/refresh-references` | `routes/references.ts:40` | 🔬 |
| `GET  /admin/source-candidates` | `routes/source-candidates.ts:37` | 🔬 |
| `POST /admin/source-candidates/:id/decide` | `routes/source-candidates.ts:49` | 🔬 |
| `POST /admin/run-source-discovery` | `routes/source-candidates.ts:69` | 🔬 |
| `GET  /admin/spawned-agents` | `routes/spawned-agents.ts:40` | 🔬 |
| `POST /admin/spawned-agents/:id/status` | `routes/spawned-agents.ts:52` | 🔬 |
| `POST /admin/run-agent-spawner` | `routes/spawned-agents.ts:72` | 🔬 |
| `POST /admin/run-changelog-monitor` | `routes/spec-updates.ts:30` | 🔬 |

**Audit conclusion:** every match has `requireInstallAuth` or an `INTERNAL_CALLBACK_TOKEN` check at the route boundary — no orphans. The admin surface stays operator-only at 1.0.

---

## 3. Config schema (`.conclaverc.json`, version 1)

Surface from `packages/cli/src/lib/config.ts` `ConclaveConfigSchema`. Top-level sections only; nested fields share the section's classification.

| Section | Class | Notes |
|---|---|---|
| `version: 1` | ✅ stable | Schema version field. Bump to `2` when introducing breaking changes; we keep `1` parser around for one minor cycle. |
| `agents[]` | ✅ stable | Enum of `claude / openai / gemini / ollama / grok / design`. |
| `budget.perPrUsd` | ✅ stable | Hard ceiling enforced before any LLM call (gate). |
| `efficiency.*` | ✅ stable | Cache / compact / diff-splitter knobs. Defaults are good. |
| `memory.*` | ✅ stable | Answer-keys / failure-catalog dirs + active-failure-gate knobs. |
| `observability.langfuse` | ✅ stable | Optional self-hosted tracing. Optional section, opt-in. |
| `integrations.{telegram, discord, slack, email}` | ✅ stable | Equal-weight notifiers. Same shape across all four. |
| `council.maxRounds` / `council.enableDebate` / `council.agentScoreRouting` | ✅ stable | Flat-council knobs. |
| `council.domains.{code, design}` | 🟡 stable-target | 2-tier domain config supersedes flat fields when present. The shape is solid but `domains` keys may broaden post-1.0 (security, perf). |
| `federated.*` | ✅ stable | `enabled / endpoint / autoPush / autoPull / autoPullMaxAgeMs`. UX-10 default-on autoPull is the moat. |
| `visual.*` | ✅ stable | Multi-modal review (routes, viewport, budgetMultiplier). |
| `autoDetect.*` | ✅ stable | Domain auto-detection from changed files. |
| `audit.*` | ✅ stable | `audit` command defaults. Hard ceiling at CLI layer. |
| `output.plainSummary` | ✅ stable | Plain-language summary for non-dev surfaces. |
| `context.*` | ✅ stable | README + design-reference auto-injection bounds. |
| `autonomy.*` | ✅ stable | Auto-rework loop knobs. Hard ceiling of 5 cycles in core. |

**Deprecation candidates:** none. Every section has been used in production for at least one minor cycle.

---

## 4. Action items before 1.0

Ordered by lift, low → high.

1. **Add deprecation notice to `migrate`** — print a one-line "deprecated since 1.0; will be removed in 2.x" warning when the command runs. (`packages/cli/src/commands/migrate.ts`, ~5 lines.)
2. **De-emphasize `sync` in `--help`** — remove from the prominent list, keep accepting the command. With `federated.autoPull` default true, manual sync is power-user-only. (`packages/cli/src/index.ts` HELP block, comment-out vs. remove TBD.)
3. **Decide whether to fold `seed` into `init`** — `init --bootstrap` flag would replace `init` then `seed`. Keep as separate command if existing solo-cto-agent users rely on the standalone form. (Defer decision; not required for 1.0.)
4. **Update CLAUDE.md command count** — currently says "17 commands", actual is 22. (One-line edit.)
5. **Pin the CLI `--json` schema** — `metrics.rag` was added in Sprint D; document the JSON output as a public contract in `docs/getting-started.md` so consumers can rely on it. (~40 lines of docs.)
6. **Lock `version: 1` schema commitment** — mention in `docs/configuration.md` that v1 will keep parsing for one minor cycle after v2 lands. (~10 lines of docs.)
7. **Add a `--dev` gate convention** — for any future flag/command we want to keep but not advertise, document one canonical form. We don't need any today; this is a guideline for E5 wire-in and similar future work.

**Not required for 1.0:** retiring any admin endpoint, restructuring the config schema, or splitting BYO from SaaS surfaces. The current shape is the 1.0 shape.

---

## 5. Conclusion

Surface is in good shape for 1.0. **Zero**`🚫 deprecate` items in admin/config; **one** in CLI (`migrate`). **Three** soft cleanup items (action items #1, #2, #4 above) account for everything substantive.

The actual gate for 1.0 is unrelated to surface: it's accumulated outcome data for E4's "promote-then-measure" path to validate the substrate, plus the `/saas/review` + `/saas/autofix` container wiring. Surface is not the bottleneck.
