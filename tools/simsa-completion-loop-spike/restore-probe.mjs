/**
 * restore-probe.mjs — G8 D-2 라이브 프로브: "새 기기" 시뮬레이션.
 *
 * API로 프로젝트+ext를 서버에 시드(다른 기기에서 작업한 상태) → 무상태 브라우저에
 * 같은 userKey만 심고 /projects 접속 → 복원 카드 표시 → [이 기기로 가져오기] →
 * 목록 등장 → 개요 열림 + ext(검수 결과) 복원 확인.
 *
 * Run: node restore-probe.mjs [baseUrl]
 */
import { chromium } from "playwright";

const APP = process.argv[2] ?? "https://app.trysimsa.com";
const API = "https://conclave-ai.seunghunbae.workers.dev";
const UKEY = `rstr_${Date.now().toString(36)}`; // probe_ 프리픽스는 복원 카드에서 제외되므로 별도
const PID = `rstrproj_${Date.now().toString(36)}`;

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };

// 1. 다른 기기에서의 작업을 서버에 시드
const mirror = await fetch(`${API}/workspace/projects`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: PID, userKey: UKEY, title: "다른 기기의 빵집 앱", idea: "동네 빵집 예약",
    understood: {},
    productSpec: { productName: "다른 기기의 빵집 앱", oneLine: "예약 앱", problem: "헛걸음", included: ["예약"], excluded: ["결제"], userFlow: [], decisions: [], openQuestions: [] },
    items: [{ id: "r1", title: "예약할 수 있어야 함", status: "passed", criteria: ["시간 선택"] }],
  }),
});
check("seed: project mirrored", mirror.ok);
const extPut = await fetch(`${API}/workspace/projects/${PID}/ext`, {
  method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ userKey: UKEY, ext: { entryPath: "idea", checkResults: { ok: true, source: "llm", summary: { passed: 1, failed: 0, inconclusive: 0, needsDecision: 0 }, results: [{ itemId: "r1", status: "passed", title: "예약할 수 있어야 함", userLabel: "통과", reason: "충분", evidence: [], nextAction: "" }] } } }),
});
check("seed: ext saved", extPut.ok);

// 2. 새 기기: userKey만 있는 무상태 브라우저
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem("conclave_user_key", ${JSON.stringify(UKEY)});`);
  const page = await ctx.newPage();
  await page.goto(`${APP}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const body1 = (await page.textContent("body")) ?? "";
  check("restore card shown", body1.includes("다른 기기에서 만든 프로젝트"));
  check("project listed in card", body1.includes("다른 기기의 빵집 앱"));

  const btn = page.getByRole("button", { name: /이 기기로 가져오기|Bring to this device/ });
  check("explicit import button present", (await btn.count()) > 0);
  await btn.first().click();
  await page.waitForTimeout(2500);

  const body2 = (await page.textContent("body")) ?? "";
  check("card cleared after import", !body2.includes("다른 기기에서 만든 프로젝트"));
  check("project now in local list", body2.includes("다른 기기의 빵집 앱"));

  // 3. 개요 + 검수 결과(ext) 복원 확인
  await page.goto(`${APP}/projects/${PID}/checks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const checksBody = (await page.textContent("body")) ?? "";
  check("restored check results visible", checksBody.includes("예약할 수 있어야 함"));
  await ctx.close();
} finally {
  await browser.close();
}

// cleanup
await fetch(`${API}/workspace/projects/${PID}?userKey=${UKEY}`, { method: "DELETE" }).catch(() => {});

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
