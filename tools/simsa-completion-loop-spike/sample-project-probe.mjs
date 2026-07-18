/**
 * sample-project-probe.mjs — G10 원클릭 예시 라이브 프로브.
 *
 * 빈 상태에서 "예시로 직접 만져보기" 클릭 → 개요로 이동 → 예시 배너 +
 * 채워진 상태(검수 결과) 확인 → 확인 결과 화면에서 2중 확인 배지까지.
 *
 * Run: node sample-project-probe.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://app.trysimsa.com";

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });

  const tryBtn = page.getByRole("button", { name: /예시로 직접 만져보기|Try a hands-on sample/ });
  check("try-sample button visible on empty state", (await tryBtn.count()) > 0);

  await tryBtn.first().click();
  await page.waitForURL(/\/projects\/sample_/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  const body = (await page.textContent("body")) ?? "";
  check("navigated to sample overview", /sample_/.test(page.url()));
  check("sample banner shown", body.includes("체험용 예시예요"));
  check("exit CTA present", body.includes("내 아이디어로 시작하기"));
  check("project content loaded", body.includes("동네 빵집 예약 앱"));

  // 확인 결과 화면 — 채워진 검수 결과 + 2중 확인 배지
  const pid = page.url().match(/projects\/(sample_[a-z0-9]+)/)?.[1];
  await page.goto(`${BASE}/projects/${pid}/checks`, { waitUntil: "networkidle" });
  const checksBody = (await page.textContent("body")) ?? "";
  check("check results pre-filled", checksBody.includes("예약할 때 카드로 미리 결제할 수 있어야 함"));
  check("dual-check badge visible", checksBody.includes("AI 2중 확인됨"));
  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
