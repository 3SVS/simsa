/**
 * journey-audit.mjs — 신규 유저 시점 "갈래 완주" QA. (2026-07-20 신설, Bae:
 * "왜 이렇게 플로우에 허점이 많아 — 뭘 돌린 거야 QA")
 *
 * v2 (2026-07-21, Train J — 실행계획 2026-07-21): 1회성 관찰 스크립트에서
 * **오픈 게이트 표준 측정 장비**로 승격. 추가된 것:
 *   - 스텝별 결정론 채점: UX Basics 5 신호(출구·데드엔드·비활성 이유·오류 안내)
 *     + primary CTA 위계(화면당 1개 — uiux-redesign-instructions #5 기준)
 *   - EN 축: locale=en으로 동일 여정 재주행, 한글 누수(koLeak) 측정
 *   - P0/P1/P2 자동 분류(findings) — 최종 판정은 사람이 산출물을 읽고 내리되,
 *     기계가 후보를 빠뜨리지 않게 한다
 *   - J0 아이디어 갈래 입구(깊은 생성 플로우는 flow-audit.mjs 담당 — 중복 금지)
 *
 * 측정 원칙: 스크립트는 사실만 기록한다(카운트·존재 여부·스크린샷). "좋다/나쁘다"는
 * findings 규칙(결정론)과 사람의 판독으로 분리한다.
 *
 * Usage:
 *   node journey-audit.mjs            → KO+EN 전체 (기본)
 *   node journey-audit.mjs --ko-only  → KO만 (빠른 재감사)
 * 산출물: journey-audit-shots/*.png · journey-audit-result.json (steps+findings)
 * 배포 게이트 절차: ./JOURNEY-AUDIT.md
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://app.trysimsa.com";
const KO_ONLY = process.argv.includes("--ko-only");
const SHOTS = new URL("./journey-audit-shots", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const audit = { startedAt: new Date().toISOString(), version: 2, journeys: [], findings: [] };

async function newUserPage(locale = "ko") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // I18nProvider가 읽는 저장 키(dictionary.mjs LOCALE_STORAGE_KEY)를 앱 로드 전에
  // 심는다 — EN 축은 "EN 유저의 첫 여정"을 재현한다.
  await ctx.addInitScript((loc) => {
    try { window.localStorage.setItem("conclave:locale", loc); } catch {}
  }, locale);
  const page = await ctx.newPage();
  page._simsaLocale = locale;
  return page;
}

/**
 * 스텝 사실 수집 + 결정론 채점 신호. 모든 값은 측정이며 판정이 아니다.
 *  - primaryCtaCount: 화면의 primary 버튼 수 (#5 기준: 정확히 1이 이상적)
 *  - hasExit: 뒤로/← 링크·버튼 또는 사이드바 내비 존재 (UX Basics ①)
 *  - deadEnd: 전진 가능한 액션 요소가 0 (UX Basics ⑤)
 *  - disabledCount: 비활성 버튼 수 — 이유 표시는 스크린샷으로 사람이 확인 (③)
 *  - errorish/guidanceish: 오류·안내 카피 신호 (④)
 *  - koLeakChars: (EN 주행에서만 의미) 본문의 한글 문자 수 — EN 커버리지 누수
 */
async function facts(page, label, note = "") {
  const f = await page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    const buttons = texts("button, a.btn, [role=button]");
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    const primaries = [...document.querySelectorAll(".btn-primary, button[class*='primary']")].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    // main 본문 한정 primary — 사이드바/글로벌 셸 제외한 화면 자체의 위계.
    const mainPrimaries = [...document.querySelectorAll("main .btn-primary, main button[class*='primary']")].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    const exits = [...document.querySelectorAll("a, button")].filter(vis).filter((e) => /←|뒤로|돌아가|back/i.test((e.innerText || "").trim()));
    const sidebarNav = document.querySelector("nav, aside") !== null;
    const disabled = [...document.querySelectorAll("button[disabled], [aria-disabled='true']")].filter((e) => e.offsetParent !== null).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40));
    return {
      h1: texts("h1").slice(0, 2),
      buttons: buttons.slice(0, 24),
      primaryCta: primaries.slice(0, 6),
      primaryCtaCount: mainPrimaries.length || primaries.length,
      hasExit: exits.length > 0 || sidebarNav,
      deadEnd: buttons.length === 0,
      disabledCount: disabled.length,
      disabledLabels: disabled.slice(0, 5),
      bodyLen: body.length,
      errorish: (body.match(/문제가 발생|불러오지 못|오류가|실패했|다시 시도|something went wrong|failed to/gi) ?? []).length,
      guidanceish: (body.match(/연결해 주세요|연결하세요|먼저|필요해요|이렇게 하세요|설치|connect|first|install/gi) ?? []).length,
      koLeakChars: (body.match(/[가-힣]/g) ?? []).length,
      bodyHead: body.slice(0, 400),
    };
  });
  const row = { label, note, locale: page._simsaLocale ?? "ko", url: page.url(), ...f };
  audit.journeys.at(-1).steps.push(row);
  const shotName = `${audit.journeys.length}-${audit.journeys.at(-1).steps.length}-${(page._simsaLocale ?? "ko")}-${label.replace(/[^\w가-힣-]/g, "_").slice(0, 40)}.png`;
  await page.screenshot({ path: `${SHOTS}/${shotName}` }).catch(() => {});
  console.log(`  [${row.locale}|${label}] cta=${f.primaryCtaCount} exit=${f.hasExit} dis=${f.disabledCount} err=${f.errorish} ko=${f.koLeakChars}`);
  return row;
}

function journey(name, locale = "ko") {
  audit.journeys.push({ name, locale, steps: [], failure: null });
  console.log(`\n▶ [${locale}] ${name}`);
}

// ── 여정 정의 (KO/EN 공용 — locale은 컨텍스트가 결정) ─────────────────────────

async function runIdeaEntry(locale) {
  // J0 — 아이디어 갈래 입구만 (깊은 생성은 flow-audit.mjs 소관, 중복 금지).
  try {
    journey("J0 아이디어 갈래 입구: 첫 화면 → 스텝1 → 인터뷰 진입", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "갈래 선택 화면");
    await page.goto(`${BASE}/projects/new?path=idea`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "idea 스텝1 — 무엇을 묻는가");
    const ideaBox = page.locator("main textarea, textarea").first();
    if (await ideaBox.count()) {
      await ideaBox.fill(locale === "en" ? "A neighborhood bakery pickup-reservation app" : "동네 빵집 픽업 예약 앱");
      const next = page.locator("main .btn-primary, main button[class*='primary']").first();
      if (await next.count()) {
        await next.click().catch(() => {});
        await page.waitForTimeout(3000);
        await facts(page, "인터뷰 첫 질문 화면");
      }
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

async function runCodeJourney(locale) {
  try {
    journey("J1 기존-앱 갈래: 만든 앱 검수받기 완주", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "code 갈래 스텝1 — 무엇을 묻는가");
    // ★사이드바 검색 input이 first("input")에 걸린다 — 본문 필드는 placeholder로.
    const nameInput = page.locator("main input[type='text']").first();
    await nameInput.fill(locale === "en" ? "Bakery reservation test app" : "동네 빵집 예약 테스트앱");
    const descBox = page.locator("main textarea").first();
    if (await descBox.count()) await descBox.fill(locale === "en" ? "Reserve bread and pick a pickup time" : "빵을 예약하고 픽업 시간을 고르는 앱");
    await facts(page, "code 스텝1 입력 후");
    await page.locator("main .btn-primary, main button[class*='primary']").last().click();
    await page.waitForURL(/projects\/(?!new)/, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await facts(page, "생성 직후 랜딩 — 여기가 어디고 다음 행동이 보이는가");
    const pid = (page.url().match(/projects\/([^/?#]+)/) ?? [])[1];
    if (pid) {
      await page.goto(`${BASE}/projects/${pid}`, { waitUntil: "networkidle", timeout: 45000 });
      await facts(page, "개요 — 지금 할 일이 이 갈래에 맞는가");
      await page.goto(`${BASE}/projects/${pid}/checks`, { waitUntil: "networkidle", timeout: 45000 });
      await facts(page, "checks 첫 화면 — 모드 선택/소스 없이 안내");
      const runBtn = page.getByRole("button", { name: /검수|확인|run|check/i }).first();
      if (await runBtn.count()) {
        await runBtn.click().catch(() => {});
        await page.waitForTimeout(2500);
        await facts(page, "소스 없이 검수 시도 — 막힘 안내");
      }
    } else {
      audit.journeys.at(-1).failure = "프로젝트 생성 후 URL에서 id를 못 얻음";
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

async function runSpecJourney(locale) {
  try {
    journey("J2 기획서 갈래: 붙여넣기→변환→다음 행동", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=spec`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "spec 갈래 스텝1");
    await page.locator("main textarea, textarea").first().fill(
      locale === "en"
        ? "Product: dog-walk logger\nFeatures: start/stop walk logging, weekly distance stats, share a walk\nAudience: dog owners"
        : "제품: 반려견 산책 기록 앱\n기능: 산책 시작/종료 기록, 주간 거리 통계, 기록 공유\n대상: 반려견 보호자",
    );
    await page.locator("main .btn-primary, main button[class*='primary']").first().click();
    await page.waitForTimeout(1500);
    await facts(page, "변환 중/직후");
    for (let i = 0; i < 12; i++) {
      if (await page.getByRole("button", { name: /저장|프로젝트로|save|create project/i }).count()) break;
      await page.waitForTimeout(5000);
    }
    await facts(page, "변환 결과 화면");
    const saveBtn = page.getByRole("button", { name: /저장|프로젝트로|save|create project/i }).first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForURL(/projects\/(?!new)/, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await facts(page, "저장 후 랜딩 — 다음 행동");
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

async function runConnectJourney(locale) {
  try {
    journey("J3 repo 연결 여정: GitHub 미연결 신규 유저", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 45000 });
    await page.locator("main input[type='text']").first().fill(locale === "en" ? "Connect journey test" : "연결 여정 테스트");
    await page.locator("main .btn-primary, main button[class*='primary']").last().click();
    await page.waitForURL(/projects\/(?!new)/, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await facts(page, "settings/연결 화면 — 미연결 유저가 보는 것");
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

// ── 실행: KO 전체 + (기본) EN 축 ──────────────────────────────────────────────

await runIdeaEntry("ko");
await runCodeJourney("ko");
await runSpecJourney("ko");
await runConnectJourney("ko");

if (!KO_ONLY) {
  await runIdeaEntry("en");
  await runCodeJourney("en");
  // spec/connect의 EN은 code 여정이 셸·생성·랜딩을 이미 커버 — 입구만 본다.
  try {
    journey("J2e 기획서 갈래 입구(EN)", "en");
    const page = await newUserPage("en");
    await page.goto(`${BASE}/projects/new?path=spec`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "spec 갈래 스텝1 (EN)");
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

// ── P0/P1/P2 자동 분류 (결정론 — 후보를 빠뜨리지 않기 위한 기계 패스) ─────────
// 사람이 산출물(스크린샷 포함)을 읽고 최종 판정한다. 규칙:
//   P0: 여정 실패(예외/막힘) · happy path에서 오류 카피 노출
//   P1: 액션 스텝인데 primary 0 · 한 화면 primary ≥3(#5 위계 위반 후보)
//       · EN 주행에서 한글 누수 큼(>80자: 셸 잔재 이상의 본문 누수)
//   P2: 비활성 버튼 존재(이유 표시는 스크린샷 확인 필요) · 막힘 스텝인데 안내 신호 0
for (const j of audit.journeys) {
  if (j.failure) {
    audit.findings.push({ sev: "P0", journey: j.name, locale: j.locale, step: "(journey)", what: `여정 실패: ${j.failure}` });
  }
  for (const s of j.steps) {
    const isBlockedStep = /막힘|시도/.test(s.label);
    if (s.errorish > 0 && !isBlockedStep) {
      audit.findings.push({ sev: "P0", journey: j.name, locale: s.locale, step: s.label, what: `happy path 오류 카피 ${s.errorish}건 노출` });
    }
    // 갈래 선택(chooser)은 3개의 동등한 문 설계라 primary-0이 정상 — 기준선
    // 판독(2026-07-21)에서 거짓 양성으로 확정, 규칙 예외. (추천 배지는 D16이
    // 별도로 담당한다.)
    if (s.primaryCtaCount === 0 && !/입력 후|변환 중|갈래 선택/.test(s.label)) {
      audit.findings.push({ sev: "P1", journey: j.name, locale: s.locale, step: s.label, what: "primary CTA 0 — 다음 행동이 버튼으로 안 보임" });
    }
    if (s.primaryCtaCount >= 3) {
      audit.findings.push({ sev: "P1", journey: j.name, locale: s.locale, step: s.label, what: `primary CTA ${s.primaryCtaCount}개 — #5 위계 위반 후보` });
    }
    if (s.locale === "en" && s.koLeakChars > 80) {
      audit.findings.push({ sev: "P1", journey: j.name, locale: "en", step: s.label, what: `EN 주행 한글 누수 ${s.koLeakChars}자` });
    }
    if (s.disabledCount > 0) {
      audit.findings.push({ sev: "P2", journey: j.name, locale: s.locale, step: s.label, what: `비활성 버튼 ${s.disabledCount}개(${s.disabledLabels.join("/")}) — 이유 표시 스크린샷 확인` });
    }
    if (isBlockedStep && s.guidanceish === 0) {
      audit.findings.push({ sev: "P2", journey: j.name, locale: s.locale, step: s.label, what: "막힘 스텝인데 안내 카피 신호 0" });
    }
  }
}

writeFileSync(new URL("./journey-audit-result.json", import.meta.url), JSON.stringify(audit, null, 2));
const bySev = { P0: 0, P1: 0, P2: 0 };
for (const f of audit.findings) bySev[f.sev]++;
console.log(`\nfindings: P0=${bySev.P0} P1=${bySev.P1} P2=${bySev.P2}`);
console.log("saved: journey-audit-result.json / shots:", SHOTS);
await browser.close();
