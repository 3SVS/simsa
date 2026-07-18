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
    noChange: "동작 후 화면에 아무 변화가 없음",
    reloadCheck: "새로고침 후에도 입력한 내용이 남아 있는지 확인",
    notPersisted: "새로고침하니 입력한 내용이 사라짐 — 화면만 바뀌고 실제 저장은 되지 않았을 가능성",
  },
  en: {
    unsafeSkipped: (cat) => `Skipped — not safe to run (${cat})`,
    noResults: "No results/content appeared (or the data request failed)",
    networkFailed: "A data request was observed failing",
    actionFailed: (err) => `Action failed: ${err}`,
    noChange: "Nothing on the screen changed after the action",
    reloadCheck: "Check the entered content survives a page reload",
    notPersisted: "The entered content disappeared after a reload — the screen changed but nothing was actually saved",
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
  // An UNCAUGHT exception fires "pageerror", not "console" — without this, a
  // load-time crash that kills every handler (dead-button app) left
  // consoleErrors empty and the D9 crash conjunction could never fire
  // (2026-07-17 eval F4: js-crash fixture read as "확인 필요" instead of broken).
  page.on("pageerror", (err) => consoleErrors.push(`Uncaught ${String(err).slice(0, 300)}`));
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
    // D7/D9 (2026-07-17 accuracy eval): whether the driven action visibly
    // changed anything. null until an action ran and an observe measured it.
    visibleChangeAfterAction: null,
    consoleErrorCount: 0,
    // G4-① (2026-07-18): 입력한 내용이 새로고침을 살아남는가. null = 비적용/미측정.
    persistedAfterReload: null,
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

    // D7: success is measured as CHANGE from this baseline (body text or
    // route), never as an absolute page size — the old `bodyLen > 200` check
    // failed every small app card regardless of actual behavior.
    const bodyTextAt = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const bodyBefore = await bodyTextAt();
    // D6: when the plan submits via a CLICK step, Enter after typing would
    // double-submit (or submit an incomplete form) — press Enter only when
    // typing is the plan's only driver.
    const planHasClick = plan.some((s) => s.action === "click");

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
          if (!planHasClick) await field.press("Enter").catch(() => {});
          evidence.interacted = true;
          await page.waitForTimeout(1800);
          await snap(shotName);
          // The type step itself only claims "the value went in" — whether
          // anything HAPPENED is the observe step's job (D7 change check).
          stepOutcomes.push({ label: step.label, ok: true });
        } else {
          await snap(shotName);
          // D7: judge by change, not size. An action that changed neither the
          // body text nor the route did nothing observable.
          const bodyNow = await bodyTextAt();
          const visibleChange = bodyNow !== bodyBefore || evidence.routeChanged;
          if (evidence.interacted) evidence.visibleChangeAfterAction = visibleChange;
          const ok = networkFailures.length === 0 && (!evidence.interacted || visibleChange);
          const note = networkFailures.length ? N.networkFailed : ok ? undefined : N.noChange;
          stepOutcomes.push({ label: step.label, ok, note });
        }
      } catch (err) {
        await snap(shotName);
        stepOutcomes.push({ label: step.label, ok: false, note: N.actionFailed(String(err).slice(0, 100)) });
      }
    }

    // G4-① (2026-07-18): 지속성 확인 — 내용을 "추가"한 플로우(입력한 텍스트가
    // 화면에 나타남 + 액션 후 변화 관찰)에서만, 새로고침 후에도 그 텍스트가
    // 남아 있는지 본다. 낙관적 UI만 있고 저장이 없는 앱(Potemkin의 마지막
    // 형태)을 잡는 최종 시험. 전제가 하나라도 빠지면(검색 플로우, 라우트 이동,
    // 마커 미노출) null 유지 — 측정 안 된 것은 절대 판정에 영향을 주지 않는다.
    const typedStep = plan.find((s) => s.action === "type");
    if (
      typedStep &&
      evidence.interacted &&
      evidence.visibleChangeAfterAction === true &&
      !evidence.routeChanged
    ) {
      try {
        const bodyAfterAction = await bodyTextAt();
        if (bodyAfterAction.includes(typedStep.value)) {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(1800);
          await snap(`step-${String(stepIdx + 1).padStart(2, "0")}-reload.png`);
          const bodyReload = await bodyTextAt();
          evidence.persistedAfterReload = bodyReload.includes(typedStep.value);
          stepOutcomes.push({
            label: N.reloadCheck,
            ok: evidence.persistedAfterReload,
            note: evidence.persistedAfterReload ? undefined : N.notPersisted,
          });
        }
      } catch {
        /* best-effort — 측정 실패는 null 유지 */
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

  evidence.consoleErrorCount = consoleErrors.length;
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
