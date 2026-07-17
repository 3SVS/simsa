/**
 * flow-audit.mjs — 플랫폼 전체 플로우 E2E 감사 (2026-07-17, Bae 지시:
 * "탭별 이동 및 전체 프로세스 e2e의 효율성과 적합성을 다시 검토·평가").
 *
 * 아이디어 위저드를 실제로 완주(실 LLM)한 뒤, 프로젝트의 모든 탭/페이지를
 * 순회하며 수집: 페이지 제목, 주요 CTA, 빈 화면/에러/데드엔드 신호, 이동 경로.
 * 클릭 수(위저드 라운드 포함)도 센다. 산출: ./flow-audit-shots/*.png +
 * flow-audit-result.json. 평가(효율성·적합성 판정)는 사람이/에이전트가
 * 산출물을 읽고 내린다 — 이 스크립트는 측정만 한다.
 *
 * Usage: node flow-audit.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://app.trysimsa.com";
const SHOTS = new URL("./flow-audit-shots", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const audit = { startedAt: new Date().toISOString(), wizard: { rounds: 0, clicks: 0 }, tabs: [], notes: [] };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });

async function pageFacts(label) {
  const facts = await page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || "").trim()).filter(Boolean);
    return {
      h1: texts("h1").slice(0, 2),
      h2: texts("h2").slice(0, 6),
      buttons: texts("button").slice(0, 20),
      links: [...document.querySelectorAll("a[href]")].filter(vis).map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/")).slice(0, 40),
      bodyLen: (document.body.innerText || "").length,
      errorish: texts("body").join(" ").match(/문제가 발생|불러오지 못|오류가|다시 시도/g)?.length ?? 0,
    };
  });
  return { label, url: page.url(), ...facts };
}

try {
  // ── 1. 아이디어 위저드 완주 (anonymous-smoke와 동일 로직) ──
  await page.goto(`${BASE}/projects/new?path=idea`, { waitUntil: "networkidle", timeout: 45000 });
  // #344 added an extra-context textarea — the idea field is the first one.
  await page.locator("textarea").first().fill("동네 필라테스 강사가 회원별 수강권 남은 횟수를 관리하고 회원이 직접 조회하는 웹앱");
  await shot("00-idea");
  await page.getByRole("button", { name: /제품 설명서 만들기/ }).click();
  audit.wizard.clicks += 1;

  for (let round = 0; round < 12; round++) {
    if (/proj_(?!mjx1)/.test(page.url())) break;
    audit.wizard.rounds = round + 1;
    await shot(`01-wizard-r${round}`);
    const recCount = await page.getByRole("button", { name: /추천대로/ }).count();
    for (let i = 0; i < recCount; i++) {
      await page.getByRole("button", { name: /추천대로/ }).nth(i).click();
      audit.wizard.clicks += 1;
      await page.waitForTimeout(600);
    }
    const cc = page.getByRole("button", { name: "Claude Code", exact: true });
    if ((await cc.count()) > 0) { await cc.first().click(); audit.wizard.clicks += 1; await page.waitForTimeout(400); }
    for (const ta of await page.locator("textarea:visible").all()) {
      if (!(await ta.inputValue())) await ta.fill("간단하고 빠르게 쓰는 게 중요해요.");
    }
    const next = page.getByRole("button", { name: /맞습니다|질문에 답하기|완성|다음|계속|건너뛰|만들기|시작하기/ }).last();
    if ((await next.count()) > 0) { await next.click(); audit.wizard.clicks += 1; }
    await Promise.race([
      page.waitForURL(/\/projects\/proj_(?!mjx1)/, { timeout: 60000 }).catch(() => {}),
      page.waitForTimeout(15000),
    ]);
  }
  const projId = page.url().match(/proj_[a-z0-9]+/)?.[0];
  if (!projId) throw new Error("위저드 미완주: " + page.url());
  audit.projectId = projId;
  await page.waitForTimeout(2500);
  await shot("02-project-landing");
  audit.tabs.push(await pageFacts("project-landing(위저드 종착지)"));

  // ── 2. 사이드바/탭 전수 순회 ──
  const links = await page.evaluate((pid) => {
    return [...document.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.getAttribute("href"), text: (a.innerText || "").trim().replace(/\s+/g, " ") }))
      .filter((l) => l.href && l.href.includes(pid));
  }, projId);
  const uniq = [...new Map(links.map((l) => [l.href, l])).values()];
  audit.projectNav = uniq;

  let idx = 0;
  for (const l of uniq) {
    idx += 1;
    try {
      await page.goto(`${BASE}${l.href}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
      await shot(`10-tab-${String(idx).padStart(2, "0")}-${l.href.split("/").pop()}`);
      audit.tabs.push(await pageFacts(`${l.text || "(no label)"} — ${l.href}`));
    } catch (err) {
      audit.tabs.push({ label: l.text, url: l.href, error: String(err).slice(0, 150) });
    }
  }

  // ── 3. 홈/전체 네비 ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 30000 });
  await shot("20-home");
  audit.tabs.push(await pageFacts("home"));
} catch (err) {
  audit.notes.push("FATAL: " + String(err).slice(0, 300));
} finally {
  await browser.close();
}

const outPath = new URL("./flow-audit-result.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ projectId: audit.projectId, wizard: audit.wizard, navCount: audit.projectNav?.length, tabsVisited: audit.tabs.length, notes: audit.notes }, null, 2));
console.log("shots:", SHOTS);
