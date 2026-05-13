/**
 * Marketplace demo video capture — Playwright records the 28-second
 * auto-playing terminal-demo.html into a webm. Marketplace listings
 * accept image attachments only (PNG / GIF), so the webm is the
 * intermediate; users convert to GIF separately.
 *
 * If ffmpeg or ImageMagick aren't available locally, an alternative
 * fallback is included: frame-by-frame PNG screenshots at 2 fps that
 * can be assembled to GIF later (or just used as a sequence in a
 * carousel / video editor).
 *
 * Run:
 *   node packages/smoke-verifier/marketplace-video.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, renameSync, readdirSync } from "node:fs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPT_DIR, "../..");
const OUT = path.join(REPO, "apps/landing/public/screenshots");
const FRAMES = path.join(OUT, "demo-frames");
const MARKETING = path.join(REPO, "docs/marketing");

mkdirSync(OUT, { recursive: true });
mkdirSync(FRAMES, { recursive: true });

const TERMINAL_URL =
  "file:///" + path.join(MARKETING, "terminal-demo.html").replace(/\\/g, "/");

const browser = await chromium.launch();

// --- Path 1: webm via Playwright recordVideo ------------------------------
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: OUT,
    size: { width: 1280, height: 800 },
  },
});
const page = await ctx.newPage();
await page.goto(TERMINAL_URL, { waitUntil: "domcontentloaded" });
// Hold for the full ~28s loop the terminal demo runs.
await page.waitForTimeout(30000);
await ctx.close();

// Playwright writes the webm with a random uuid; rename to a stable name.
const newest = readdirSync(OUT)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => ({ f, m: path.join(OUT, f) }))
  .sort((a, b) => b.f.localeCompare(a.f))[0];
if (newest) {
  const target = path.join(OUT, "demo.webm");
  renameSync(newest.m, target);
  console.log("[ok]   demo.webm written");
}

// --- Path 2: PNG frame sequence at 2 fps ----------------------------------
// 30 seconds × 2 fps = 60 frames. Useful when ffmpeg isn't installed —
// any GIF assembler (gifski, ezgif.com, ScreenToGif's import sequence
// mode) can stitch these into a GIF.
const ctx2 = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const p2 = await ctx2.newPage();
await p2.goto(TERMINAL_URL, { waitUntil: "domcontentloaded" });
const FRAME_COUNT = 60;
const FRAME_DELAY = 500;
for (let i = 0; i < FRAME_COUNT; i++) {
  await p2.waitForTimeout(FRAME_DELAY);
  const name = `frame-${String(i).padStart(3, "0")}.png`;
  await p2.screenshot({ path: path.join(FRAMES, name), type: "png" });
}
await ctx2.close();
await browser.close();

console.log(`[ok]   ${FRAME_COUNT} frames written to ${FRAMES}`);
console.log("done — convert with:");
console.log("  webm  → GIF: ffmpeg -i demo.webm -vf 'fps=10,scale=720:-1' demo.gif");
console.log("  frames→ GIF: drop demo-frames/ into ezgif.com or ScreenToGif");
