/**
 * spike.mjs — Stage 258A orchestrator. Runs the completion loop TWICE against the same authorized
 * target, then writes the reproducibility comparison. LOCAL/DEV ONLY.
 *
 * Usage: node spike.mjs <outRoot>
 *   outRoot defaults to the stage artifact dir under conclave-builder-pack/out/.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnce } from "./run.mjs";
import { compareRuns, renderComparisonMarkdown } from "./lib/compare.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const outRoot = resolve(
  process.argv[2] ||
    join(here, "..", "..", "conclave-builder-pack", "out", "stage-258a-external-vibe-app-completion-loop-spike"),
);

const config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
mkdirSync(outRoot, { recursive: true });

console.log(`[spike] target: ${config.targetUrl}`);
console.log(`[spike] intent: ${config.intentAnchor}`);

const r1 = await runOnce(config, "run-1", join(outRoot, "run-1"));
console.log(`[spike] run-1 → ${r1.decision}`);
const r2 = await runOnce(config, "run-2", join(outRoot, "run-2"));
console.log(`[spike] run-2 → ${r2.decision}`);

const cmp = compareRuns(r1, r2);
writeFileSync(join(outRoot, "reproducibility-comparison.md"), renderComparisonMarkdown(cmp, r1, r2));
console.log(`[spike] ${cmp.verdict}`);
