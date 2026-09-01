/**
 * signup-local-check.mjs — 가입 흐름 다섯 단계를 **로컬에서** 검증한다.
 *
 * 클라우드가 필요 없다: 픽스처 워커 모듈을 그대로 import 해서 127.0.0.1에 띄우고,
 * 검수기와 같은 계획(dist/signup-plan.js)으로 몰아본다.
 * 이메일 인증이 없는 F9로 ①~⑤를 먼저 확인한다 — 라우팅 연결 전에 나머지를 다듬는다.
 */
import { createServer } from "node:http";
import { chromium } from "playwright";
import fixture from "../simsa-inspection-fixtures/src/index.mjs";
import { planSignup } from "../../apps/central-plane/dist/signup-plan.js";

const server = createServer(async (req, res) => {
  const r = await fixture.fetch(new Request(`http://127.0.0.1${req.url}`));
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "text/html" });
  res.end(await r.text());
});
await new Promise((ok) => server.listen(8791, "127.0.0.1", ok));
const BASE = "http://127.0.0.1:8791";

const b = await chromium.launch();
const ctx = await b.newContext({ locale: "ko-KR" });
const page = await ctx.newPage();
const step = (n, ok, detail = "") => console.log(`  ${ok ? "✅" : "❌"} ${n}${detail ? " — " + detail : ""}`);

await page.goto(`${BASE}/login-app`, { waitUntil: "domcontentloaded" });

// ① 가입 화면 필드 수집 (검수기와 같은 방식)
const fields = await page.$$eval("input, textarea, select", (els) =>
  els.filter((e) => e.offsetParent !== null && e.type !== "hidden").map((e) => {
    const id = e.getAttribute("id"), name = e.getAttribute("name"), ph = e.getAttribute("placeholder") ?? "";
    const labelText = (id && document.querySelector(`label[for="${id}"]`)?.textContent) || e.closest("label")?.textContent || "";
    return {
      selectorHint: name ? `[name="${name}"]` : id ? `#${id}` : ph ? `[placeholder="${ph}"]` : "",
      type: e.getAttribute("type") ?? e.tagName.toLowerCase(),
      label: `${labelText} ${ph} ${name ?? ""}`.replace(/\s+/g, " ").trim(),
    };
  }).filter((f) => f.selectorHint));
const submits = await page.$$eval("button, input[type=submit]", (els) =>
  els.filter((e) => e.offsetParent !== null).map((e) => (e.innerText || e.value || "").trim()).filter(Boolean));
console.log("필드:", JSON.stringify(fields.map((f) => f.label || f.selectorHint)));
console.log("버튼:", JSON.stringify(submits));

const plan = planSignup({ runId: "wvc_local1", mailDomain: "probe.test", fields, submitTexts: submits, locale: "ko" });
step("① 가입 계획 수립", plan.ok, plan.ok ? `${plan.steps.length}단계, ${plan.email}` : plan.blocker);
if (!plan.ok) { await b.close(); server.close(); process.exit(1); }

// ②③ 채우고 제출
for (const s of plan.steps) {
  if (s.action === "fill") await page.locator(s.selectorHint).first().fill(s.value).catch((e) => console.log("   fill 실패", s.selectorHint, e.message.slice(0, 50)));
  if (s.action === "submit") { await page.getByText(s.targetText, { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(600); }
}
step("②③ 필드 채우고 제출", true);

// ④ 로그인 상태 판정 (검수기와 같은 휴리스틱)
const loggedIn = await page.evaluate(() => {
  const t = (document.body.innerText || "").toLowerCase();
  const hasLogout = /로그아웃|sign out|log out|logout/.test(t);
  const stillAsking = /로그인|sign in|log in/.test(t) && !hasLogout;
  return hasLogout || (!stillAsking && !/회원가입|sign up/.test(t));
});
step("④ 로그인 상태 판정", loggedIn, await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 60)));

// ⑤ 데이터 만들고 재로그인 후 남아 있는지 (왕복)
await page.locator("#memo").fill("검수 왕복 테스트");
await page.getByText("추가", { exact: true }).first().click();
await page.waitForTimeout(400);
const beforeCount = await page.evaluate(() => document.querySelectorAll("#list li").length);
await page.getByText("로그아웃", { exact: true }).first().click();
await page.waitForTimeout(400);
await page.locator("#email").fill(plan.email);
await page.locator("#pw").fill(plan.password);
await page.getByText("로그인", { exact: true }).first().click();
await page.waitForTimeout(600);
const afterCount = await page.evaluate(() => document.querySelectorAll("#list li").length);
step("⑤ 재로그인 왕복(진짜 저장 증명)", afterCount >= beforeCount && beforeCount > 0, `${beforeCount} → ${afterCount}`);

// ⑥ 계정별 격리 — 다른 계정으로 들어가면 남의 메모가 안 보여야 한다
await page.getByText("로그아웃", { exact: true }).first().click();
await page.waitForTimeout(300);
await page.locator("#email").fill("other@probe.test");
await page.locator("#pw").fill("Other!pass9A");
await page.getByText("회원가입", { exact: true }).first().click();
await page.waitForTimeout(500);
const otherCount = await page.evaluate(() => document.querySelectorAll("#list li").length);
step("⑥ 계정 격리", otherCount === 0, `다른 계정에서 보이는 메모 ${otherCount}개`);

// ⑦ 정리 — 탈퇴로 우리가 만든 계정을 지운다
await page.getByText("회원 탈퇴", { exact: true }).first().click();
await page.waitForTimeout(400);
const gone = await page.evaluate(() => !JSON.parse(localStorage.getItem("f9_users") || "{}")["other@probe.test"]);
step("⑦ 정리(탈퇴)", gone);

await b.close();
server.close();
