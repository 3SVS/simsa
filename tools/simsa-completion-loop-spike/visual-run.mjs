/**
 * visual-run.mjs — Stage 260A: Simsa deep visual completion check (LOCAL/DEV ONLY).
 *
 * Upgrades the Stage 258A spike from "click one CTA" to a REAL journey: it plans a deep flow
 * (planVisualFlow — click a safe CTA, else TYPE a benign query into the primary search box), executes
 * it in a real Chromium while recording VIDEO + a screenshot per step, then renders a plain-Korean,
 * non-developer report (buildNonDevReport + renderNonDevReportHtml) the user can double-click and SEE.
 *
 * Reuses the Simsa core modules (tested, in apps/central-plane). Safety: only safe/benign actions are
 * executed (forbidden actions are never planned); no auth bypass, no destructive actions, no deploy.
 *
 * Usage: node visual-run.mjs <targetUrl> <outDir> [sampleQuery]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planVisualFlow } from "../../apps/central-plane/dist/visual-flow-plan.js";
// decideFromEvidence: this file used to carry its OWN pre-#347 copy (console
// errors → Needs Fix, the exact false-negative the noise filter removed) —
// drifted duplicates get the canonical, unit-tested ladder instead.
import { buildNonDevReport, buildAgentFixPrompt, renderNonDevReportHtml, decideFromEvidence } from "../../apps/central-plane/dist/nondev-report.js";
import { classifyActionSafety } from "./lib/safety.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const INTENT_DEFAULT =
  "골퍼가 앱을 열어 현재 골프장 컨디션 확인 도구임을 이해하고, 코스/라운드가 지금 플레이 가능한지 확인하는 핵심 플로우를 시작할 수 있어야 한다";

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

export async function visualRun(config, outDir) {
  const shotsDir = join(outDir, "screenshots");
  const videoDir = join(outDir, "video");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkFailures = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
  page.on("requestfailed", (r) => networkFailures.push(`${r.method()} ${r.url().slice(0, 200)} (${r.failure()?.errorText ?? "failed"})`));
  page.on("response", (r) => r.status() >= 500 && networkFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 200)}`));

  const shots = [];
  const stepOutcomes = [];
  const evidence = {
    urlLoaded: config.targetUrl,
    loadStatus: null,
    primaryActionFound: false,
    interacted: false,
    routeBeforeClick: null,
    routeAfterClick: null,
    routeChanged: false,
    consoleErrors,
    networkFailures,
    inputs: [],
    ctas: [],
    plan: [],
  };

  async function snap(name, label) {
    const p = join(shotsDir, name);
    try {
      await page.screenshot({ path: p, fullPage: false });
      shots.push({ label, src: `screenshots/${name}` });
    } catch {
      /* ignore screenshot failures */
    }
  }

  try {
    const resp = await page.goto(config.targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    evidence.loadStatus = resp ? resp.status() : null;
    evidence.routeBeforeClick = page.url();
    await page.waitForTimeout(1800);
    await snap("step-00-initial.png", "첫 화면 (앱을 열었을 때)");

    const ctas = await collectCtas(page);
    const inputs = await collectInputs(page);
    evidence.ctas = ctas.slice(0, 20);
    evidence.inputs = inputs;

    const plan = planVisualFlow({
      intentAnchor: config.intentAnchor,
      ctas: ctas.map((c) => ({ text: c.text, selector: c.selector })),
      inputs,
      forbidden: config.forbidden,
      sampleQuery: config.sampleQuery,
    });
    evidence.plan = plan;
    evidence.primaryActionFound = plan.some((s) => s.action === "click" || s.action === "type");

    // D6/D7 parity with inspector-run.mjs (2026-07-17 accuracy eval): success is
    // change-from-baseline, and Enter is pressed only when no click step submits.
    const bodyTextAt = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const bodyBefore = await bodyTextAt();
    const planHasClick = plan.some((s) => s.action === "click");

    let stepIdx = 0;
    for (const step of plan) {
      stepIdx += 1;
      const shotName = `step-${String(stepIdx).padStart(2, "0")}.png`;
      try {
        if (step.action === "click") {
          const safety = classifyActionSafety(step.targetText);
          if (!safety.safe) {
            stepOutcomes.push({ label: step.label, ok: false, note: `안전하지 않아 건너뜀 (${safety.category})` });
            continue;
          }
          await page.getByText(step.targetText, { exact: true }).first().click({ timeout: 8000 });
          evidence.interacted = true;
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1500);
          evidence.routeAfterClick = page.url();
          evidence.routeChanged = evidence.routeAfterClick !== evidence.routeBeforeClick;
          await snap(shotName, `${step.label} 후 화면`);
          stepOutcomes.push({ label: step.label, ok: true });
        } else if (step.action === "type") {
          const field = step.placeholder ? page.getByPlaceholder(step.placeholder).first() : page.locator("input").first();
          await field.fill(step.value, { timeout: 8000 });
          if (!planHasClick) await field.press("Enter").catch(() => {});
          evidence.interacted = true;
          await page.waitForTimeout(1800);
          await snap(shotName, `${step.label} 후 화면`);
          stepOutcomes.push({ label: step.label, ok: true });
        } else {
          await snap(shotName, step.label);
          const bodyNow = await bodyTextAt();
          const visibleChange = bodyNow !== bodyBefore || evidence.routeChanged;
          if (evidence.interacted) evidence.visibleChangeAfterAction = visibleChange;
          const ok = networkFailures.length === 0 && (!evidence.interacted || visibleChange);
          const note = networkFailures.length ? "데이터 요청 실패가 관찰됨" : ok ? undefined : "동작 후 화면에 아무 변화가 없음";
          stepOutcomes.push({ label: step.label, ok, note });
        }
      } catch (err) {
        await snap(shotName, `${step.label} (실패)`);
        stepOutcomes.push({ label: step.label, ok: false, note: `동작 실패: ${String(err).slice(0, 100)}` });
      }
    }
  } finally {
    await context.close(); // finalizes the video
    await browser.close();
  }

  // Save the recorded video next to the report.
  let videoRel = null;
  try {
    const vp = await page.video()?.path();
    if (vp) {
      copyFileSync(vp, join(videoDir, "flow.webm"));
      videoRel = "video/flow.webm";
    }
  } catch {
    /* video optional */
  }

  evidence.consoleErrorCount = consoleErrors.length;
  const decision = decideFromEvidence(evidence, stepOutcomes);
  const reportInput = {
    targetUrl: config.targetUrl,
    intentAnchor: config.intentAnchor,
    loadStatus: evidence.loadStatus,
    primaryActionFound: evidence.primaryActionFound,
    interacted: evidence.interacted,
    routeAfterClick: evidence.routeAfterClick,
    routeChanged: evidence.routeChanged,
    consoleErrors,
    networkFailures,
    decision,
    steps: stepOutcomes,
  };
  const report = buildNonDevReport(reportInput);
  const agentPrompt = buildAgentFixPrompt(reportInput);
  const html = renderNonDevReportHtml(report, shots, videoRel, agentPrompt);

  writeFileSync(join(outDir, "browser-evidence.json"), JSON.stringify({ ...evidence, stepOutcomes, decision }, null, 2));
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "report.html"), html);
  writeFileSync(join(outDir, "report.md"), toMarkdown(report));
  writeFileSync(join(outDir, "agent-prompt.md"), agentPrompt);
  return { report, reportInput, agentPrompt, decision, shots, videoRel };
}

function toMarkdown(r) {
  const lines = [`# ${r.title}`, "", `**대상:** ${r.target}`, `**확인하려던 것:** ${r.intent}`, "", `## 판정: ${r.verdict}`, "", r.oneLine, "", "## 무엇을 발견했나요", ""];
  if (!r.findings.length) lines.push("특별히 막히는 지점을 찾지 못했어요.");
  for (const f of r.findings) {
    lines.push(`### [${f.severity}] ${f.what}`, `- 왜: ${f.why}`, `- 어떻게: ${f.how}`);
    if (f.evidence) lines.push(`- 개발자용: \`${f.evidence}\``);
    lines.push("");
  }
  lines.push("## 다음에 해볼 것", "", ...r.nextSteps.map((s) => `- ${s}`), "", "## 안내", "", ...r.notes.map((s) => `- ${s}`), "");
  return lines.join("\n");
}

/**
 * Stage 261 — upload a finished run to the central plane so it shows on the
 * dashboard (app.trysimsa.com). Uploads run metadata + report + agent prompt,
 * then each screenshot and the flow video as evidence files. The userKey
 * travels only in the request body/query (never logged).
 */
export async function uploadRun({ apiBase, userKey, projectId, reportInput, report, agentPrompt, shots, videoRel, outDir }) {
  const base = apiBase.replace(/\/$/, "");
  const createRes = await fetch(`${base}/workspace/projects/${projectId}/visual-checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userKey,
      targetUrl: reportInput.targetUrl,
      intent: reportInput.intentAnchor,
      decision: reportInput.decision,
      works: report.works,
      executor: "local",
      report,
      agentPrompt,
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok || !created.ok) throw new Error(`create failed: ${createRes.status} ${created?.error ?? ""}`);
  const runId = created.check.id;

  const files = [...shots.map((s) => s.src), ...(videoRel ? [videoRel] : [])];
  let uploaded = 0;
  for (const rel of files) {
    const body = readFileSync(join(outDir, rel));
    const url = `${base}/workspace/projects/${projectId}/visual-checks/${runId}/evidence?userKey=${encodeURIComponent(userKey)}&name=${encodeURIComponent(rel)}`;
    const res = await fetch(url, { method: "POST", body });
    if (res.ok) uploaded += 1;
    else console.error(`[upload] evidence failed (${res.status}): ${rel}`);
  }
  return { runId, uploaded, total: files.length };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("visual-run.mjs")) {
  const wantUpload = process.argv.includes("--upload");
  const args = process.argv.slice(2).filter((a) => a !== "--upload");
  const targetUrl = args[0] || "http://localhost:3000/";
  const outDir = args[1] || join(here, "out", "visual");
  const sampleQuery = args[2] || "서울";
  const config = {
    targetUrl,
    intentAnchor: INTENT_DEFAULT,
    sampleQuery,
    forbidden: ["payment", "delete", "send", "invite", "publish", "deploy", "결제", "삭제", "발행", "배포", "로그아웃"],
  };
  visualRun(config, outDir)
    .then(async (r) => {
      console.log(`[visual] decision: ${r.decision} | works: ${r.report.works} | shots: ${r.shots.length} | video: ${r.videoRel ?? "none"}`);
      if (wantUpload) {
        const apiBase = process.env.SIMSA_API_BASE;
        const userKey = process.env.SIMSA_USER_KEY;
        const projectId = process.env.SIMSA_PROJECT_ID;
        if (!apiBase || !userKey || !projectId) {
          throw new Error("--upload requires SIMSA_API_BASE, SIMSA_USER_KEY, SIMSA_PROJECT_ID env vars");
        }
        const up = await uploadRun({ ...r, apiBase, userKey, projectId, outDir });
        console.log(`[upload] run ${up.runId}: ${up.uploaded}/${up.total} evidence files uploaded`);
      }
    })
    .catch((e) => {
      console.error("[visual] error:", e);
      process.exit(1);
    });
}
