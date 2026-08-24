/** AF-4 카드의 infer-intent 요청을 브라우저에서 직접 관측한다. */
import { chromium } from "playwright";
const BASE = "https://app.trysimsa.com";
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ko-KR" });
const page = await ctx.newPage();

page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 200)); });
page.on("requestfailed", (r) => {
  if (r.url().includes("infer-intent")) console.log("  [requestfailed]", r.url(), "→", r.failure()?.errorText);
});
page.on("response", async (r) => {
  if (r.url().includes("infer-intent")) {
    console.log("  [response]", r.status(), r.url());
    console.log("            body:", (await r.text().catch(() => "<no body>")).slice(0, 300));
  }
});

await page.addInitScript(() => localStorage.setItem("conclave:locale", "ko"));
await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 60000 });
await page.locator("main input[type='text']").first().fill("https://app.trysimsa.com/");
await page.locator("main .btn-primary, main button[class*='primary']").last().click();
await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
console.log("landed:", page.url());
for (let i = 1; i <= 9; i++) {
  await page.waitForTimeout(5000);
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  const state = body.includes("저희가 읽은 이 앱은") ? "READY(초안)"
    : body.includes("이 앱이 무엇을 하는지 알려주세요") ? "EMPTY(정직하게 빈칸)"
    : body.includes("지금은 앱을 읽지 못했어요") ? "ERROR"
    : body.includes("앱을 읽어서") ? "LOADING" : "카드없음";
  console.log(`  +${i * 5}s → ${state}`);
  if (state !== "LOADING") break;
}
await browser.close();
