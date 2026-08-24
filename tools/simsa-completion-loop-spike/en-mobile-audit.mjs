/** EN 전 여정 + 모바일 360px (증거 규칙 R2 — 미측정 칸 줄이기). */
import { chromium } from "playwright";
const BASE = "https://app.trysimsa.com";

const KO_RE = /[가-힣]/;
async function snap(page, label) {
  const b = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  const ko = (b.match(/[가-힣]/g) ?? []).length;
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  const tiny = await page.evaluate(() => {
    const bad = [...document.querySelectorAll("button, a")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 32;
    });
    return bad.length;
  });
  console.log(`  ${label}: 한글 ${ko}자 · 가로스크롤 ${overflow ? "❌ 있음" : "✅ 없음"} · 작은터치대상 ${tiny}개`);
  return { ko, overflow, b };
}

const browser = await chromium.launch();

console.log("=== EN 여정 (한글 누수 = 결함) ===");
{
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("conclave:locale", "en"));
  await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 60000 });
  await snap(page, "진입 화면(EN)");
  await page.locator("main input[type='text']").first().fill("https://app.trysimsa.com/");
  await page.locator("main .btn-primary, main button[class*='primary']").last().click();
  await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
    if (!s.includes("Reading your app") && !s.includes("앱을 읽어서")) break;
  }
  const r = await snap(page, "프로젝트 화면(EN)");
  const hasEnCard = r.b.includes("Here is what your app looks like");
  const hasEnDepth = r.b.includes("Anything behind a login") || r.b.includes("Public surface");
  console.log(`  → 확인 카드(EN): ${hasEnCard ? "✅" : "❌"} · 깊이 표기(EN): ${hasEnDepth ? "✅" : "❌"}`);
  await ctx.close();
}

console.log("\n=== 모바일 360px (실기기 아님 — 뷰포트만) ===");
{
  const ctx = await browser.newContext({ locale: "ko-KR", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("conclave:locale", "ko"));
  for (const [path, label] of [["/projects/new?path=code", "진입 화면"], ["/projects", "프로젝트 목록"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
    await snap(page, label);
  }
  await ctx.close();
}
await browser.close();
