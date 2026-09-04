/** F2에서 planVisualFlow가 실제로 무슨 계획을 세우는지 로컬 재현. */
import { chromium } from "playwright";
import { planVisualFlow } from "../../apps/central-plane/dist/visual-flow-plan.js";

const URL = "https://simsa-inspection-fixtures.seunghunbae.workers.dev/noisy-working";
const b = await chromium.launch();
const p = await b.newPage();
const consoleErrors = [];
p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 120)));
await p.goto(URL, { waitUntil: "networkidle" });

const ctas = await p.$$eval("button, a, [role=button], input[type=submit]", (els) =>
  els.filter((e) => e.offsetParent !== null).map((e) => ({
    text: (e.innerText || e.value || "").trim().slice(0, 60),
    tag: e.tagName.toLowerCase(),
  })).filter((c) => c.text));
const inputs = await p.$$eval("input, textarea", (els) =>
  els.filter((e) => e.offsetParent !== null).map((i) => ({
    placeholder: i.placeholder || "", type: i.type || "text",
    selector: i.placeholder ? `[placeholder="${i.placeholder}"]` : "input",
  })));

console.log("CTA:", JSON.stringify(ctas));
console.log("입력칸:", JSON.stringify(inputs));

const plan = planVisualFlow({ intent: "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다", ctas, inputs });
console.log("계획:", JSON.stringify(plan, null, 1));

// 계획대로 실행하며 본문 변화를 관찰
const bodyText = () => p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
let before = await bodyText();
for (const step of plan) {
  if (step.action === "type") {
    const f = step.placeholder ? p.getByPlaceholder(step.placeholder).first() : p.locator("input").first();
    await f.fill(step.value, { timeout: 8000 }).catch((e) => console.log("  type 실패:", e.message.slice(0, 60)));
  } else if (step.action === "click") {
    await p.getByText(step.targetText, { exact: false }).first().click({ timeout: 8000 })
      .catch((e) => console.log("  click 실패:", e.message.slice(0, 80)));
  }
  await p.waitForTimeout(800);
  const now = await bodyText();
  console.log(`  [${step.action}] "${step.targetText ?? step.value ?? ""}" → 본문변화=${now !== before}`);
  before = now;
}
console.log("콘솔오류:", consoleErrors.length, JSON.stringify(consoleErrors));
console.log("최종 본문:", (await bodyText()).slice(0, 160));
await b.close();
