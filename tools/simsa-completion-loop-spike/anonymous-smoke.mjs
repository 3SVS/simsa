// Anonymous-flow live smoke against production (app.trysimsa.com).
// Run from this directory: `node anonymous-smoke.mjs`
//
// Covers (no login required):
//   - idea wizard end-to-end incl. REAL LLM roundtrip (이해→질문→built_with→생성)
//   - #327 sidebar shows the new project without reload
//   - #328 idea-branch projects hide the GitHub tab
//   - delete QA ⓐⓑ (modal ack-gate, real delete, survives reload) + example
//     card has no trash button
//   - EN-toggle screenshot for hardcoded-Korean leak review
//
// First landed 2026-07-15 (loop-recovery session) — this run found the
// stale-sidebar-after-delete bug fixed in #331. Screenshots go to ./smoke-shots.
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const SHOTS = new URL("./smoke-shots", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pass = (name, detail = "") => { results.push({ name, ok: true, detail }); console.log(`✅ ${name} ${detail}`); };
const fail = (name, detail = "") => { results.push({ name, ok: false, detail }); console.log(`❌ ${name} ${detail}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

try {
  // ── 1. Create an idea-branch project (real LLM roundtrip) ──────────────
  await page.goto("https://app.trysimsa.com/projects/new?path=idea", { waitUntil: "networkidle", timeout: 45000 });
  const IDEA = "출장 경비 영수증을 사진으로 올리면 자동으로 분류하고 정산서를 만들어주는 앱";
  await page.locator("textarea").fill(IDEA);
  await shot("10-idea-filled");
  await page.getByRole("button", { name: /제품 설명서 만들기/ }).click();

  // 4-step wizard (아이디어→이해→질문→완성), each step may run the LLM.
  // Walk it generically: fill empty textareas, click the primary "next"
  // button, until the URL lands on the created project.
  for (let round = 0; round < 12; round++) {
    if (/proj_(?!mjx1)/.test(page.url())) break;
    const btns = await page.$$eval("button", (els) =>
      els.filter((e) => e.offsetParent !== null).map((e) => (e.textContent ?? "").trim()).filter(Boolean));
    console.log(`[wizard round ${round}] buttons: ${JSON.stringify(btns.slice(0, 14))}`);
    await shot(`10-wizard-r${round}`);

    // Question step: answer EVERY question with the recommended default.
    // NB: the button stays visible after answering — click each ONCE by index.
    const recCount = await page.getByRole("button", { name: /추천대로/ }).count();
    for (let i = 0; i < recCount; i++) {
      await page.getByRole("button", { name: /추천대로/ }).nth(i).click();
      await page.waitForTimeout(700);
    }
    // built_with picker: choose Claude Code before the final start button
    const cc = page.getByRole("button", { name: "Claude Code", exact: true });
    if ((await cc.count()) > 0) { await cc.first().click(); await page.waitForTimeout(500); }
    for (const ta of await page.locator("textarea:visible").all()) {
      if (!(await ta.inputValue())) await ta.fill("빠르고 간단하게 쓰는 게 가장 중요해요.");
    }
    const next = page.getByRole("button", { name: /맞습니다|질문에 답하기|완성|다음|계속|건너뛰|만들기|시작하기/ }).last();
    if ((await next.count()) > 0) await next.click();

    // Wait for either the project URL or new content (LLM steps are slow).
    await Promise.race([
      page.waitForURL(/\/projects\/proj_(?!mjx1)/, { timeout: 60000 }).catch(() => {}),
      page.waitForTimeout(15000),
    ]);
  }
  if (!/proj_(?!mjx1)/.test(page.url())) throw new Error("위저드가 프로젝트 생성에 도달하지 못함: " + page.url());
  const projUrl = page.url();
  const projId = projUrl.match(/proj_[a-z0-9]+/)?.[0];
  await page.waitForTimeout(2500);
  await shot("11-project-created");
  pass("idea→project 생성 (실 LLM 경유)", `${projId}`);

  // ── 2. #327: sidebar shows the new project WITHOUT a full reload ───────
  const sidebarHasIt = await page.locator(`a[href*="${projId}"]`).count();
  if (sidebarHasIt > 0) pass("#327 사이드바에 새 프로젝트 즉시 표시", `links=${sidebarHasIt}`);
  else fail("#327 사이드바에 새 프로젝트 즉시 표시", "링크 0개");

  // ── 3. #328: idea project must NOT offer the GitHub / 코드 변경 tab ────
  const ghTab = await page.locator(`a[href*="${projId}/github"]`).count();
  const bodyText = await page.locator("body").innerText();
  if (ghTab === 0) pass("#328 아이디어 프로젝트에 GitHub 탭 없음");
  else fail("#328 아이디어 프로젝트에 GitHub 탭 없음", `github links=${ghTab}`);
  await shot("12-project-nav");

  // ── 4. EN toggle leak check (T1/T5 partial, visual evidence) ───────────
  const enBtn = page.getByRole("button", { name: "EN", exact: true });
  if (await enBtn.count()) {
    await enBtn.first().click();
    await page.waitForTimeout(1500);
    await shot("13-en-locale");
    pass("EN 토글 스크린샷 확보 (육안 확인용)", "13-en-locale.png");
    const koBtn = page.getByRole("button", { name: "KO", exact: true });
    if (await koBtn.count()) { await koBtn.first().click(); await page.waitForTimeout(1000); }
  }

  // ── 5. Delete QA ⓐ: modal guard — button disabled until acknowledged ──
  await page.goto("https://app.trysimsa.com/projects", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);

  // Example card must NOT have a trash button
  const exampleTrash = await page.locator('a[href*="proj_mjx1"] ~ button[aria-label*="삭제"], div:has(> a[href*="proj_mjx1"]) > button[aria-label*="삭제"]').count();
  if (exampleTrash === 0) pass("예시 카드에는 삭제 버튼 없음");
  else fail("예시 카드에는 삭제 버튼 없음", `trash=${exampleTrash}`);

  const trash = page.locator('button[aria-label*="삭제"]').first();
  if ((await trash.count()) === 0) throw new Error("새 프로젝트 카드의 삭제 버튼을 찾지 못함");
  await trash.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await shot("14-delete-modal");

  const confirmBtn = page.getByRole("button", { name: "영구 삭제" });
  const disabledBefore = await confirmBtn.isDisabled();
  if (disabledBefore) pass("삭제 QA ⓐ 체크 전 '영구 삭제' disabled");
  else fail("삭제 QA ⓐ 체크 전 '영구 삭제' disabled", "enabled 상태");

  await page.locator('[role="dialog"] input[type="checkbox"]').check();
  const disabledAfter = await confirmBtn.isDisabled();
  if (!disabledAfter) pass("삭제 QA ⓐ 체크 후 '영구 삭제' enabled");
  else fail("삭제 QA ⓐ 체크 후 '영구 삭제' enabled", "여전히 disabled");
  await shot("15-delete-acknowledged");

  // ── 6. Delete QA ⓑ: really deletes, and stays deleted after reload ────
  await confirmBtn.click();
  await page.waitForTimeout(3000);
  const goneNow = (await page.locator(`a[href*="${projId}"]`).count()) === 0;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const goneAfterReload = (await page.locator(`a[href*="${projId}"]`).count()) === 0;
  await shot("16-after-delete-reload");
  if (goneNow && goneAfterReload) pass("삭제 QA ⓑ 삭제 후 목록에서 제거 + 새로고침 후에도 미복귀");
  else fail("삭제 QA ⓑ 삭제 후 목록에서 제거 + 새로고침 후에도 미복귀", `now=${goneNow} reload=${goneAfterReload}`);
} catch (err) {
  fail("스모크 실행", String(err).slice(0, 300));
  await shot("99-error");
}

await browser.close();
console.log("\n===== SUMMARY =====");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
