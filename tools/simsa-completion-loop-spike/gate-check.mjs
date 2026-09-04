/** 새 관문(모음이 자랐는가)이 F2(정상)와 F6(진짜 결함)을 가르는지 로컬 검증. */
import { chromium } from "playwright";
import { planVisualFlow } from "../../apps/central-plane/dist/visual-flow-plan.js";
const F = "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
const b = await chromium.launch();

for (const [id, path, intent, expect] of [
  ["F2 변환기(정상)", "/noisy-working", "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다", "관문 통과 안 함"],
  ["F6 기록장(결함)", "/optimistic-ghost", "기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다", "관문 통과 + 저장 안 됨"],
  ["F1 할일앱(정상,저장함)", "/working-todo", "할 일을 입력하고 추가 버튼을 누르면 목록에 나타나야 한다", "관문 통과 + 저장됨"],
]) {
  const p = await b.newPage();
  await p.goto(F + path, { waitUntil: "networkidle" });
  const count = () => p.evaluate(() => document.querySelectorAll("li, tbody tr, [role='listitem']").length);
  const ctas = await p.$$eval("button, a, [role=button], input[type=submit]", (els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => ({ text: (e.innerText || e.value || "").trim().slice(0, 60), tag: e.tagName.toLowerCase() })).filter((c) => c.text));
  const inputs = await p.$$eval("input, textarea", (els) =>
    els.filter((e) => e.offsetParent !== null).map((i) => ({ placeholder: i.placeholder || "", type: i.type || "text", selector: i.placeholder ? `[placeholder="${i.placeholder}"]` : "input" })));
  const plan = planVisualFlow({ intent, ctas, inputs });
  const before = await count();
  let typed = null;
  for (const s of plan) {
    if (s.action === "type") { typed = s.value; await (s.placeholder ? p.getByPlaceholder(s.placeholder).first() : p.locator("input").first()).fill(s.value).catch(() => {}); }
    else if (s.action === "click") await p.getByText(s.targetText, { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
  }
  const after = await count();
  const grew = after > before;
  let persisted = null;
  if (grew) {
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(1200);
    const rc = await count();
    const body = await p.evaluate(() => document.body.innerText);
    persisted = rc > before || (typed && body.includes(typed));
  }
  console.log(`${id}\n  항목 ${before}→${after} · 관문통과=${grew} · 지속성=${persisted === null ? "측정안함(null)" : persisted}\n  기대: ${expect}`);
  await p.close();
}
await b.close();
