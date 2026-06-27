/**
 * run.mjs — Stage 258A spike: External Vibe App Completion Loop (LOCAL/DEV ONLY).
 *
 * Loads an AUTHORIZED external app in a real Chromium (Playwright), exercises ONE core flow
 * (homepage → primary onboarding CTA → next screen), captures factual Browser Evidence, then
 * hands the evidence to pure helpers for AI Opinion / decision / receipt / fix brief.
 *
 * SAFETY: only safe actions are clicked (see lib/safety.mjs); forbidden/unclear actions are
 * SKIPPED. No auth bypass, no destructive actions, no production-Simsa target, no deploy.
 *
 * Usage: node run.mjs <runLabel> <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { choosePrimaryCta } from "./lib/safety.mjs";
import { buildAiOpinion, classifyDecision } from "./lib/classify.mjs";
import { buildReceipt, renderReceiptMarkdown, renderFixBrief } from "./lib/receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));

async function collectInputs(page) {
  // Visible text/search inputs, surfaced as evidence (the spike does not blind-type into unknown forms).
  return page.$$eval("input, textarea", (els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const type = (el.getAttribute("type") || "text").toLowerCase();
        const ok = ["text", "search", "email", "tel", "url", "number", ""].includes(type) || el.tagName.toLowerCase() === "textarea";
        return r.width > 0 && r.height > 0 && ok;
      })
      .slice(0, 50)
      .map((el) => ({
        type: (el.getAttribute("type") || "text").toLowerCase(),
        placeholder: (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").trim().slice(0, 60),
      })),
  );
}

async function collectCandidates(page) {
  // Visible buttons, links, and role=button elements with their trimmed text + a stable selector.
  return page.$$eval("a, button, [role=button]", (els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(0, 200)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
        const href = el.getAttribute("href") || null;
        return { tag, text, href, selector: text ? `${tag}:has-text(${JSON.stringify(text.slice(0, 40))})` : tag };
      })
      .filter((c) => c.text.length > 0),
  );
}

export async function runOnce(config, runLabel, outDir) {
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkFailures = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("requestfailed", (req) => {
    networkFailures.push(`${req.method()} ${req.url().slice(0, 200)} (${req.failure()?.errorText ?? "failed"})`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) networkFailures.push(`HTTP ${res.status()} ${res.url().slice(0, 200)}`);
  });

  const evidence = {
    urlLoaded: config.targetUrl,
    loadStatus: null,
    viewport: { width: 1280, height: 800 },
    primaryCtaFound: false,
    detectedInputs: [],
    clicked: false,
    clickedText: null,
    clickedSelector: null,
    routeBeforeClick: null,
    routeAfterClick: null,
    routeChanged: false,
    consoleErrors,
    networkFailures,
    skipped: [],
    screenshots: [],
    timestamp: null,
  };

  try {
    const resp = await page.goto(config.targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    evidence.loadStatus = resp ? resp.status() : null;
    evidence.routeBeforeClick = page.url();
    await page.waitForTimeout(1500); // let client render
    const beforeShot = join(outDir, "screenshots", "before.png");
    await page.screenshot({ path: beforeShot, fullPage: false });
    evidence.screenshots.push(relScreenshot(beforeShot));

    const candidates = await collectCandidates(page);
    evidence.detectedInputs = await collectInputs(page);
    const { chosen, skippedForbidden } = choosePrimaryCta(candidates);
    evidence.skipped = skippedForbidden;
    evidence.primaryCtaFound = !!chosen;

    if (chosen) {
      evidence.clickedText = chosen.text;
      evidence.clickedSelector = chosen.selector;
      try {
        // Click the first element whose visible text matches the chosen CTA exactly.
        const locator = page.getByText(chosen.text, { exact: true }).first();
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
        await Promise.race([
          locator.click({ timeout: 8000 }),
          page.waitForTimeout(8000),
        ]);
        evidence.clicked = true;
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);
        evidence.routeAfterClick = page.url();
        evidence.routeChanged = evidence.routeAfterClick !== evidence.routeBeforeClick;
        const afterShot = join(outDir, "screenshots", "after.png");
        await page.screenshot({ path: afterShot, fullPage: false });
        evidence.screenshots.push(relScreenshot(afterShot));
      } catch (err) {
        evidence.skipped.push({ text: chosen.text, selector: chosen.selector, reason: `click failed: ${String(err).slice(0, 120)}` });
      }
    }
  } finally {
    evidence.timestamp = new Date().toISOString();
    await browser.close();
  }

  // Pure, deterministic shaping (no browser beyond this point).
  const opinion = buildAiOpinion(evidence, config.intentAnchor);
  const decision = classifyDecision(evidence);
  const receipt = buildReceipt({ run: runLabel, config, evidence, decision, opinion });

  writeFileSync(join(outDir, "browser-evidence.json"), JSON.stringify(stripFns(evidence), null, 2));
  writeFileSync(join(outDir, "receipt.json"), JSON.stringify(receipt, null, 2));
  writeFileSync(join(outDir, "receipt.md"), renderReceiptMarkdown(receipt));
  writeFileSync(join(outDir, "fix-brief.md"), renderFixBrief({ config, evidence, decision, opinion }));
  return receipt;
}

function relScreenshot(p) {
  return `screenshots/${p.split(/[\\/]/).pop()}`;
}
function stripFns(o) {
  return JSON.parse(JSON.stringify(o));
}

// CLI: node run.mjs <runLabel> <outDir>
if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  const runLabel = process.argv[2] || "run-1";
  const outDir = process.argv[3] || join(here, "out", runLabel);
  const config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
  runOnce(config, runLabel, outDir)
    .then((r) => {
      console.log(`[${runLabel}] decision: ${r.decision} | CTA: ${r.browserEvidence.clickedText ?? "(none)"} | route: ${r.browserEvidence.routeAfterClick ?? "(n/a)"}`);
    })
    .catch((e) => {
      console.error(`[${runLabel}] spike error:`, e);
      process.exit(1);
    });
}
