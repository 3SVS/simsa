// Quick live probe: the agent-chooser step (#356 D16) on a fresh code-branch project.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto("https://app.trysimsa.com/projects/new?path=code", { waitUntil: "networkidle", timeout: 45000 });
await p.waitForTimeout(1200);
await p.getByPlaceholder(/나의 첫 쇼핑몰/).fill("선택단계 확인용");
await p.getByRole("button", { name: "Claude Code", exact: true }).click();
const make = p.getByRole("button", { name: /만들고|만들기|시작|생성|다음|계속/ }).last();
if (await make.count()) await make.click();
await p.waitForURL(/proj_(?!mjx1)/, { timeout: 30000 }).catch(() => {});
const pid = p.url().match(/proj_[a-z0-9]+/)?.[0];
console.log("projId:", pid, p.url());
if (pid) {
  await p.goto(`https://app.trysimsa.com/projects/${pid}/export`, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "flow-audit-shots/31-export-chooser-live2.png" });
  const txt = await p.evaluate(() => document.body.innerText);
  console.log("선택 질문:", /어떤 개발 AI용으로 받으시겠어요/.test(txt) ? "✅" : "❌");
  console.log("웹 빌더 옵션:", /웹 빌더용/.test(txt) ? "✅" : "❌");
  console.log("자동 생성 억제:", /README\.md/.test(txt) ? "❌ 자동생성됨" : "✅");
} else {
  await p.screenshot({ path: "flow-audit-shots/31-code-branch-stuck.png" });
  console.log("프로젝트 생성 실패 — 스크린샷 확인");
}
await b.close();
