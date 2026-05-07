/**
 * v0.16.2 — autofix → post-deploy smoke verification glue.
 *
 * Reads `.conclave/smoke.yaml` from the repo root. If absent, skip
 * silently (smoke verification is opt-in). If present, lazy-imports
 * `playwright` (peer dep — also pulled in by visual-review) and runs
 * the smoke step list against the deployed preview URL.
 *
 * Returns null when:
 *   - no .conclave/smoke.yaml configured
 *   - playwright not installed (suggest install)
 *   - browser launch fails
 *
 * Returns a SmokeResult otherwise — verdict 'ok' or 'broken' tells the
 * caller (autofix-pipeline) whether to mark this iteration as
 * deploy-broken vs deploy-verified.
 */
import {
  loadSmokeConfig,
  runSmoke,
  scanForAiSlop,
  type SmokeResult,
} from "@conclave-ai/smoke-verifier";
import {
  classifyFailure,
  type FailureDiagnosis,
} from "@conclave-ai/failure-classifier";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface SmokeRunSummary {
  result: SmokeResult;
  /** Top-level signal for the caller: ok / broken / skipped. */
  outcome: "ok" | "broken";
  /** AI Slop matches scanned from the deployed home page (if fetched). */
  aiSlopHits?: Array<{ reason: string; match: string }>;
  /** Diagnosis from failure-classifier when smoke is broken. */
  diagnosis?: FailureDiagnosis;
}

export async function runSmokeIfConfigured(
  repoRoot: string,
  deployUrl: string,
  log: (msg: string) => void = () => {},
): Promise<SmokeRunSummary | null> {
  const config = await loadSmokeConfig(repoRoot);
  if (!config) {
    log(`smoke: .conclave/smoke.yaml absent — skipping post-deploy verification (opt-in)\n`);
    return null;
  }
  if (config.steps.length === 0) {
    log(`smoke: .conclave/smoke.yaml has no steps — skipping\n`);
    return null;
  }

  // Lazy-import playwright. Many users will already have it via visual-review.
  // Playwright is an optional peer dep — types are not bundled with @conclave-ai/cli
  // because not every user wants the browser binary. The dynamic-import string
  // is opaque to TypeScript so the resolution errors stay runtime-only.
  let chromium: { launch: (opts?: { headless?: boolean }) => Promise<unknown> } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moduleName: string = "playwright";
    const playwright = (await import(moduleName)) as unknown as {
      chromium: { launch: (opts?: { headless?: boolean }) => Promise<unknown> };
    };
    chromium = playwright.chromium;
  } catch (err) {
    log(
      `smoke: playwright not installed in this environment — install with \`pnpm add -D playwright\` to enable post-deploy verification (skipping). ${(err as Error).message}\n`,
    );
    return null;
  }

  log(
    `smoke: running ${config.steps.length} step${config.steps.length === 1 ? "" : "s"} against ${deployUrl}\n`,
  );
  const result = await runSmoke({
    baseUrl: deployUrl,
    config,
    playwright: {
      // Cast: chromium.launch returns Browser; SmokeBrowser shape is structurally
      // compatible. We never call methods outside the documented surface.
      launch: chromium.launch.bind(chromium) as never,
    },
  });

  // Best-effort AI Slop scan against the deployed home page. Doesn't gate
  // verdict — just adds signal to the report. Skip if home failed to load.
  let aiSlopHits: Array<{ reason: string; match: string }> | undefined;
  const homeStep = result.steps.find((s) => s.kind === "goto" && s.status === "pass");
  if (homeStep) {
    try {
      const r = await fetch(deployUrl, {
        headers: { "user-agent": config.userAgent ?? "Conclave AI smoke verifier" },
      });
      if (r.ok) {
        const html = await r.text();
        const hits = scanForAiSlop(html);
        if (hits.length > 0) aiSlopHits = hits;
      }
    } catch {
      // best-effort only
    }
  }

  if (result.verdict === "ok") {
    log(`smoke: ✓ ${result.passed}/${result.totalSteps} steps passed (${result.durationMs}ms)\n`);
  } else {
    log(
      `smoke: ✗ ${result.failed}/${result.totalSteps} step${result.failed === 1 ? "" : "s"} failed — first failure: ${
        result.steps.find((s) => s.status === "fail")?.reason ?? "unknown"
      }\n`,
    );
  }
  if (aiSlopHits && aiSlopHits.length > 0) {
    log(`smoke: ⚠ AI Slop scan: ${aiSlopHits.length} pattern(s) detected on deployed page\n`);
    for (const hit of aiSlopHits.slice(0, 5)) {
      log(`smoke:   - ${hit.reason}: ${hit.match.slice(0, 60)}\n`);
    }
  }

  const summary: SmokeRunSummary = {
    result,
    outcome: result.verdict,
  };
  if (aiSlopHits !== undefined) summary.aiSlopHits = aiSlopHits;

  // When smoke is broken, classify the failure into actionable diagnosis.
  // Pulls package.json deps as repo context for pattern correlation
  // (e.g. "TypeError: fetch failed" + Supabase deps → supabase-paused).
  if (result.verdict === "broken") {
    const firstFail = result.steps.find((s) => s.status === "fail");
    if (firstFail) {
      const evidence = firstFail.evidence as { responseStatus?: number } | undefined;
      const deps = await readPackageJsonDeps(repoRoot);
      const signal: Parameters<typeof classifyFailure>[0] = {
        stepKind: firstFail.kind,
        errorMessage: firstFail.reason ?? "unknown",
      };
      if (evidence?.responseStatus !== undefined) signal.responseStatus = evidence.responseStatus;
      const responseBody = await tryFetchResponseBody(deployUrl);
      if (responseBody !== undefined) signal.responseBody = responseBody;
      if (deps.length > 0) signal.repoContext = { packageJsonDeps: deps };
      try {
        const diagnosis = await classifyFailure(signal);
        summary.diagnosis = diagnosis;
        log(`smoke: diagnosis — ${diagnosis.likelyCause} (confidence ${diagnosis.confidence.toFixed(2)})\n`);
        for (const action of diagnosis.userActions.slice(0, 3)) {
          log(`smoke:   → ${action.step}\n`);
        }
      } catch (err) {
        log(`smoke: classify failed (non-fatal) — ${(err as Error).message}\n`);
      }
    }
  }
  return summary;
}

async function readPackageJsonDeps(repoRoot: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}

async function tryFetchResponseBody(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Conclave AI smoke verifier" } });
    const text = await r.text();
    return text.slice(0, 4096);
  } catch {
    return undefined;
  }
}
