/**
 * check-compare-probe.mjs — G3 회귀 감지 라이브 프로브.
 *
 * localStorage 시드: 직전 검수에서 "통과"였다고 기록된 항목이 실제로는 확실히
 * 실패하는 항목(제외 범위 정면 충돌 — 오늘 반복 실증된 결정론 케이스)인 프로젝트.
 * 실서비스에서 "다시 확인"을 눌러 재검수 → 앰버 회귀 배너가 떠야 한다.
 *
 * Run: node check-compare-probe.mjs [baseUrl]   (default https://app.trysimsa.com)
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://app.trysimsa.com";
const PID = "probe_g3compare1";

const PROJECT = {
  id: PID,
  name: "회귀 프로브",
  description: "probe",
  createdAt: new Date().toISOString(),
  spec: { completeness: 80, goal: "할 일 앱", included: ["할 일 추가"], excluded: ["구독료 결제"], openDecisions: [] },
  requirements: [
    { id: "req_pay", title: "구독료 결제를 받을 수 있어야 함", status: "passed", category: "core", priority: "high" },
    { id: "req_add", title: "할 일을 추가할 수 있어야 함", status: "passed", category: "core", priority: "high" },
  ],
};

const EXT = {
  entryPath: "idea",
  productSpec: {
    productName: "할 일 앱", oneLine: "할 일을 적는 앱", targetUsers: ["개인"],
    problem: "할 일을 잊습니다", included: ["할 일 추가"], excluded: ["구독료 결제"],
    userFlow: ["추가"], decisions: [], openQuestions: [],
  },
  itemCriteria: { req_pay: ["카드 결제", "영수증"], req_add: ["목록 표시", "빈 입력 거부"] },
  // 직전 실행: 결제 항목이 "통과"였다고 기록 — 재검수에서 failed가 되면 회귀.
  checkResults: {
    ok: true, source: "llm",
    summary: { passed: 2, failed: 0, inconclusive: 0, needsDecision: 0 },
    results: [
      { itemId: "req_pay", status: "passed", title: "구독료 결제를 받을 수 있어야 함", userLabel: "통과", reason: "r", evidence: [], nextAction: "" },
      { itemId: "req_add", status: "passed", title: "할 일을 추가할 수 있어야 함", userLabel: "통과", reason: "r", evidence: [], nextAction: "" },
    ],
  },
};

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(`
    localStorage.setItem("conclave_wf_projects:anon", ${JSON.stringify(JSON.stringify([PROJECT]))});
    localStorage.setItem("conclave_wf_ext_${PID}", ${JSON.stringify(JSON.stringify(EXT))});
  `);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/projects/${PID}/checks`, { waitUntil: "networkidle" });

  // 직전 결과가 로드돼 "다시 확인" 버튼이 보인다.
  const reRun = page.getByRole("button", { name: /다시 확인|Check again/ });
  check("re-run button visible (previous results loaded)", (await reRun.count()) > 0);

  await reRun.first().click();
  // LLM 검수 대기 (~10-25s) — 회귀 배너 텍스트를 기다린다.
  let bannerSeen = false;
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(4000);
    const body = (await page.textContent("body")) ?? "";
    if (body.includes("지난번과 달라졌어요")) { bannerSeen = true; break; }
    if (body.includes("확인 중 오류")) break;
  }
  const body = (await page.textContent("body")) ?? "";
  check("regression banner shown", bannerSeen);
  check("regressed item listed in banner", body.includes("구독료 결제를 받을 수 있어야 함"));
  check("hint present (check these first)", body.includes("이것부터 확인하세요"));
  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
