/** AF 트레인 라이브 실증 — 특정 문구의 존재를 직접 확인한다(잘린 스냅샷 말고). */
import { chromium } from "playwright";

const BASE = "https://app.trysimsa.com";
const MARKERS = {
  "AF-1 첫 화면": "만드신 앱을 보여주세요",
  "AF-1 감지 표시": "읽었어요",
  "AF-4 확인 카드": "저희가 읽은 이 앱은",
  "AF-4 로딩": "앱을 읽어서",
  "AF-4 빈 상태": "이 앱이 무엇을 하는지 알려주세요",
  "AF-4 오류": "지금은 앱을 읽지 못했어요",
  "AF-5 깊이(공개화면)": "공개 화면",
  "AF-5 못본것": "로그인 뒤 화면은 확인하지 않았습니다",
  "AF-1 need_url": "코드는 연결됐어요",
  "옛 GitHub 강요": "GitHub 저장소를 연결하세요",
};

async function report(page, title) {
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  console.log(`\n=== ${title} (${page.url()}) len=${body.length}`);
  for (const [name, needle] of Object.entries(MARKERS)) {
    if (body.includes(needle)) console.log(`   ✔ ${name}`);
  }
  return body;
}

const browser = await chromium.launch();
async function run(submission, label) {
  const ctx = await browser.newContext({ locale: "ko-KR" });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("conclave:locale", "ko"));
  await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 60000 });
  await report(page, `${label} — 첫 화면`);
  await page.locator("main input[type='text']").first().fill(submission);
  await page.waitForTimeout(500);
  await report(page, `${label} — 입력 후`);
  await page.locator("main .btn-primary, main button[class*='primary']").last().click();
  await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
  for (const wait of [5000, 15000, 20000]) {
    await page.waitForTimeout(wait);
    await report(page, `${label} — 랜딩 +${wait}ms 누적`);
  }
  await ctx.close();
}

await run("https://app.trysimsa.com/", "A) 앱 주소");
await run("https://github.com/3SVS/simsa", "B) 저장소만");
await browser.close();
