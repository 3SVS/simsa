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

/**
 * E-corpus-1 live-debug rev marker. Bump on every runner change — the first
 * log line of every run carries it, so a tail session can tell instantly
 * whether the container rollout actually picked up the new image (the #412~
 * #418 train could never rule out "old image still serving").
 */
export const RUNNER_REV = "ec1-dbg2";

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
    partial: "사이트가 무거워 시간 안에 다 확인하지 못했어요 — 여기까지 본 내용만 담았어요",
  },
  en: {
    unsafeSkipped: (cat) => `Skipped — not safe to run (${cat})`,
    noResults: "No results/content appeared (or the data request failed)",
    networkFailed: "A data request was observed failing",
    actionFailed: (err) => `Action failed: ${err}`,
    noChange: "Nothing on the screen changed after the action",
    reloadCheck: "Check the entered content survives a page reload",
    notPersisted: "The entered content disappeared after a reload — the screen changed but nothing was actually saved",
    partial: "The site was heavy and couldn't be fully checked in time — this covers only what was seen so far",
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
export async function runInspection({ targetUrl, intent, outDir, sampleQuery, locale = "ko", budgetMs, runId, onPhase }) {
  const N = STEP_NOTES[locale === "en" ? "en" : "ko"];
  // E-corpus-1 phase log: one line per runner phase, elapsed-stamped, so the
  // LAST entry before silence names the exact operation that hangs.
  // ec1-dbg2: `wrangler tail`은 컨테이너 stdout을 포함하지 않는다(2026-07-20
  // 실측) — 그래서 onPhase 콜백으로 위상을 server.mjs에 노출하고, server가
  // hard-rail 실패 콜백의 error에 마지막 위상들을 실어 보낸다(in-band 진단).
  // PRIVACY: never log userKey/callbackToken — runId + target host + phase only.
  const t0 = Date.now();
  const tag = `[insp ${runId ?? "?"}]`;
  const plog = (msg) => {
    const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`;
    console.log(`${tag} ${line}`);
    try {
      onPhase?.(line);
    } catch {
      /* diagnostics must never break the run */
    }
  };
  plog(`runner-rev=${RUNNER_REV} budgetMs=${budgetMs ?? "none"} locale=${locale}`);
  // E-corpus-1 (2026-07-19): soft deadline. When we cross it we stop driving NEW
  // steps and fall through to observe + verdict with whatever evidence exists —
  // a partial-but-honest report beats an empty timeout on heavy sites.
  const deadline = budgetMs && budgetMs > 0 ? Date.now() + budgetMs : Infinity;
  const overBudget = () => Date.now() > deadline;
  const shotsDir = join(outDir, "screenshots");
  const videoDir = join(outDir, "video");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  plog("launch:start");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  plog("launch:done");

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
    // E-corpus-1 (2026-07-19): 시간 예산 초과로 일부 단계를 건너뛰었는가.
    timedOutPartial: false,
  };

  // E-corpus-1 재작성 (2026-07-19, #415): 예산에 도달하면 컨텍스트를 강제 종료해
  // 진행 중이던 Playwright 작업을 "Target closed"로 터뜨린다 → 아래 catch가 지금까지
  // 모은 evidence로 무조건 판정을 만들어 반환한다. 개별 작업(innerText/$$eval/
  // screenshot/waitForTimeout)이 예산 가드를 우회해도(무거운 사이트) server.mjs의
  // hard 4분 레일에 닿기 전에 부분 리포트가 반드시 나온다 — 빈손 타임아웃 제거의 핵심.
  let killTimer = null;
  if (deadline !== Infinity) {
    killTimer = setTimeout(() => {
      plog("killTimer:FIRED — browser.close() forcing");
      evidence.timedOutPartial = true;
      // context.close()는 graceful이라 무한 hang(무거운 사이트의 innerText/
      // $$eval 등)을 못 깬다 — browser.close()로 브라우저 프로세스를 강제
      // 종료해 진행 중 모든 작업을 즉시 터뜨린다(아래 catch로 빠짐).
      browser
        .close()
        .then(() => plog("killTimer:browser.close() resolved"))
        .catch((err) => plog(`killTimer:browser.close() rejected: ${String(err?.message ?? err).slice(0, 120)}`));
    }, budgetMs);
  }

  async function snap(name) {
    const p = join(shotsDir, name);
    try {
      await page.screenshot({ path: p, fullPage: false });
      evidenceFiles.push({ name: `screenshots/${name}`, path: p });
    } catch (err) {
      plog(`snap:${name} failed: ${String(err?.message ?? err).slice(0, 80)}`);
    }
  }

  try {
    // E-corpus-1: goto도 남은 예산 안에서만 기다린다(무거운 사이트가 여기서
    // 30s를 다 먹는 걸 막는다). 예산이 있으면 그 이하로 캡.
    const gotoTimeout = deadline === Infinity ? 30000 : Math.max(8000, Math.min(30000, deadline - Date.now() - 5000));
    plog(`goto:start timeout=${gotoTimeout}ms host=${safeLogHost(targetUrl)}`);
    const resp = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: gotoTimeout });
    evidence.loadStatus = resp ? resp.status() : null;
    evidence.routeBeforeClick = page.url();
    plog(`goto:done status=${evidence.loadStatus}`);
    // E-corpus-1: 이후 모든 Playwright 작업(click/waitForLoadState/reload 등)이
    // 남은 예산 안에서 timeout하도록 기본 타임아웃을 예산에 건다 — 개별 작업이
    // hang해 hard 4분 레일(빈손 실패)까지 가는 걸 막는 핵심 안전장치.
    if (deadline !== Infinity) {
      page.setDefaultTimeout(Math.max(3000, Math.min(8000, deadline - Date.now())));
    }
    await page.waitForTimeout(1800);
    plog("snap:initial start");
    await snap("step-00-initial.png");

    plog("collect:ctas start");
    const ctas = await collectCtas(page);
    plog(`collect:ctas done n=${ctas.length}`);
    plog("collect:inputs start");
    const inputs = await collectInputs(page);
    plog(`collect:inputs done n=${inputs.length}`);

    const plan = planVisualFlow({
      intentAnchor: intent,
      ctas: ctas.map((c) => ({ text: c.text, selector: c.selector })),
      inputs,
      forbidden: FORBIDDEN_ACTIONS,
      sampleQuery,
      locale,
    });
    evidence.primaryActionFound = plan.some((s) => s.action === "click" || s.action === "type");

    // E-corpus-1: goto+collect에서 이미 예산을 넘겼으면 구동 스텝을 아예 시작하지
    // 않는다(첫 화면 관찰만으로 정직 판정 — 무거운 사이트는 여기서 끝난다).
    if (overBudget()) {
      evidence.timedOutPartial = true;
      plog("budget:exceeded before drive steps");
    }

    // D7: success is measured as CHANGE from this baseline (body text or
    // route), never as an absolute page size — the old `bodyLen > 200` check
    // failed every small app card regardless of actual behavior.
    const bodyTextAt = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    plog(`plan:built steps=${plan.length} bodyBefore:start`);
    const bodyBefore = await bodyTextAt();
    plog(`bodyBefore:done len=${bodyBefore.length}`);
    // D6: when the plan submits via a CLICK step, Enter after typing would
    // double-submit (or submit an incomplete form) — press Enter only when
    // typing is the plan's only driver.
    const planHasClick = plan.some((s) => s.action === "click");

    let stepIdx = 0;
    for (const step of plan) {
      // E-corpus-1: 예산을 넘겼으면 남은 구동 스텝(click/type)은 건너뛰되
      // observe 스텝은 판정에 필요하므로 계속 실행한다(break 아님 — 마지막
      // 관찰까지 도달해 지금 화면 기준으로 정직하게 판정).
      if (overBudget() && step.action !== "observe") {
        evidence.timedOutPartial = true;
        continue;
      }
      stepIdx += 1;
      const shotName = `step-${String(stepIdx).padStart(2, "0")}.png`;
      plog(`step:${stepIdx}/${plan.length} ${step.action} start`);
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
          plog("observe:bodyNow start");
          const bodyNow = await bodyTextAt();
          plog(`observe:bodyNow done len=${bodyNow.length}`);
          const visibleChange = bodyNow !== bodyBefore || evidence.routeChanged;
          if (evidence.interacted) evidence.visibleChangeAfterAction = visibleChange;
          const ok = networkFailures.length === 0 && (!evidence.interacted || visibleChange);
          const note = networkFailures.length ? N.networkFailed : ok ? undefined : N.noChange;
          stepOutcomes.push({ label: step.label, ok, note });
        }
      } catch (err) {
        plog(`step:${stepIdx} ${step.action} failed: ${String(err?.message ?? err).slice(0, 120)}`);
        await snap(shotName);
        stepOutcomes.push({ label: step.label, ok: false, note: N.actionFailed(String(err).slice(0, 100)) });
      }
      plog(`step:${stepIdx}/${plan.length} ${step.action} done`);
    }

    // G4-① (2026-07-18): 지속성 확인 — 내용을 "추가"한 플로우(입력한 텍스트가
    // 화면에 나타남 + 액션 후 변화 관찰)에서만, 새로고침 후에도 그 텍스트가
    // 남아 있는지 본다. 낙관적 UI만 있고 저장이 없는 앱(Potemkin의 마지막
    // 형태)을 잡는 최종 시험. 전제가 하나라도 빠지면(검색 플로우, 라우트 이동,
    // 마커 미노출) null 유지 — 측정 안 된 것은 절대 판정에 영향을 주지 않는다.
    const typedStep = plan.find((s) => s.action === "type");
    if (
      typedStep &&
      !overBudget() && // E-corpus-1: 지속성 확인은 reload가 필요해 비싸다 — 예산 초과 시 생략(측정 null 유지).
      evidence.interacted &&
      evidence.visibleChangeAfterAction === true &&
      !evidence.routeChanged
    ) {
      try {
        plog("persist:check start");
        const bodyAfterAction = await bodyTextAt();
        if (bodyAfterAction.includes(typedStep.value)) {
          plog("persist:reload start");
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
      } catch (err) {
        plog(`persist:check failed: ${String(err?.message ?? err).slice(0, 80)}`);
        /* best-effort — 측정 실패는 null 유지 */
      }
    }

    // E-corpus-1: 예산 초과로 조기 종료했으면 정직하게 남긴다 — 이 스텝이
    // classifyFindings의 stepFailed로 잡혀 리포트에 "다 못 봤다"가 드러나고,
    // decideFromEvidence는 부분 증거 기준으로 (interacted면 UAR, 아니면 Needs
    // Clarification) 판정한다. 빈손 실패가 아니다.
    if (evidence.timedOutPartial) {
      stepOutcomes.push({ label: N.partial, ok: false, note: N.partial });
    }
  } catch (err) {
    // #415: 여기서 절대 다시 던지지 않는다 — 지금까지의 evidence로 판정한다.
    plog(`outer-catch: timedOutPartial=${evidence.timedOutPartial} err=${String(err?.message ?? err).slice(0, 120)}`);
    if (evidence.timedOutPartial) {
      // killTimer가 컨텍스트를 강제 종료한 경우 = 예산 초과 → 정직한 부분 리포트.
      if (!stepOutcomes.some((s) => s.label === N.partial)) {
        stepOutcomes.push({ label: N.partial, ok: false, note: N.partial });
      }
    } else {
      // 예산과 무관한 조기 실패(로드 자체 실패 등) — evidence(networkFailures/
      // loadStatus)가 이미 사실을 담고 있으니 판정 사다리에 맡긴다.
      stepOutcomes.push({ label: N.actionFailed(String(err?.message ?? err).slice(0, 100)), ok: false });
    }
  } finally {
    if (killTimer) clearTimeout(killTimer);
    plog("finally:context.close start");
    try { await context.close(); } catch { /* killTimer가 이미 닫았을 수 있음 */ }
    plog("finally:browser.close start");
    try { await browser.close(); } catch { /* ignore */ }
    plog("finally:closed");
  }

  // Save the recorded video next to the screenshots.
  try {
    plog("video:path start");
    const vp = await page.video()?.path();
    if (vp && existsSync(vp)) {
      const dest = join(videoDir, "flow.webm");
      copyFileSync(vp, dest);
      evidenceFiles.push({ name: "video/flow.webm", path: dest });
    }
    plog("video:done");
  } catch (err) {
    plog(`video:failed: ${String(err?.message ?? err).slice(0, 80)}`);
  }

  evidence.consoleErrorCount = consoleErrors.length;
  const decision = decideFromEvidence(evidence, stepOutcomes);
  plog(`decision=${decision} timedOutPartial=${evidence.timedOutPartial}`);
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

/** Host-only URL for log lines (never the full URL — query strings can carry tokens). */
function safeLogHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
