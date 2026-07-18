/**
 * mobile-audit-probe.mjs — G13 모바일 감사 (docs/simsa-gap-backlog-2026-07-18.md).
 *
 * 375×812(iPhone류)로 프로덕션 주요 화면을 순회하며 수집:
 *  - 가로 넘침: document.scrollWidth > viewport (본문이 옆으로 스크롤되면 안 됨)
 *  - 넘침 유발 요소 상위 3개(디버그용 셀렉터 힌트)
 *  - 라벨 없는 입력(placeholder/aria-label/label 전부 없음)
 *  - 클릭 불가로 잘린 주요 버튼(뷰포트 밖 primary CTA)
 *
 * Run: node mobile-audit-probe.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://app.trysimsa.com";
const VIEWPORT = { width: 375, height: 812 };

const PAGES = [
  { name: "projects(빈 목록)", path: "/projects" },
  { name: "wizard", path: "/projects/new" },
  { name: "pricing", path: "/pricing" },
  { name: "legal/terms", path: "/legal/terms" },
];

async function auditPage(page, name, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const audit = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflowPx = Math.max(0, document.documentElement.scrollWidth - vw);
    const offenders = [];
    if (overflowPx > 2) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 2 && r.width > 40) {
          const cls = (el.className && typeof el.className === "string") ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
          offenders.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} (right=${Math.round(r.right)})`);
          if (offenders.length >= 3) break;
        }
      }
    }
    const unlabeled = [];
    for (const el of document.querySelectorAll("input, textarea, select")) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "checkbox", "radio"].includes(type)) continue;
      const hasLabel =
        el.getAttribute("placeholder") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        (el.id && document.querySelector(`label[for="${el.id}"]`));
      if (!hasLabel) unlabeled.push(el.getAttribute("name") || el.id || el.tagName.toLowerCase());
    }
    return { vw, overflowPx, offenders, unlabeled };
  });
  return { name, path, ...audit };
}

const browser = await chromium.launch();
const results = [];
try {
  const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  for (const p of PAGES) {
    results.push(await auditPage(page, p.name, p.path));
  }

  // 예시 프로젝트 흐름(채워진 화면들): try-sample 클릭 후 개요/검수/export.
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const tryBtn = page.getByRole("button", { name: /예시로 직접 만져보기|Try a hands-on sample/ });
  if ((await tryBtn.count()) > 0) {
    await tryBtn.first().click();
    await page.waitForURL(/\/projects\/sample_/, { timeout: 15000 });
    const pid = page.url().match(/projects\/(sample_[a-z0-9]+)/)?.[1];
    for (const sub of ["", "/checks", "/export", "/spec"]) {
      results.push(await auditPage(page, `sample${sub || "/overview"}`, `/projects/${pid}${sub}`));
    }
  } else {
    results.push({ name: "sample-flow", path: "-", vw: 0, overflowPx: -1, offenders: ["try-sample 버튼 없음"], unlabeled: [] });
  }
  await ctx.close();
} finally {
  await browser.close();
}

let issues = 0;
for (const r of results) {
  const over = r.overflowPx > 2;
  const unl = r.unlabeled.length > 0;
  if (over || unl) issues += 1;
  console.log(`${over || unl ? "ISSUE" : "OK   "} ${r.name} — overflow=${r.overflowPx}px${over ? ` [${r.offenders.join(" | ")}]` : ""}${unl ? ` unlabeled=[${r.unlabeled.join(",")}]` : ""}`);
}
console.log(`\n${results.length} pages audited, ${issues} with issues`);
