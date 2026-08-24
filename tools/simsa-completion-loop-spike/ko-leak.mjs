import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ locale: "en-US" });
const p = await ctx.newPage();
await p.addInitScript(() => localStorage.setItem("conclave:locale", "en"));
await p.goto("https://app.trysimsa.com/projects/new?path=code", { waitUntil: "networkidle", timeout: 60000 });
const leaks = await p.evaluate(() => {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) {
      const t = (n.textContent || "").trim();
      if (/[가-힣]/.test(t)) out.push({ text: t.slice(0, 60), where: n.parentElement?.className?.toString().slice(0, 50) ?? "" });
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(document.body);
  return out;
});
console.log(JSON.stringify(leaks, null, 2));
await b.close();
