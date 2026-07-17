/**
 * fix-first-probe.mjs — live probe for #368 (fix-first pack routing).
 *
 * Seeds localStorage with a project whose review found failures, then checks
 * the export screen live on production:
 *   1. failed items WITHOUT fix plans → amber "확인 결과부터" notice + CTA
 *   2. every failed item WITH a plan  → green "수정 지시 담김" banner
 *
 * Run: node fix-first-probe.mjs [baseUrl]   (default https://app.trysimsa.com)
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://app.trysimsa.com";
const PID = "probe_fixfirst1";

const PROJECT = {
  id: PID,
  name: "픽스퍼스트 프로브",
  description: "probe",
  createdAt: new Date().toISOString(),
  spec: { completeness: 80, goal: "probe", included: [], excluded: [], openDecisions: [] },
  requirements: [
    { id: "req_a", title: "항목 A", status: "failed", category: "core", priority: "high" },
    { id: "req_b", title: "항목 B", status: "failed", category: "core", priority: "high" },
  ],
};

const CHECK_RESULTS = {
  ok: true,
  source: "llm",
  summary: { passed: 0, failed: 2, inconclusive: 0, needsDecision: 0 },
  results: [
    { itemId: "req_a", status: "failed", title: "항목 A", userLabel: "안 맞음", reason: "r", evidence: [], nextAction: "n" },
    { itemId: "req_b", status: "failed", title: "항목 B", userLabel: "안 맞음", reason: "r", evidence: [], nextAction: "n" },
  ],
};

const FIX = (itemId) => ({
  ok: true, source: "llm", itemId,
  suggestion: {
    plainSummary: "고침",
    productSpecPatch: { addDecisions: [], addCriteria: [], addOpenQuestions: [] },
    builderBrief: { title: "t", goal: "g", tasks: [], doneWhen: [], doNotDo: [], verifyBy: [] },
  },
});

function seedScript(ext) {
  return `
    localStorage.setItem("conclave_wf_projects:anon", ${JSON.stringify(JSON.stringify([PROJECT]))});
    localStorage.setItem("conclave_wf_ext_${PID}", ${JSON.stringify(JSON.stringify(ext))});
  `;
}

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };

const browser = await chromium.launch();
try {
  // ── Case 1: fixes missing ──────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(seedScript({ entryPath: "idea", checkResults: CHECK_RESULTS }));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/projects/${PID}/export`, { waitUntil: "networkidle" });
    const body = await page.textContent("body");
    check("amber notice shown", body.includes("확인 결과부터 마치면"));
    check("counts rendered (2건/2건)", /안 맞음이\s*2/.test(body) && /그중\s*2/.test(body));
    check("CTA to checks present", await page.locator(`a[href$="/projects/${PID}/checks"]`).count() > 0);
    check("honest export note", body.includes("수정 지시 없이 나갑니다"));
    check("no green banner", !body.includes("수정 지시가 이 패키지에 담깁니다"));
    await ctx.close();
  }

  // ── Case 2: fixes ready ────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(seedScript({
      entryPath: "idea",
      checkResults: CHECK_RESULTS,
      fixSuggestions: { req_a: FIX("req_a"), req_b: FIX("req_b") },
    }));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/projects/${PID}/export`, { waitUntil: "networkidle" });
    const body = await page.textContent("body");
    check("green banner shown", body.includes("수정 지시가 이 패키지에 담깁니다"));
    check("amber notice gone", !body.includes("확인 결과부터 마치면"));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
