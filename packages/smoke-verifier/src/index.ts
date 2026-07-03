/**
 * @simsa/smoke-verifier — Playwright-driven smoke checks against
 * a live deploy URL after autofix push.
 *
 * Why: Conclave's existing build+test verify in `packages/cli/src/autofix-pipeline.ts`
 * proves the code _compiles_ and _existing tests pass_. It does NOT prove
 * the user-facing flows still work — runtime regressions like missing
 * env vars, paused backend (Supabase free-tier auto-pause), broken
 * third-party API calls all slip through. eventbadge dogfood (2026-05-07)
 * showed this exact failure mode: `TypeError: fetch failed` on event
 * creation despite Conclave reporting "fix verified".
 *
 * Smoke verifier closes the gap: after the autofix commit lands and the
 * deploy preview is live, we walk through a small set of acceptance-
 * criteria-mapped Playwright steps. If they pass, the cycle reports
 * "verified live". If they fail, the cycle is flagged for human review
 * (or, if configured, the autofix commit is reverted).
 *
 * Step config can be:
 *   - explicit `.conclave/smoke.yaml` next to the repo root
 *   - auto-derived from `.conclave/prd.md` acceptance-criteria (TODO v2)
 *
 * Steps supported in v1:
 *   - goto:        navigate to a path (relative to base URL)
 *   - expect-status: the response status code must match
 *   - expect-text:   a text/selector must appear on the page
 *   - click:        click a selector
 *   - fill:         fill a form input
 *   - wait-for:     wait for selector
 *
 * Future v2: AI Slop check (scan the deployed bundle for "TODO: implement",
 * placeholder strings, etc.), visual diff integration via
 * @simsa/visual-review.
 */

import { parse as parseYaml } from "yaml";
import { promises as fs } from "node:fs";
import path from "node:path";

// --- Config types -------------------------------------------------------

export type SmokeStep =
  | { kind: "goto"; path: string; name?: string }
  | { kind: "expect-status"; equals: number; name?: string }
  | { kind: "expect-text"; text?: string; selector?: string; visible?: boolean; name?: string }
  | { kind: "click"; selector: string; name?: string }
  | { kind: "fill"; selector: string; value: string; name?: string }
  | { kind: "wait-for"; selector: string; timeoutMs?: number; name?: string };

export interface SmokeConfig {
  /** Steps run in order; first failure halts the run unless `continueOnFailure`. */
  steps: SmokeStep[];
  /** Per-step timeout in ms. Default 15s. */
  stepTimeoutMs?: number;
  /** Don't stop on first failure — collect all and report. Default false. */
  continueOnFailure?: boolean;
  /** User-Agent header for requests. */
  userAgent?: string;
}

// --- Result types -------------------------------------------------------

export type StepStatus = "pass" | "fail" | "skip";

export interface StepResult {
  index: number;
  name: string;
  kind: SmokeStep["kind"];
  status: StepStatus;
  durationMs: number;
  /** Failure reason — present when status='fail'. */
  reason?: string;
  /** Captured detail (status code, text, screenshot path) for the report. */
  evidence?: Record<string, unknown>;
}

export interface SmokeResult {
  baseUrl: string;
  totalSteps: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  steps: StepResult[];
  /** Top-level verdict: "ok" if all passed, "broken" otherwise. */
  verdict: "ok" | "broken";
  /** Captured screenshot at the moment of first failure (Playwright PNG buffer base64). */
  failureScreenshot?: string;
}

// --- Loader -------------------------------------------------------------

/**
 * Load `.conclave/smoke.yaml` from the repo root. Returns null when the
 * file is absent (smoke verification is opt-in).
 */
export async function loadSmokeConfig(repoRoot: string): Promise<SmokeConfig | null> {
  const candidates = [
    path.join(repoRoot, ".conclave", "smoke.yaml"),
    path.join(repoRoot, ".conclave", "smoke.yml"),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = parseYaml(raw);
      return normalizeConfig(parsed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

function normalizeConfig(raw: unknown): SmokeConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("smoke.yaml: top-level must be an object");
  }
  const r = raw as Record<string, unknown>;
  const stepsRaw = r["steps"];
  if (!Array.isArray(stepsRaw)) {
    throw new Error("smoke.yaml: `steps` must be an array");
  }
  const steps: SmokeStep[] = [];
  for (let i = 0; i < stepsRaw.length; i += 1) {
    const s = stepsRaw[i] as Record<string, unknown>;
    if (typeof s !== "object" || s === null) continue;
    const name = typeof s["name"] === "string" ? (s["name"] as string) : undefined;
    if (typeof s["goto"] === "string") {
      steps.push({ kind: "goto", path: s["goto"] as string, ...(name !== undefined ? { name } : {}) });
    } else if ("expect-status" in s) {
      const eq = Number(s["expect-status"]);
      if (Number.isFinite(eq)) {
        steps.push({ kind: "expect-status", equals: eq, ...(name !== undefined ? { name } : {}) });
      }
    } else if ("expect-text" in s) {
      const obj = s["expect-text"] as Record<string, unknown>;
      const stepObj: { kind: "expect-text"; text?: string; selector?: string; visible?: boolean; name?: string } = { kind: "expect-text" };
      if (typeof obj?.text === "string") stepObj.text = obj.text;
      if (typeof obj?.selector === "string") stepObj.selector = obj.selector;
      if (typeof obj?.visible === "boolean") stepObj.visible = obj.visible;
      if (name !== undefined) stepObj.name = name;
      if (stepObj.text !== undefined || stepObj.selector !== undefined) steps.push(stepObj);
    } else if (typeof s["click"] === "string") {
      steps.push({ kind: "click", selector: s["click"] as string, ...(name !== undefined ? { name } : {}) });
    } else if ("fill" in s) {
      const obj = s["fill"] as Record<string, unknown>;
      if (typeof obj?.selector === "string" && typeof obj?.value === "string") {
        steps.push({ kind: "fill", selector: obj.selector, value: obj.value, ...(name !== undefined ? { name } : {}) });
      }
    } else if (typeof s["wait-for"] === "string") {
      const stepObj: { kind: "wait-for"; selector: string; timeoutMs?: number; name?: string } = { kind: "wait-for", selector: s["wait-for"] as string };
      if (typeof s["timeoutMs"] === "number") stepObj.timeoutMs = s["timeoutMs"] as number;
      if (name !== undefined) stepObj.name = name;
      steps.push(stepObj);
    }
  }
  const out: SmokeConfig = { steps };
  if (typeof r["stepTimeoutMs"] === "number") out.stepTimeoutMs = r["stepTimeoutMs"] as number;
  if (typeof r["continueOnFailure"] === "boolean") out.continueOnFailure = r["continueOnFailure"] as boolean;
  if (typeof r["userAgent"] === "string") out.userAgent = r["userAgent"] as string;
  return out;
}

// --- Runner -------------------------------------------------------------

/**
 * Playwright launcher type — narrowed to what we actually use.
 * Caller passes the playwright `chromium` import; we never require
 * Playwright at module-load time so test envs without it don't break.
 */
export interface PlaywrightLike {
  launch(opts?: { headless?: boolean }): Promise<{
    newPage: () => Promise<PageLike>;
    close: () => Promise<void>;
  }>;
}

export interface PageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<{ status: () => number } | null>;
  textContent(selector: string, opts?: { timeout?: number }): Promise<string | null>;
  isVisible(selector: string, opts?: { timeout?: number }): Promise<boolean>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  content(): Promise<string>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  close(): Promise<void>;
}

export interface RunSmokeOptions {
  baseUrl: string;
  config: SmokeConfig;
  /** Caller injects `chromium` from playwright. Required at runtime. */
  playwright: PlaywrightLike;
}

/**
 * Walk through smoke steps. Returns a SmokeResult with verdict + per-step
 * detail. Always returns (does not throw on step failures); throws only on
 * setup errors (Playwright crash, browser launch fail).
 */
export async function runSmoke(opts: RunSmokeOptions): Promise<SmokeResult> {
  const { baseUrl, config, playwright } = opts;
  const stepTimeoutMs = config.stepTimeoutMs ?? 15_000;
  const continueOnFailure = config.continueOnFailure ?? false;
  const startAll = Date.now();

  const steps: StepResult[] = [];
  let failureScreenshot: string | undefined;
  let lastResponseStatus: number | null = null;
  let halted = false;

  const browser = await playwright.launch({ headless: true });
  let page: PageLike | null = null;
  try {
    page = await browser.newPage();
    for (let i = 0; i < config.steps.length; i += 1) {
      if (halted) {
        const stepName = labelOf(config.steps[i]!);
        steps.push({
          index: i,
          name: stepName,
          kind: config.steps[i]!.kind,
          status: "skip",
          durationMs: 0,
          reason: "skipped because previous step failed",
        });
        continue;
      }
      const step = config.steps[i]!;
      const stepName = labelOf(step);
      const start = Date.now();
      try {
        const evidence = await runOne(page, step, stepTimeoutMs, baseUrl, lastResponseStatus);
        if (evidence.responseStatus !== undefined) lastResponseStatus = evidence.responseStatus as number;
        steps.push({
          index: i,
          name: stepName,
          kind: step.kind,
          status: "pass",
          durationMs: Date.now() - start,
          evidence,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Capture a screenshot at first failure for the report.
        if (failureScreenshot === undefined && page) {
          try {
            const buf = await page.screenshot({ fullPage: true });
            failureScreenshot = buf.toString("base64");
          } catch {
            /* screenshot is best-effort */
          }
        }
        steps.push({
          index: i,
          name: stepName,
          kind: step.kind,
          status: "fail",
          durationMs: Date.now() - start,
          reason,
        });
        if (!continueOnFailure) halted = true;
      }
    }
  } finally {
    if (page) await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const passed = steps.filter((s) => s.status === "pass").length;
  const failed = steps.filter((s) => s.status === "fail").length;
  const skipped = steps.filter((s) => s.status === "skip").length;
  const result: SmokeResult = {
    baseUrl,
    totalSteps: steps.length,
    passed,
    failed,
    skipped,
    durationMs: Date.now() - startAll,
    steps,
    verdict: failed === 0 ? "ok" : "broken",
  };
  if (failureScreenshot !== undefined) result.failureScreenshot = failureScreenshot;
  return result;
}

function labelOf(s: SmokeStep): string {
  if (s.name) return s.name;
  switch (s.kind) {
    case "goto": return `goto ${s.path}`;
    case "expect-status": return `expect status ${s.equals}`;
    case "expect-text": return `expect text ${s.text ? JSON.stringify(s.text) : `in ${s.selector}`}`;
    case "click": return `click ${s.selector}`;
    case "fill": return `fill ${s.selector}`;
    case "wait-for": return `wait for ${s.selector}`;
  }
}

async function runOne(
  page: PageLike,
  step: SmokeStep,
  timeoutMs: number,
  baseUrl: string,
  lastStatus: number | null,
): Promise<Record<string, unknown>> {
  switch (step.kind) {
    case "goto": {
      const target = new URL(step.path, baseUrl).toString();
      const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      const status = resp ? resp.status() : 0;
      return { url: target, responseStatus: status };
    }
    case "expect-status": {
      if (lastStatus === null) {
        throw new Error("expect-status: no prior goto provided a status to check");
      }
      if (lastStatus !== step.equals) {
        throw new Error(`expect-status: got ${lastStatus}, want ${step.equals}`);
      }
      return { responseStatus: lastStatus };
    }
    case "expect-text": {
      // Strategy: when `selector` is given, read its textContent + match.
      // When only `text` given, search the full page content.
      // When `visible: true`, also assert isVisible(selector).
      if (step.selector && step.visible) {
        const visible = await page.isVisible(step.selector, { timeout: timeoutMs });
        if (!visible) throw new Error(`expect-text: selector ${step.selector} not visible`);
      }
      if (step.selector && step.text) {
        const got = await page.textContent(step.selector, { timeout: timeoutMs });
        if (!got || !got.includes(step.text)) {
          throw new Error(`expect-text: selector ${step.selector} did not contain ${JSON.stringify(step.text)}; got ${JSON.stringify((got ?? "").slice(0, 80))}`);
        }
        return { selector: step.selector, foundText: got.slice(0, 200) };
      }
      if (step.text) {
        const html = await page.content();
        if (!html.includes(step.text)) {
          throw new Error(`expect-text: page did not contain ${JSON.stringify(step.text)}`);
        }
        return { foundText: step.text };
      }
      if (step.selector) {
        const visible = await page.isVisible(step.selector, { timeout: timeoutMs });
        if (!visible) throw new Error(`expect-text: selector ${step.selector} not visible`);
        return { selector: step.selector };
      }
      throw new Error("expect-text: must specify `text` or `selector`");
    }
    case "click": {
      await page.click(step.selector, { timeout: timeoutMs });
      return { selector: step.selector };
    }
    case "fill": {
      await page.fill(step.selector, step.value, { timeout: timeoutMs });
      return { selector: step.selector };
    }
    case "wait-for": {
      await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? timeoutMs });
      return { selector: step.selector };
    }
  }
}

// --- AI Slop checker (v2 scaffolding) ----------------------------------

/**
 * v2: scan deployed page HTML / accessible-by-curl JSON for known LLM
 * sloppy patterns. For now we just expose the patterns; integration
 * with the SmokeResult pipeline lands in the next iteration.
 */
export const AI_SLOP_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = Object.freeze([
  { pattern: /TODO:\s*implement/i, reason: "AI placeholder TODO left in code" },
  { pattern: /\/\/ FIXME/i, reason: "AI placeholder FIXME left in code" },
  { pattern: /Lorem ipsum/i, reason: "Placeholder Lorem ipsum text reached production" },
  { pattern: /your-(api-key|secret|token)/i, reason: "Placeholder credential string reached production" },
  { pattern: /<INSERT[^>]+>/, reason: "Placeholder INSERT marker reached production" },
  { pattern: /I would (suggest|recommend|implement)/i, reason: "AI commentary text reached production" },
  { pattern: /This is a placeholder/i, reason: "Explicit placeholder text reached production" },
  { pattern: /example\.com/i, reason: "Hardcoded example.com URL reached production" },
]);

/**
 * Scan a string (typically deployed HTML) against the slop pattern list.
 * Returns matched patterns with reasons.
 */
export function scanForAiSlop(content: string): Array<{ reason: string; match: string }> {
  const hits: Array<{ reason: string; match: string }> = [];
  for (const { pattern, reason } of AI_SLOP_PATTERNS) {
    const m = pattern.exec(content);
    if (m) hits.push({ reason, match: m[0].slice(0, 80) });
  }
  return hits;
}
