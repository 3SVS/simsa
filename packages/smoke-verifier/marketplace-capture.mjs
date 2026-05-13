/**
 * Marketplace screenshot capture script.
 *
 * Run:
 *   node apps/landing/public/screenshots/capture.mjs
 *
 * Emits 6 PNG files into the same directory:
 *   01-pr-comment.png        — the PR-comment mockup for the moat shot
 *   02-terminal-demo.png     — first frame of the auto-playing CLI demo
 *   03-landing-hero.png      — landing I. Hero section (1280×900)
 *   04-landing-pricing.png   — landing V. Indulgences (pricing) section
 *   05-landing-council.png   — landing III. Council evidence section
 *   06-audit-output.png      — pseudo-terminal snapshot of an audit run
 *
 * Uses the playwright that's already installed for smoke-verifier
 * (1.59.1). If the chromium binary is missing on first run, do:
 *   pnpm dlx playwright install chromium
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, "../..");
const OUT = path.join(REPO, "apps/landing/public/screenshots");
const MARKETING = path.join(REPO, "docs/marketing");
await import("node:fs").then(({ mkdirSync }) => mkdirSync(OUT, { recursive: true }));

const targets = [
  {
    name: "01-pr-comment.png",
    url: "file:///" + path.join(MARKETING, "pr-comment-mockup.html").replace(/\\/g, "/"),
    viewport: { width: 1280, height: 1600 },
    fullPage: true,
  },
  {
    name: "02-terminal-demo.png",
    url: "file:///" + path.join(MARKETING, "terminal-demo.html").replace(/\\/g, "/"),
    viewport: { width: 1280, height: 800 },
    settle: 14000, // ~mid-frame of the 28s sequence so we catch the verdict
    fullPage: false,
  },
  {
    name: "03-landing-hero.png",
    url: "https://conclave-ai.dev",
    viewport: { width: 1280, height: 900 },
    fullPage: false,
  },
  {
    name: "04-landing-pricing.png",
    url: "https://conclave-ai.dev#pricing",
    viewport: { width: 1280, height: 1100 },
    scrollTo: "#pricing",
    fullPage: false,
  },
  {
    name: "05-landing-council.png",
    url: "https://conclave-ai.dev#how",
    viewport: { width: 1280, height: 1100 },
    scrollTo: "#how",
    fullPage: false,
  },
];

const browser = await chromium.launch();

for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: t.viewport,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(t.url, { waitUntil: "networkidle", timeout: 30000 });
  } catch (err) {
    console.warn(`[skip] ${t.name} — goto failed: ${err.message}`);
    await ctx.close();
    continue;
  }
  if (t.scrollTo) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
    }, t.scrollTo);
    await page.waitForTimeout(500);
  }
  if (t.settle) await page.waitForTimeout(t.settle);
  const outPath = path.join(OUT, t.name);
  await page.screenshot({
    path: outPath,
    fullPage: !!t.fullPage,
    type: "png",
  });
  console.log(`[ok]   ${t.name}`);
  await ctx.close();
}

await browser.close();
console.log("done — 5 marketplace screenshots ready in apps/landing/public/screenshots/");
