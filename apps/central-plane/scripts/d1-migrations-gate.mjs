#!/usr/bin/env node
/**
 * D1 migrations gate — refuse a Worker deploy while the remote database has
 * migrations this checkout knows about but has not applied.
 *
 * Why (PR #553 review P1): the Worker's SELECTs reference columns by name
 * (`region_at_create`, `source_check_id`, `verify_check_id`, …). Additive
 * migrations are safe for old ROWS, not for an old SCHEMA — a Worker built
 * after 0069 deployed onto a D1 without 0069 makes every ownership check
 * (`getProject`) throw, so every /workspace/projects/:id/* route is a 500.
 * The order "apply migrations, then deploy" used to be a sentence in a PR
 * body; this script makes it a step that fails.
 *
 * Fail-closed: the gate passes ONLY when wrangler exits 0 and prints
 * "No migrations to apply". Pending names → refuse (and name them). Auth or
 * network trouble → refuse ("don't know" is not "up to date").
 *
 * Usage:  node scripts/d1-migrations-gate.mjs [database-name]   (default: conclave-ai)
 * Env:    CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID as wrangler expects.
 * Wired:  .github/workflows/deploy-central-plane.yml (unconditional step before
 *         "Deploy Worker") and `pnpm ship`.
 *
 * The parser is exported and unit-tested (test/d1-migrations-gate.test.mjs);
 * only `main` touches wrangler.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** A migration file name as `wrangler d1 migrations list` prints it in its table. */
export const MIGRATION_NAME_RE = /\b\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql\b/g;

const UP_TO_DATE_RE = /No migrations to apply/i;

/**
 * Names of migrations wrangler reports as NOT applied remotely. `[]` when the
 * output says the database is up to date (or names nothing).
 * @param {string | undefined | null} output
 * @returns {string[]}
 */
export function parsePendingMigrations(output) {
  const text = String(output ?? "");
  if (UP_TO_DATE_RE.test(text)) return [];
  const names = new Set();
  for (const m of text.matchAll(MIGRATION_NAME_RE)) names.add(m[0]);
  return [...names].sort();
}

/**
 * Turn a `wrangler d1 migrations list` run into a verdict.
 * @param {{ status: number | null, stdout?: string | null, stderr?: string | null }} run
 * @returns {{ ok: boolean, pending: string[], reason: string }}
 */
export function evaluateMigrationsList(run) {
  const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (run.status !== 0) {
    return { ok: false, pending: [], reason: `wrangler exited ${run.status ?? "null"} — cannot confirm the remote schema` };
  }
  if (UP_TO_DATE_RE.test(text)) return { ok: true, pending: [], reason: "remote D1 is up to date (no migrations to apply)" };
  const pending = parsePendingMigrations(text);
  if (pending.length > 0) {
    return {
      ok: false,
      pending,
      reason: `${pending.length} unapplied migration(s): ${pending.join(", ")} — apply them (migration <id> apply approved.) before deploying the Worker`,
    };
  }
  return { ok: false, pending: [], reason: "could not recognize wrangler output — refusing to assume the database is up to date" };
}

function main() {
  const db = process.argv[2] ?? "conclave-ai";
  const run = spawnSync("npx", ["wrangler", "d1", "migrations", "list", "--remote", db], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const verdict = evaluateMigrationsList(run);
  const line = JSON.stringify({ gate: "d1-migrations", db, ok: verdict.ok, pending: verdict.pending, reason: verdict.reason });
  if (verdict.ok) {
    process.stdout.write(`${line}\n`);
    process.exit(0);
  }
  process.stderr.write(`\n${line}\nd1-migrations-gate: REFUSING to deploy — ${verdict.reason}\n`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
