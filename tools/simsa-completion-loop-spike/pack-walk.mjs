/** 제가 "이미 라이브"라고 말했지만 걸어보지 않은 경로 — 고쳐보기 → 빌더팩. */
import { chromium } from "playwright";
const BASE = "https://app.trysimsa.com";
const b = await chromium.launch();
const ctx = await b.newContext({ locale: "ko-KR" });
const p = await ctx.newPage();
await p.addInitScript(() => localStorage.setItem("conclave:locale", "ko"));

await p.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 60000 });
await p.locator("main input[type='text']").first().fill("https://app.trysimsa.com/");
await p.locator("main .btn-primary, main button[class*='primary']").last().click();
await p.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
const pid = (p.url().match(/projects\/([^/?#]+)/) ?? [])[1];
console.log("프로젝트:", pid);

// 확인 카드가 항목을 만들 때까지 기다렸다가 승인
for (let i = 1; i <= 12; i++) {
  await p.waitForTimeout(5000);
  const t = await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  if (t.includes("저희가 읽은 이 앱은")) {
    const btn = p.getByRole("button", { name: /네, 맞아요/ }).first();
    if (await btn.count()) { await btn.click(); console.log("확인 카드 승인 → 항목 생성"); }
    break;
  }
}
await p.waitForTimeout(2000);

for (const [slug, label, needles] of [
  ["checks", "확인 결과", ["확인", "검수"]],
  ["fixes", "고쳐보기", ["고쳐", "수정"]],
  ["export", "빌더 팩", ["팩", "복사", "붙여넣"]],
]) {
  await p.goto(`${BASE}/projects/${pid}/${slug}`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(3000);
  const t = await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  const dead = await p.evaluate(() => {
    const btns = [...document.querySelectorAll("main button, main a")].filter((e) => e.offsetParent !== null);
    const disabled = btns.filter((e) => e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true");
    return { total: btns.length, disabled: disabled.length, labels: disabled.map((e) => (e.innerText||"").trim().slice(0,24)).slice(0,4) };
  });
  const hit = needles.some((n) => t.includes(n));
  console.log(`\n[${label}] len=${t.length} 내용매칭=${hit ? "✅" : "❌"} 버튼 ${dead.total}개(비활성 ${dead.disabled}) ${dead.labels.length ? JSON.stringify(dead.labels) : ""}`);
  console.log("   " + t.replace(/^.*?KO /, "").slice(0, 220));
}
await b.close();
