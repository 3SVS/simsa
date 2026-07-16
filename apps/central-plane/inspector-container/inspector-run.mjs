/**
 * inspector-run.mjs — Stage 263: the SimsaInspector deep-flow executor.
 *
 * Adapted from tools/simsa-completion-loop-spike/visual-run.mjs (Stage 260A/261
 * reference runner): goto → collect CTAs/inputs → planVisualFlow → execute
 * only SAFE steps (classifyActionSafety re-checked at click time) → per-step
 * screenshots + flow video → deterministic decideFromEvidence ladder →
 * buildNonDevReport + buildAgentFixPrompt.
 *
 * Imports the canonical Simsa modules compiled into ./dist at image build
 * time from apps/central-plane/src (see Dockerfile) — no duplicated logic.
 *
 * Safety rails:
 *   - forbidden-action list (payment/delete/send/invite/publish/deploy/
 *     logout + 결제/삭제/발행/배포/로그아웃) — never planned, never clicked
 *   - viewport 1280x800, headless Chromium
 *   - per-action timeouts; the caller (server.mjs) additionally enforces the
 *     ~4-minute total wall clock
 *   - --no-sandbox: the CF container runs as root; --disable-dev-shm-usage:
 *     container /dev/shm is tiny and crashes Chromium tabs otherwise.
 */
import { chromium } from "playwright";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { planVisualFlow } from "./dist/visual-flow-plan.js";
import { buildNonDevReport, buildAgentFixPrompt, isNoiseResource, decideFromEvidence } from "./dist/nondev-report.js";
import { classifyActionSafety } from "./safety.mjs";

/** Forbidden action words handed to the planner (mirrors visual-run.mjs). */
export const FORBIDDEN_ACTIONS = [
  "payment", "pay", "checkout", "delete", "remove", "send", "invite",
  "publish", "deploy", "logout", "sign out",
  "결제", "구매", "삭제", "발행", "배포", "로그아웃",
];

async function collectCtas(page) {
  return page.$$eval("a, button, [role=button]", (els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      })
      .slice(0, 200)
      .map((el) => ({ text: (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ") }))
      .filter((c) => c.text.length > 0)
      .map((c) => ({ text: c.text, selector: `text=${c.text}` })),
  );
}

async function collectInputs(page) {
  return page.$$eval("input, textarea", (els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const t = (el.getAttribute("type") || "text").toLowerCase();
        const ok = ["text", "search", "email", "tel", "url", "number", ""].includes(t) || el.tagName.toLowerCase() === "textarea";
        return r.width > 0 && r.height > 0 && ok;
      })
      .slice(0, 50)
      .map((el) => ({ type: (el.getAttribute("type") || "text").toLowerCase(), placeholder: (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").trim().slice(0, 80) }))
      .map((i) => ({ ...i, selector: i.placeholder ? `[placeholder="${i.placeholder}"]` : "input" })),
  );
}

// decideFromEvidence now lives in nondev-report.ts (shared + unit-tested).

/** Step NOTES. Like the step labels, these are quoted into the report prose. */
const STEP_NOTES = {
  ko: {
    unsafeSkipped: (cat) => `안전하지 않아 건너뜀 (${cat})`,
    noResults: "검색 결과/내용이 확인되지 않음 (또는 데이터 요청 실패)",
    networkFailed: "데이터 요청 실패가 관찰됨",
    actionFailed: (err) => `동작 실패: ${err}`,
  },
  en: {
    unsafeSkipped: (cat) => `Skipped — not safe to run (${cat})`,
    noResults: "No results/content appeared (or the data request failed)",
    networkFailed: "A data request was observed failing",
    actionFailed: (err) => `Action failed: ${err}`,
  },
};

/**
 * Execute one inspection. Returns:
 *   { report, agentPrompt, decision, works, evidenceFiles: [{ name, path }] }
 * where `name` is the Stage 261 evidence name (screenshots/*.png | video/flow.webm)
 * and `path` is the absolute file path inside the container.
 *
 * sampleQuery has NO default here on purpose: planVisualFlow picks one from the
 * locale, and a default at this seam would silently win over it.
 */
export async function runInspection({ targetUrl, intent, outDir, sampleQuery, locale = "ko" }) {
  const N = STEP_NOTES[locale === "en" ? "en" : "ko"];
  const shotsDir = join(outDir, "screenshots");
  const videoDir = join(outDir, "video");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkFailures = []; // real: app domain + its backend (drives verdict)
  const noiseFailures = []; // analytics/ads/fonts/telemetry (info only)
  const recordNet = (url, line) => (isNoiseResource(url) ? noiseFailures : networkFailures).push(line);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
  page.on("requestfailed", (r) =>
    recordNet(r.url(), `${r.method()} ${r.url().slice(0, 200)} (${r.failure()?.errorText ?? "failed"})`),
  );
  page.on("response", (r) => r.status() >= 500 && recordNet(r.url(), `HTTP ${r.status()} ${r.url().slice(0, 200)}`));

  const evidenceFiles = [];
  const stepOutcomes = [];
  const evidence = {
    urlLoaded: targetUrl,
    loadStatus: null,
    primaryActionFound: false,
    interacted: false,
    routeBeforeClick: null,
    routeAfterClick: null,
    routeChanged: false,
    consoleErrors,
    networkFailures,
  };

  async function snap(name) {
    const p = join(shotsDir, name);
    try {
      await page.screenshot({ path: p, fullPage: false });
      evidenceFiles.push({ name: `screenshots/${name}`, path: p });
    } catch {
      /* ignore screenshot failures */
    }
  }

  try {
    const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    evidence.loadStatus = resp ? resp.status() : null;
    evidence.routeBeforeClick = page.url();
    await page.waitForTimeout(1800);
    await snap("step-00-initial.png");

    const ctas = await collectCtas(page);
    const inputs = await collectInputs(page);

    const plan = planVisualFlow({
      intentAnchor: intent,
      ctas: ctas.map((c) => ({ text: c.text, selector: c.selector })),
      inputs,
      forbidden: FORBIDDEN_ACTIONS,
      sampleQuery,
      locale,
    });
    evidence.primaryActionFound = plan.some((s) => s.action === "click" || s.action === "type");

    let stepIdx = 0;
    for (const step of plan) {
      stepIdx += 1;
      const shotName = `step-${String(stepIdx).padStart(2, "0")}.png`;
      try {
        if (step.action === "click") {
          const safety = classifyActionSafety(step.targetText);
          if (!safety.safe) {
            stepOutcomes.push({ label: step.label, ok: false, note: N.unsafeSkipped(safety.category) });
            continue;
          }
          await page.getByText(step.targetText, { exact: true }).first().click({ timeout: 8000 });
          evidence.interacted = true;
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1500);
          evidence.routeAfterClick = page.url();
          evidence.routeChanged = evidence.routeAfterClick !== evidence.routeBeforeClick;
          await snap(shotName);
          stepOutcomes.push({ label: step.label, ok: true });
        } else if (step.action === "type") {
          const field = step.placeholder ? page.getByPlaceholder(step.placeholder).first() : page.locator("input").first();
          await field.fill(step.value, { timeout: 8000 });
          await field.press("Enter").catch(() => {});
          evidence.interacted = true;
          await page.waitForTimeout(1800);
          await snap(shotName);
          // Did results/content appear? Heuristic: page text grew and no fresh network failure.
          const bodyLen = (await page.locator("body").innerText().catch(() => "")).length;
          const ok = bodyLen > 200 && networkFailures.length === 0;
          stepOutcomes.push({ label: step.label, ok, note: ok ? undefined : N.noResults });
        } else {
          await snap(shotName);
          stepOutcomes.push({ label: step.label, ok: networkFailures.length === 0, note: networkFailures.length ? N.networkFailed : undefined });
        }
      } catch (err) {
        await snap(shotName);
        stepOutcomes.push({ label: step.label, ok: false, note: N.actionFailed(String(err).slice(0, 100)) });
      }
    }
  } finally {
    await context.close(); // finalizes the video
    await browser.close();
  }

  // Save the recorded video next to the screenshots.
  try {
    const vp = await page.video()?.path();
    if (vp && existsSync(vp)) {
      const dest = join(videoDir, "flow.webm");
      copyFileSync(vp, dest);
      evidenceFiles.push({ name: "video/flow.webm", path: dest });
    }
  } catch {
    /* video optional */
  }

  const decision = decideFromEvidence(evidence, stepOutcomes);
  const reportInput = {
    targetUrl,
    intentAnchor: intent,
    loadStatus: evidence.loadStatus,
    primaryActionFound: evidence.primaryActionFound,
    interacted: evidence.interacted,
    routeAfterClick: evidence.routeAfterClick,
    routeChanged: evidence.routeChanged,
    consoleErrors,
    networkFailures,
    noiseFailures,
    decision,
    steps: stepOutcomes,
  };
  const report = buildNonDevReport(reportInput, locale);
  const agentPrompt = buildAgentFixPrompt(reportInput, locale);

  return { report, agentPrompt, decision, works: report.works, evidenceFiles };
}
