/** AF 트레인 최종 확인 — CTA를 **정확한 문구**로 구분한다(설명 목록과 혼동 금지). */
import { chromium } from "playwright";
const BASE = "https://app.trysimsa.com";

// 지휘 센터의 CTA 설명문(액션별로 유일한 문구).
const CTA = {
  "connect_code (옛 강요)": "앱이 있는 GitHub 저장소를 연결하세요",
  "add_url (신규)": "저장소는 받았어요",
  "run_review": "확인을 실행",
  "view_results": "결과",
};
const CARD = {
  "AF-4 초안": "저희가 읽은 이 앱은",
  "AF-4 빈칸": "이 앱이 무엇을 하는지 알려주세요",
  "AF-4 로딩": "앱을 읽어서",
  "need_url": "코드는 연결됐어요",
  "깊이+못본것": "로그인 뒤 화면은 확인하지 않았습니다",
};

const browser = await chromium.launch();
async function run(submission, label) {
  const ctx = await browser.newContext({ locale: "ko-KR" });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("conclave:locale", "ko"));
  await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator("main input[type='text']").first().fill(submission);
  await page.locator("main .btn-primary, main button[class*='primary']").last().click();
  await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
  // 의도 추론은 ~45초 걸린다 — 창을 넉넉히.
  for (let i = 1; i <= 14; i++) {
    await page.waitForTimeout(5000);
    const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
    const cards = Object.entries(CARD).filter(([, n]) => body.includes(n)).map(([k]) => k);
    if (!cards.includes("AF-4 로딩") || i === 14) {
      const ctas = Object.entries(CTA).filter(([, n]) => body.includes(n)).map(([k]) => k);
      console.log(`\n### ${label}  (+${i * 5}s)`);
      console.log("   카드:", cards.join(" · ") || "없음");
      console.log("   지휘센터 CTA:", ctas.join(" · ") || "없음");
      break;
    }
  }
  await ctx.close();
}
await run("https://app.trysimsa.com/", "A) 앱 주소");
await run("https://github.com/3SVS/simsa", "B) 저장소만");
await browser.close();
