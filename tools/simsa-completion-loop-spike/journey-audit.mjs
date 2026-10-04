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
 * C-J1 (Train C, 2026-09-30): 판정 규칙을 lib의 순수 함수로 옮겼다(브라우저 없이
 * 시험 가능 — J1이 P2로만 남던 공백이 아무 테스트에도 안 걸렸던 이유).
 *   - 초보자 기준: lib/beginner-terms.mjs `beginnerFindings` — J0·J1·J2·J6·J7 P0
 *     (기존 앱 문에서만 GitHub = 선택 단계로 허용 → P2, D-17 amend)
 *   - 화면 구조: lib/journey-checks.mjs `stepStructure`·`structureFindings` —
 *     막다른 길 P0(2026-09-28 Bae 신고: PR 0개 화면에서 여정 정지) · 같은 라벨·다른
 *     목적지 P1
 *
 * Usage:
 *   node journey-audit.mjs            → KO+EN 전체 (기본)
 *   node journey-audit.mjs --ko-only  → KO만 (빠른 재감사)
 *   node journey-audit.mjs --local http://localhost:3002 [--ko-only]
 *       → **로컬 가짜 서버 모드**(B-8 J6): 로컬 next build+start 위에서 central-plane 응답을
 *         Playwright route로 가짜 주입(lib/fake-central.mjs). J6(만들기)만 돈다 — [만들기]는 실제
 *         빌드를 시작하므로 **라이브에서는 절대 돌리지 않는다.** 라이브 여정(J0~J5·J7)은 이 모드에서 돌지 않는다.
 * 산출물: journey-audit-shots/*.png · journey-audit-result.json (steps+findings)
 *         (--local: journey-audit-shots/local/*.png · journey-audit-local-result.json)
 * 배포 게이트 절차: ./JOURNEY-AUDIT.md
 */
import { chromium } from "playwright";
import { devTermHits, accountCtaLabels, beginnerFindings, firstVisitLocaleMismatch } from "./lib/beginner-terms.mjs";
import { createFakeCentral, fakeCorsHeaders } from "./lib/fake-central.mjs";
import { stepStructure, structureFindings } from "./lib/journey-checks.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { seedStaffKey } from "./lib/staff-key.mjs";

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
/** --local <base>: 로컬 가짜 서버 모드. 없으면 종전 그대로 라이브 BASE. */
const LOCAL_BASE = argValue("--local");
if (LOCAL_BASE !== null && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(LOCAL_BASE)) {
  // 가짜 주입 모드를 라이브 주소에 겨누는 실수를 막는다 — 로컬 주소만 받는다.
  throw new Error(`--local accepts only http://localhost[:port] — got ${LOCAL_BASE}`);
}
// 우선순위: --local(가짜 서버) > SIMSA_APP_BASE(PR 빌드 등, 2026-10-04 #587) > 라이브.
const BASE = LOCAL_BASE
  ? LOCAL_BASE.replace(/\/+$/, "")
  : (process.env.SIMSA_APP_BASE || "https://app.trysimsa.com").replace(/\/$/, "");
const KO_ONLY = process.argv.includes("--ko-only");

/**
 * AF 트레인 이후 코드 갈래가 받는 것은 **주소 또는 저장소** 하나다.
 * 리얼 데이터로 잰다(Rule 6): 실제로 살아 있는 주소와 실제 공개 저장소.
 */
const CODE_SUBMISSION = {
  website: "https://app.trysimsa.com/",
  repo: "https://github.com/3SVS/simsa",
};
const SHOTS = new URL(LOCAL_BASE ? "./journey-audit-shots/local" : "./journey-audit-shots", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const audit = { startedAt: new Date().toISOString(), version: 2, mode: LOCAL_BASE ? `local-fake:${BASE}` : "live", journeys: [], findings: [], fakeUnhandled: [] };

async function newUserPage(locale = "ko") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // I18nProvider가 읽는 저장 키(dictionary.mjs LOCALE_STORAGE_KEY)를 앱 로드 전에
  // 심는다 — EN 축은 "EN 유저의 첫 여정"을 재현한다.
  await ctx.addInitScript((loc) => {
    try { window.localStorage.setItem("conclave:locale", loc); } catch {}
  }, locale);
  await seedStaffKey(ctx); // D-24.2 — 장비 키(설정 시)
  const page = await ctx.newPage();
  page._simsaLocale = locale;
  return page;
}

/**
 * 스텝 사실 수집 + 결정론 채점 신호. 모든 값은 측정이며 판정이 아니다.
 *  - primaryCtaCount: 화면의 primary 버튼 수 (#5 기준: 정확히 1이 이상적)
 *  - hasExit: 뒤로/← 링크·버튼 또는 사이드바 내비 존재 (UX Basics ①)
 *  - deadEnd/deadEndKind/structure: main 안에 앞으로 가는 것이 0개, 또는 빈 상태만
 *    있고 주 버튼이 없음 (UX Basics ⑤, C-J1 — lib/journey-checks.mjs)
 *  - disabledCount: 비활성 버튼 수 — 이유 표시는 스크린샷으로 사람이 확인 (③)
 *  - errorish/guidanceish: 오류·안내 카피 신호 (④)
 *  - koLeakChars: (EN 주행에서만 의미) 본문의 한글 문자 수 — EN 커버리지 누수
 */
/**
 * settleForNextAction — "다음 행동이 버튼으로 보이는가"를 재기 **전에** 화면이
 * 정착하기를 기다린다 (2026-09-01).
 *
 * ## 왜
 *
 * 지휘 센터는 사실이 **하나라도 미확인이면 CTA를 내지 않는다** — 틀린 CTA가
 * fetch 해소 뒤에 뒤집히는 것보다 없는 게 낫다는 의도된 설계다
 * (`nextProjectAction`: 확정된 사실만 CTA를 만든다).
 *
 * 그런데 저장 직후 2초 스냅샷은 그 **로딩 창**을 찍고 "primary CTA 0 — 다음
 * 행동이 안 보임"으로 P1을 냈다. 실제로는 사실이 도착하면 CTA가 나온다
 * (실측: hasRepo/hasDeployUrl 확정 → get_pack).
 *
 * 로딩을 결함으로 세면 가짜 P1이 계속 쌓이고, 그러면 이 감사 자체를 안 믿게 된다.
 * 반대로 라벨 예외를 늘리면 **진짜 결함까지 숨는다.** 그래서 둘 다 하지 않고,
 * 정착을 기다린 뒤에 잰다 — 기다리고도 0이면 그건 진짜 결함이다.
 */
async function settleForNextAction(page, ms = 8000) {
  await page
    .waitForFunction(
      () => !!document.querySelector("main .btn-primary, main button[class*='primary']"),
      { timeout: ms },
    )
    .catch(() => {}); // 끝내 안 나오면 그대로 잰다 — 그때는 진짜 0이다.
}

/** Raw page facts (browser side). Internal `_` fields are consumed in Node and dropped. */
function collectFacts(page) {
  return page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    const buttons = texts("button, a.btn, [role=button]");
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    const primaries = [...document.querySelectorAll(".btn-primary, button[class*='primary']")].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    // main 본문 한정 primary — 사이드바/글로벌 셸 제외한 화면 자체의 위계.
    const mainPrimaries = [...document.querySelectorAll("main .btn-primary, main button[class*='primary']")].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    const exits = [...document.querySelectorAll("a, button")].filter(vis).filter((e) => /←|뒤로|돌아가|back/i.test((e.innerText || "").trim()));
    const sidebarNav = document.querySelector("nav, aside") !== null;
    // 로딩 중 버튼(aria-busy)은 '이유 없는 비활성'이 아니다 — 지금 일하는 중이라는 표시다(2026-10-04 P2 정리).
    const disabled = [...document.querySelectorAll("button[disabled], [aria-disabled='true']")].filter((e) => e.offsetParent !== null && e.getAttribute("aria-busy") !== "true").map((e) => (e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40));
    // C-J1 — raw material for the structure checks (rules live in lib/journey-checks.mjs).
    // <main> of the root layout wraps the page AND the "다음 한 걸음" bar, but not the sidebar:
    // the sidebar is always there, so counting it made the old deadEnd never true.
    const mainEl = document.querySelector("main");
    const label = (e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const isExternal = (e) => {
      if (e.tagName !== "A") return false;
      try {
        const u = new URL(e.href, location.href);
        return (u.protocol === "http:" || u.protocol === "https:") && u.origin !== location.origin;
      } catch {
        return true;
      }
    };
    const mainActions = mainEl
      ? [...mainEl.querySelectorAll("a[href], button, [role=button]")].filter(vis).slice(0, 120).map((e) => ({
          text: label(e),
          href: e.tagName === "A" ? (e.getAttribute("href") === "#" ? "#" : e.href) : null,
          external: isExternal(e),
          disabled: e.disabled === true || e.getAttribute("aria-disabled") === "true",
          primary: e.matches(".btn-primary, button[class*='primary']"),
        }))
      : [];
    const hasEditable = mainEl
      ? [...mainEl.querySelectorAll("input:not([type=hidden]), textarea, select")].some((e) => vis(e) && !e.disabled && !e.readOnly)
      : false;
    const links = [...document.querySelectorAll("a[href]")].filter(vis).slice(0, 300).map((e) => ({ text: label(e), href: e.href }));
    return {
      h1: texts("h1").slice(0, 2),
      buttons: buttons.slice(0, 24),
      primaryCta: primaries.slice(0, 6),
      primaryCtaCount: mainPrimaries.length || primaries.length,
      hasExit: exits.length > 0 || sidebarNav,
      disabledCount: disabled.length,
      disabledLabels: disabled.slice(0, 5),
      bodyLen: body.length,
      errorish: (body.match(/문제가 발생|불러오지 못|오류가|실패했|다시 시도|something went wrong|failed to/gi) ?? []).length,
      // ★개수만 남기면 "무슨 문구인지"를 못 본다 — 읽히지 않는 계측은 없는 계측이다
      //  (2026-09-01: P0 1건의 정체를 소스에서 역추적해야 했다). 앞뒤를 같이 남긴다.
      errorishHits: (body.match(/.{0,60}(문제가 발생|불러오지 못|오류가|실패했|다시 시도|something went wrong|failed to).{0,60}/gi) ?? []).slice(0, 5),
      guidanceish: (body.match(/연결해 주세요|연결하세요|먼저|필요해요|이렇게 하세요|설치|connect|first|install/gi) ?? []).length,
      koLeakChars: (body.match(/[가-힣]/g) ?? []).length,
      bodyHead: body.slice(0, 400),
      // Train N6 — raw material for the beginner-standard checks (matched in
      // Node so the rule lives in one tested place, lib/beginner-terms.mjs).
      // Page content vs the shared shell (sidebar/header/footer) — split so a
      // finding says WHERE the word is; the shell repeats on every screen.
      _mainText: (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").slice(0, 30000),
      _shellText: [...document.querySelectorAll("aside, nav, header, footer")].filter(vis).map((e) => (e.innerText || "")).join(" ").replace(/\s+/g, " ").slice(0, 30000),
      _actionTexts: texts("a, button, [role=button]").slice(0, 200),
      _mainActions: mainActions,
      _hasEditable: hasEditable,
      _links: links,
    };
  });
}

function structureOf(f) {
  return stepStructure({ mainActions: f._mainActions, mainText: f._mainText, hasEditableField: f._hasEditable, links: f._links });
}

async function facts(page, label, note = "") {
  let f = await collectFacts(page);
  let structure = structureOf(f);
  if (structure.deadEnd.deadEnd) {
    // 막다른 길로 세기 전에 한 번 더 본다 — 로딩 창을 결함으로 세지 않는다
    // (settleForNextAction과 같은 원칙: 기다리고도 0이면 그건 진짜 결함이다).
    await page.waitForTimeout(4000);
    f = await collectFacts(page);
    structure = structureOf(f);
  }
  // Beginner standard (D-17 / §8): which developer words and which external-
  // account buttons this screen shows — with the text, never just a count.
  const devTerms = [
    ...devTermHits(f._mainText).map((h) => ({ ...h, where: "본문" })),
    ...devTermHits(f._shellText).map((h) => ({ ...h, where: "셸" })),
  ];
  const accountCtas = accountCtaLabels(f._actionTexts);
  delete f._mainText;
  delete f._shellText;
  delete f._actionTexts;
  delete f._mainActions;
  delete f._hasEditable;
  delete f._links;
  const row = {
    label,
    note,
    locale: page._simsaLocale ?? "ko",
    url: page.url(),
    ...f,
    deadEnd: structure.deadEnd.deadEnd,
    deadEndKind: structure.deadEnd.kind,
    structure,
    devTerms,
    accountCtas,
  };
  audit.journeys.at(-1).steps.push(row);
  const shotName = `${audit.journeys.length}-${audit.journeys.at(-1).steps.length}-${(page._simsaLocale ?? "ko")}-${label.replace(/[^\w가-힣-]/g, "_").slice(0, 40)}.png`;
  await page.screenshot({ path: `${SHOTS}/${shotName}` }).catch(() => {});
  console.log(`  [${row.locale}|${label}] cta=${f.primaryCtaCount} exit=${f.hasExit} dis=${f.disabledCount} err=${f.errorish} ko=${f.koLeakChars} dev=${devTerms.length} acct=${accountCtas.length} dead=${structure.deadEnd.kind ?? "-"} same=${structure.sameLabel.length}`);
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
    journey("J1 기존-앱 갈래: 주소 하나로 검수까지 완주 (AF 트레인)", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "code 갈래 스텝1 — 무엇을 묻는가");

    // ★AF-1 이후 이 화면은 **칸 하나**다(종전: 이름+빌더칩+호스팅+데이터+설명+필수동작).
    // 옛 스크립트는 이름 칸에 "동네 빵집 예약 테스트앱"을 넣었는데, 그건 주소가
    // 아니므로 이제 거절된다 — 측정 장비부터 새 여정에 맞춰야 한다.
    const submitField = page.locator("main input[type='text']").first();
    await submitField.fill(CODE_SUBMISSION.website);
    await page.waitForTimeout(400);
    await facts(page, "주소 입력 후 — 무엇으로 읽었는지 보이는가");

    await page.locator("main .btn-primary, main button[class*='primary']").last().click();
    // AF-2: 제출 즉시 1차 검수가 걸리므로 생성이 종전보다 오래 걸릴 수 있다.
    await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await facts(page, "생성 직후 랜딩 — 검수가 돌고 확인 카드가 보이는가");

    const pid = (page.url().match(/projects\/([^/?#]+)/) ?? [])[1];
    if (pid) {
      // AF-3/AF-4: 의도 추론은 LLM을 타므로 시간이 걸린다. 카드가 자리를 잡을 때까지.
      await page.waitForTimeout(20000);
      await facts(page, "AF-4 의도 확인 카드 — 초안이 왔는가 / 정직하게 비었는가");
      await page.goto(`${BASE}/projects/${pid}`, { waitUntil: "networkidle", timeout: 45000 });
      await facts(page, "개요 — 지금 할 일이 이 갈래에 맞는가");
      await page.goto(`${BASE}/projects/${pid}/visual-checks`, { waitUntil: "networkidle", timeout: 45000 });
      await facts(page, "AF-5 검수 화면 — 깊이와 '못 본 것'이 표기되는가");
    } else {
      audit.journeys.at(-1).failure = "프로젝트 생성 후 URL에서 id를 못 얻음";
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

/**
 * J1b — 저장소만 넣은 경우. AF-1에서 새로 판 `need_url` 문이 실제로 뜨는지 본다.
 * 종전엔 이 상태에서 "첫 검수 돌려보기"로 보냈다가 **비활성 버튼**을 만나게 했다.
 */
async function runRepoOnlyJourney(locale) {
  try {
    journey("J1b 저장소만 연결: 막다른 골목이 없는가 (need_url)", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 45000 });
    await page.locator("main input[type='text']").first().fill(CODE_SUBMISSION.repo);
    await page.waitForTimeout(400);
    await facts(page, "저장소 주소 입력 후 — 저장소로 읽었는가");
    await page.locator("main .btn-primary, main button[class*='primary']").last().click();
    await page.waitForURL(/projects\/(?!new)/, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await facts(page, "★저장소만 있을 때 개요 — 비활성 버튼으로 보내지 않는가");
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

/**
 * J1c (C-N7, 2026-09-30) — 세 번째 문 "만들었는데 생각과 달라요"의 입구. 기존 앱
 * 갈래로 들어가되(?door=differs) 첫 화면이 그 문의 말로 묻는지 본다. 프로젝트는
 * 만들지 않는다 — 제출 이후는 J1과 같은 길이다(의도 확인 카드만 문구가 다르다).
 */
async function runDiffersDoorEntry(locale) {
  try {
    journey("J1c 생각과 달라요 문 입구: 갈래 선택 → 기존 앱 첫 화면", locale);
    const page = await newUserPage(locale);
    await page.goto(`${BASE}/projects/new?path=code&door=differs`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "differs 문 스텝1 — 무엇을 묻는가");
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
      await settleForNextAction(page);
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

// ── J5: 시드 세션 축 — 로그인-후/결과 표면 (기준평가 6, 2026-07-21) ──────────
// 익명 감사의 구조적 사각(런 상세·결과 루프)을 userKey+프로젝트 스텁 주입으로
// 뚫는다(m1b 실증 기법의 제도화). 시드는 QA 픽스처 트리플이 기본 — 환경변수로
// 교체 가능. 채점: "왜 이 판정" 발견성 + evidence 로드 + 점수 누수.
const SEED = {
  userKey: process.env.SIMSA_SEED_USERKEY ?? "uk_mqru04hf3qv61",
  projectId: process.env.SIMSA_SEED_PROJECT ?? "wsp_rwwupkcox7",
  runId: process.env.SIMSA_SEED_RUN ?? "wvc_rwwvk5fhdw",
};

async function runSeededResultJourney(locale) {
  try {
    journey("J5 시드 세션: 런 상세 → 왜 이 판정 → 증거 로드", locale);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
    await ctx.addInitScript((seed) => {
      try {
        localStorage.setItem("conclave_user_key", seed.userKey);
        localStorage.setItem("conclave:locale", seed.locale);
        localStorage.setItem("conclave_wf_projects:anon", JSON.stringify([{
          id: seed.projectId, name: "QA seed", description: "seed",
          createdAt: "2026-07-19",
          spec: { completeness: 0, goal: "", included: [], excluded: [], openDecisions: [] },
          requirements: [],
        }]));
      } catch {}
    }, { ...SEED, locale });
    const page = await ctx.newPage();
    page._simsaLocale = locale;
    await page.goto(`${BASE}/projects/${SEED.projectId}/visual-checks/${SEED.runId}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    await facts(page, "런 상세 — 리포트 렌더");
    const evSummary = page.locator("summary", { hasText: locale === "en" ? "Why this verdict" : "왜 이 판정" }).first();
    if (await evSummary.count()) {
      await evSummary.scrollIntoViewIfNeeded();
      await evSummary.click();
      await page.waitForTimeout(4000);
      const row = await facts(page, "왜 이 판정 — 펼침 후 증거 로드");
      const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      if (/\d{1,3}\s*\/\s*100/.test(body)) {
        audit.findings.push({ sev: "P0", journey: "J5", locale, step: row.label, what: "증거 체인에 숫자 점수 누수" });
      }
      if (!/(확인 항목 ↔ 관찰|Acceptance items)/.test(body)) {
        audit.findings.push({ sev: "P1", journey: "J5", locale, step: row.label, what: "펼침 후 증거 체인 미로드" });
      }
    } else {
      audit.findings.push({ sev: "P1", journey: "J5", locale, step: "런 상세", what: '"왜 이 판정" 섹션 미발견 (발견성/배포 회귀)' });
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

/**
 * J7 (Train N6, §8-12) — 첫 방문 locale. 저장된 선호 없이 브라우저 locale만으로
 * 들어온 사용자가 자기 언어를 보는가. 한국 초보자의 첫 화면이 영어면 이탈이다.
 * newUserPage()는 locale을 심어 두므로 여기서는 쓰지 않는다.
 */
async function runFirstVisitLocale(browserLocale) {
  const tag = browserLocale === "ko-KR" ? "ko" : "en";
  try {
    journey("J7 첫 방문 locale — 저장된 선호 없이 브라우저 언어만으로", tag);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: browserLocale });
    await seedStaffKey(ctx); // D-24.2 — 장비 키(설정 시)
    const page = await ctx.newPage();
    page._simsaLocale = tag;
    await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle", timeout: 45000 });
    const row = await facts(page, `첫 방문(${browserLocale}) — 갈래 선택 화면 언어`);
    const check = firstVisitLocaleMismatch(browserLocale, row.h1);
    if (check.mismatch) {
      audit.findings.push({ sev: "P0", journey: "J7", locale: tag, step: row.label, what: `첫 방문 locale 분열 — ${check.reason}` });
    }
    await ctx.close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
}

// ── J6 (B-8): 만들기 — 아이디어 → 지시서 → 만들기 → 진행 화면 (로컬 가짜 서버 전용) ─────────
// [만들기]는 실제 빌드를 시작한다(호스팅 D1·컨테이너·LLM 비용). 그래서 라이브에서는 돌지 않고,
// `--local`에서 central-plane 응답을 가짜로 주입해서만 돈다(lib/fake-central.mjs).
// 기대 문구는 대시보드 사전에서 직접 읽는다 — 카피가 바뀌어도 장비가 옛 문장을 찾지 않게.
// Rule 6: 프로젝트 "(주)트루픽셀 예약 앱", 한국어 기획(지시서 픽스처).
const J6_PROJECT = { id: "wsp_tp7x9k2m1q", ko: "(주)트루픽셀 예약 앱", en: "TruePixel booking app" };

async function j6Page(locale, fake) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  // central-plane 요청은 전부 여기서 답한다 — 라이브 주소와 가짜 주소 둘 다(fake.origins).
  for (const origin of fake.origins) {
    await ctx.route(`${origin}/**`, async (route) => {
      const req = route.request();
      const r = fake.handle(req.method(), req.url());
      await route.fulfill({
        status: r.status,
        headers: { ...fakeCorsHeaders(req.headers()["origin"]), "content-type": "application/json" },
        body: r.status === 204 ? "" : JSON.stringify(r.json),
      });
    });
  }
  // 같은 출처 로그인 프록시(/api/auth/*)는 Next 서버가 central로 넘긴다 — 브라우저에서 먼저 답한다(로그아웃).
  await ctx.route(`${BASE}/api/auth/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await ctx.addInitScript((seed) => {
    try {
      localStorage.setItem("conclave:locale", seed.locale);
      if (!localStorage.getItem("conclave_user_key")) localStorage.setItem("conclave_user_key", "uk_j6localfake01");
      const pk = "conclave_wf_projects:anon";
      if (!localStorage.getItem(pk)) {
        localStorage.setItem(pk, JSON.stringify([{
          id: seed.id, name: seed.name, description: seed.desc, createdAt: "2026-09-30",
          spec: { completeness: 80, goal: seed.desc, included: [], excluded: [], openDecisions: [] },
          requirements: seed.items,
        }]));
        localStorage.setItem(`conclave_wf_ext_${seed.id}`, JSON.stringify({ entryPath: "idea", productSpec: { productName: seed.name, oneLine: seed.desc } }));
      }
    } catch {}
  }, {
    locale,
    id: J6_PROJECT.id,
    name: J6_PROJECT[locale === "en" ? "en" : "ko"],
    desc: locale === "en" ? "Customers book their own photo sessions" : "손님이 직접 촬영 예약을 잡는 웹앱",
    items: [
      { id: "it_1", title: locale === "en" ? "Book an open slot" : "빈 시간 보고 예약하기", status: "not_started", category: "flow", priority: "must" },
      { id: "it_2", title: locale === "en" ? "See the booking back" : "예약 확인 화면", status: "not_started", category: "flow", priority: "must" },
    ],
  });
  const page = await ctx.newPage();
  page._simsaLocale = locale;
  return page;
}

/** J6 기대값 — 어긋나면 P0(기본 흐름의 만들기 여정이 안 됨). 문구를 같이 남긴다. */
function j6Expect(row, ok, what) {
  if (!ok) audit.findings.push({ sev: "P0", journey: audit.journeys.at(-1).name, locale: row.locale, step: row.label, what: `J6 기대 불일치 — ${what}` });
}

/** 화면 main의 주 버튼 중 하나가 이 라벨로 시작하는가(개요 CTA는 "라벨 →"). */
const primaryStartsWith = (row, label) => (row.primaryCta ?? []).some((s) => s.startsWith(label));

/**
 * 탭 숨김·복귀를 브라우저 안에서 흉내 낸다(#578 검증 결함 9 — 폴링 중단·재개를 **동작으로** 잰다).
 * document.visibilityState를 덮고 visibilitychange를 쏜다(use-page-visible.ts가 듣는 그 이벤트).
 */
async function setTabVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

/**
 * 개요(지휘 센터) — '지금 할 일'이 만들기 사실과 같은 답을 하는가(#578 검증 결함 1·8).
 * forbidden: 이 상태에서 나오면 두 번째 답이 되는 라벨들(예: 만들기가 열렸는데 "만들기 안내 받기").
 */
async function j6Overview(page, label, expectLabel, forbidden) {
  await page.goto(`${BASE}/projects/${J6_PROJECT.id}`, { waitUntil: "networkidle", timeout: 90000 });
  await settleForNextAction(page, 15000);
  const r = await facts(page, label);
  j6Expect(r, primaryStartsWith(r, expectLabel), `개요 주 버튼이 [${expectLabel}]여야 함 — 실제 ${JSON.stringify(r.primaryCta)}`);
  for (const other of forbidden) j6Expect(r, !primaryStartsWith(r, other), `개요가 다른 답([${other}])을 함`);
  return r;
}

/** 멈춤 화면의 [지시서 받아가기] — 그 자리에서 지시서 문서가 받아지는가(#578 검증 결함 4). */
async function j6TakeSpec(page, fake, mk, locale) {
  const before = fake.calls.filter((c) => c === "POST /workspace/export-builder-pack").length;
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator("main button", { hasText: mk.takeSpec }).first().click(),
  ]);
  await page.waitForFunction((s) => (document.querySelector("main")?.innerText || "").includes(s), mk.takeSpecDone, { timeout: 10000 }).catch(() => {});
  const r = await facts(page, "J6-3b 막힘 → 지시서 받아가기 — 그 자리에서 문서 받기");
  const name = dl.suggestedFilename();
  r.download = name;
  j6Expect(r, (locale === "en" ? /^dev-spec-.+\.md$/ : /^개발지시서-.+\.md$/).test(name), `지시서 문서(.md)를 받아야 함 — 실제 파일 이름 ${JSON.stringify(name)}`);
  j6Expect(r, /\/my-app$/.test(page.url()), `같은 화면에 머물러야 함(개발 도구 고르는 화면으로 가지 않는다) — 실제 ${page.url()}`);
  j6Expect(r, fake.calls.filter((c) => c === "POST /workspace/export-builder-pack").length === before + 1, "지시서는 서버 렌더러가 만든 것(빌더 팩 응답의 dev-spec/)이어야 함");
  j6Expect(r, (await page.evaluate(() => (document.querySelector("main")?.innerText || ""))).includes(mk.takeSpecDone), "받은 뒤 한 줄 안내가 보여야 함");
  const path = await dl.path().catch(() => null);
  if (path) {
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(path, "utf8");
    r.downloadHead = body.slice(0, 120);
    j6Expect(r, body.includes(locale === "en" ? "TruePixel booking app" : "(주)트루픽셀 예약 앱") && !body.includes("CLAUDE_CODE_PROMPT") && !body.includes("FAKE_ONLY"), "문서에는 지시서만(개발 도구 프롬프트·비밀 파일 없음)");
  }
  return r;
}

async function runMakeJourney(locale, scenario, { retryConflict = false } = {}) {
  const { DICTIONARIES } = await import("../../apps/dashboard/src/i18n/dictionary.mjs");
  const t = DICTIONARIES[locale];
  const mk = t.makeApp;
  const cc = t.commandCenter;
  const fake = createFakeCentral({ projectId: J6_PROJECT.id, scenario, locale, retryConflict });
  try {
    journey(`J6 만들기(${scenario}${retryConflict ? "·수정 전 서버의 다시 시도" : ""}): 아이디어 → 지시서 → 만들기 → 진행 화면`, locale);
    const page = await j6Page(locale, fake);
    const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
    const detailCalls = () => fake.calls.filter((c) => /^GET \/workspace\/projects\/[^/]+\/build-jobs\/[^/]+$/.test(c)).length;

    // ⓪ 개요 — 만들기 전: '지금 할 일'이 [앱 만들기](지시서 화면의 [만들기]와 같은 답). 종전: 만들기 안내(외부 AI 도구).
    const packLabels = [cc.getGuide, cc.getPack];
    await j6Overview(page, "J6-0 개요 — 만들기 전 지금 할 일", cc.makeApp, packLabels);

    // ① 아이디어 문의 끝 — 지시서 화면: 4줄 요약 + 만들기 안내 + 주 버튼 하나(만들기)
    await page.goto(`${BASE}/projects/${J6_PROJECT.id}/dev-spec`, { waitUntil: "networkidle", timeout: 90000 });
    await settleForNextAction(page, 15000);
    const r1 = await facts(page, "J6-1 지시서 화면 — 만들기 안내·주 버튼");
    const t1 = await mainText();
    j6Expect(r1, r1.primaryCtaCount === 1 && r1.primaryCta.includes(mk.make), `주 버튼이 [${mk.make}] 하나여야 함 — 실제 ${JSON.stringify(r1.primaryCta)}`);
    j6Expect(r1, t1.includes(mk.free) && t1.includes(mk.hosted), "시작 전 안내(비용 없음·Simsa 주소)가 보여야 함");
    j6Expect(r1, !t1.includes(mk.devPath), "개발자 모드가 아닌데 A 경로 문장이 보임");

    // ② 만들기 한 번 → 내 앱(진행 화면)
    await page.locator("main .btn-primary", { hasText: mk.make }).first().click();
    await page.waitForURL(/\/my-app$/, { timeout: 30000 });
    await page.waitForSelector('main [aria-current="step"]', { timeout: 20000 }).catch(() => {});
    const r2 = await facts(page, "J6-2 만드는 중 진행 화면 — 지금 단계 강조");
    const steps2 = await page.locator('main [aria-current="step"]').count();
    const t2 = await mainText();
    j6Expect(r2, (r2.h1 ?? []).includes(t.nav.myApp), `제목이 '${t.nav.myApp}'여야 함 — 실제 ${JSON.stringify(r2.h1)}`);
    j6Expect(r2, steps2 === 1 && t2.includes(mk.nowTag), `지금 단계가 정확히 하나 강조돼야 함 — ${steps2}개`);
    j6Expect(r2, !/\d+\s*%/.test(t2), "진행률 %가 보이면 안 됨(D-4: 단계로)");

    const failText = mk.failures.notImplemented.slice(0, 20);
    const waitFor = (s, timeout) => page.waitForFunction((x) => (document.querySelector("main")?.innerText || "").includes(x), s, { timeout }).catch(() => {});

    if (scenario === "not_implemented") {
      // ③ 실행체가 아직 준비 중 — 화면이 정직하게 말하는가
      await waitFor(failText, 45000);
      const r3 = await facts(page, "J6-3 ★정직 실패 막힘 — 준비 중인 단계에서 멈춤");
      const t3 = await mainText();
      j6Expect(r3, t3.includes(mk.failures.notImplemented), "준비 중 단계 실패 문구가 보여야 함");
      j6Expect(r3, t3.includes(mk.noCharge), "'비용은 받지 않았어요(베타)'가 보여야 함");
      j6Expect(r3, r3.primaryCtaCount === 1 && r3.primaryCta.includes(mk.takeSpec), `주 버튼은 [${mk.takeSpec}] — 실제 ${JSON.stringify(r3.primaryCta)}`);
      j6Expect(r3, r3.buttons.includes(mk.retry), `[${mk.retry}]가 있어야 함`);
      // ③-b [지시서 받아가기]를 **눌러 본다**(#578 결함 4 — 종전 J6는 있는지만 봤다).
      await j6TakeSpec(page, fake, mk, locale);
      // ④ 새로고침·재방문 — 최근 잡 복원
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await waitFor(failText, 20000);
      const r4 = await facts(page, "J6-4 새로고침 후 막힘 화면 복원");
      j6Expect(r4, (await mainText()).includes(mk.failures.notImplemented), "새로고침 뒤에도 같은 잡(멈춤)이 복원돼야 함");
      // ⑤ [다시 시도]를 **눌러 본다**(#578 결함 3 — 종전 J6는 있는지만 봤다).
      const jobsBefore = fake.jobs.length;
      await page.locator("main button", { hasText: mk.retry }).first().click();
      if (retryConflict) {
        // 수정 전 서버: 같은 프로젝트의 두 번째 시작은 D1 이름 충돌로 502. 화면은 "잠시 뒤 다시"를 약속하지 않고
        // 그 자리에서 지시서를 준다(막다른 길 금지).
        await waitFor(mk.startErrors.hostingFailed.slice(0, 16), 20000);
        const r5 = await facts(page, "J6-5 다시 시도 → 호스팅 자리 실패 막힘 안내");
        const t5 = await mainText();
        j6Expect(r5, t5.includes(mk.startErrors.hostingFailed), "호스팅 자리 실패를 정직하게 말해야 함");
        j6Expect(r5, !/잠시 뒤 다시 시도|try again in a bit/i.test(t5), "막다른 길에서 '잠시 뒤 다시 시도'를 약속하면 안 됨");
        // 지시서 받기는 이 화면의 행동 줄에 이미 주 버튼으로 있다 — 알림 안에 되풀이하지 않는다(한 행동 한 번).
        j6Expect(r5, (await page.locator("main button", { hasText: mk.takeSpec }).count()) === 1, `[${mk.takeSpec}]가 정확히 한 번 보여야 함`);
        j6Expect(r5, primaryStartsWith(r5, mk.takeSpec), `막다른 길에서 주 버튼은 [${mk.takeSpec}] — 실제 ${JSON.stringify(r5.primaryCta)}`);
        j6Expect(r5, fake.jobs.length === jobsBefore, "실패한 시작은 잡을 만들지 않는다");
      } else {
        // 수정 뒤 서버: 전 잡의 D1을 다시 써서 새 잡이 시작된다 — 그리고 (지금 실행체로는) 같은 자리에서 정직하게 멈춘다.
        await waitFor(mk.nowTag, 15000);
        await waitFor(failText, 45000);
        const r5 = await facts(page, "J6-5 다시 시도 → 새 잡 → 같은 자리에서 멈춤 막힘");
        j6Expect(r5, fake.jobs.length === jobsBefore + 1, `다시 시도가 새 잡을 시작해야 함 — 잡 ${fake.jobs.length}개`);
        j6Expect(r5, (await mainText()).includes(mk.failures.notImplemented), "새 잡도 정직하게 멈춘 자리를 말해야 함");
      }
      // ⑥ 개요 — 멈춘 뒤: '멈춘 이유 보기'(내 앱). 종전: 만들기 안내.
      await j6Overview(page, "J6-6 개요 — 멈춘 뒤 지금 할 일", cc.buildStopped, packLabels);
    } else {
      // ②-b 탭 숨김·복귀(#578 결함 9): 숨기면 잡 조회가 멈추고, 돌아오면 기다리지 않고 바로 한 번.
      await setTabVisibility(page, "hidden");
      const c0 = detailCalls();
      await page.waitForTimeout(11000);
      const c1 = detailCalls();
      await setTabVisibility(page, "visible");
      const resumeDeadline = Date.now() + 3000;
      while (detailCalls() === c1 && Date.now() < resumeDeadline) await page.waitForTimeout(100);
      const c2 = detailCalls();
      const rv = await facts(page, "J6-2b 만드는 중 — 탭 숨김 11초 동안 조회 0, 돌아오면 곧바로 1");
      rv.pollCounts = { beforeHide: c0, afterHidden11s: c1, afterVisible: c2 };
      j6Expect(rv, c1 === c0, `탭이 숨은 동안 잡 조회가 멈춰야 함 — ${c0} → ${c1}`);
      j6Expect(rv, c2 > c1, `탭이 돌아오면 곧바로(3초 안) 다시 조회해야 함 — ${c1} → ${c2}`);
      // ②-c 개요 — 만드는 중: '진행 상황 보기'(내 앱). 종전: 만들기 안내.
      await j6Overview(page, "J6-2c 개요 — 만드는 중 지금 할 일", cc.viewBuild, packLabels);
      await page.goto(`${BASE}/projects/${J6_PROJECT.id}/my-app`, { waitUntil: "networkidle", timeout: 90000 });
      // ③ 끝 — 내 앱 카드(D-6)
      await waitFor(mk.appTitle, 120000);
      const r3 = await facts(page, "J6-3 내 앱 카드 — 주소·프로덕션 아님·신고");
      const t3 = await mainText();
      j6Expect(r3, t3.includes(mk.hostedNote), "'Simsa 주소에서 운영 중 · 프로덕션 아님'이 보여야 함");
      // 신고 링크는 B-7 신고 사이트 직행(report.<루트>/?app=<slug>) — 앱 origin 경로가 아니다(#578 스위치 단일화 커밋).
      j6Expect(r3, (await page.locator('main a[href="https://report.simsa.page/?app=app-7x9k2m1q"]').count()) === 1, "이 앱 신고하기 링크가 하나 있어야 함");
      j6Expect(r3, (await page.locator('main a[href^="https://app-7x9k2m1q.simsa.page"]').count()) >= 1, "앱 주소 링크가 있어야 함");
      j6Expect(r3, r3.primaryCtaCount === 1 && r3.primaryCta.includes(mk.openApp), `주 버튼은 [${mk.openApp}] — 실제 ${JSON.stringify(r3.primaryCta)}`);
      // ④ 개요 — 만든 뒤: '내 앱 보기'. 종전: "만들기 안내 받아 AI 도구로 앱을 만드세요"(#578 결함 1).
      await j6Overview(page, "J6-4 개요 — 만든 뒤 지금 할 일", cc.viewApp, packLabels);
    }
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
  if (fake.unhandled.length) audit.fakeUnhandled.push({ journey: audit.journeys.at(-1)?.name, locale, paths: [...new Set(fake.unhandled)] });
}

/**
 * J6 닫힘(#578 검증 결함 2) — 서버가 만들기를 열지 않았을 때(지금 프로덕션: BUILD_ENABLED = "off"). [만들기]·"45분·Simsa 주소"
 * 안내가 **보이면 안 된다**(누르면 멈출 약속). 종전처럼 팩이 주 버튼, 사이드바에 '내 앱' 없음, 개요는 만들기 안내,
 * 내 앱 주소로 직접 와도 정직한 안내 + 그 자리에서 지시서 받기.
 */
async function runMakeClosedJourney(locale) {
  const { DICTIONARIES } = await import("../../apps/dashboard/src/i18n/dictionary.mjs");
  const t = DICTIONARIES[locale];
  const mk = t.makeApp;
  const cc = t.commandCenter;
  const fake = createFakeCentral({ projectId: J6_PROJECT.id, scenario: "not_implemented", locale, open: false });
  try {
    journey("J6 만들기(닫힘 — 서버가 열지 않음): 개요 → 지시서 → 내 앱 직접", locale);
    const page = await j6Page(locale, fake);
    const mainText = () => page.evaluate(() => (document.querySelector("main")?.innerText || "").replace(/\s+/g, " "));
    await j6Overview(page, "J6c-1 개요 — 닫힘이면 종전 만들기 안내", cc.getGuide, [cc.makeApp, cc.makeSpec]);

    await page.goto(`${BASE}/projects/${J6_PROJECT.id}/dev-spec`, { waitUntil: "networkidle", timeout: 90000 });
    await settleForNextAction(page, 15000);
    const r2 = await facts(page, "J6c-2 지시서 화면 — 닫힘이면 [만들기] 없음·팩이 주 버튼");
    const t2 = await mainText();
    j6Expect(r2, r2.primaryCtaCount === 1 && primaryStartsWith(r2, t.devSpec.getPack.replace(/\s*→$/, "")), `주 버튼은 [${t.devSpec.getPack}] — 실제 ${JSON.stringify(r2.primaryCta)}`);
    j6Expect(r2, !t2.includes(mk.hosted) && !t2.includes(mk.free) && !r2.buttons.includes(mk.make), "닫혔는데 만들기 안내·버튼이 보임(없는 기능 약속)");
    j6Expect(r2, fake.calls.every((c) => c !== "POST /workspace/projects/wsp_tp7x9k2m1q/build"), "닫혔는데 빌드 시작 요청이 나감");
    const sidebarMyApp = await page.locator('aside a[href$="/my-app"], nav a[href$="/my-app"]').count();
    j6Expect(r2, sidebarMyApp === 0, `닫혔으면 사이드바에 '${t.nav.myApp}'이 없어야 함 — ${sidebarMyApp}개`);

    await page.goto(`${BASE}/projects/${J6_PROJECT.id}/my-app`, { waitUntil: "networkidle", timeout: 90000 });
    await settleForNextAction(page, 15000);
    const r3 = await facts(page, "J6c-3 내 앱 직접 방문 — 정직한 안내 + 지시서 받기");
    j6Expect(r3, (await mainText()).includes(mk.startErrors.unavailable), "아직 열리지 않았다고 말해야 함");
    j6Expect(r3, r3.primaryCtaCount === 1 && r3.primaryCta.includes(mk.takeSpec), `주 버튼은 [${mk.takeSpec}] — 실제 ${JSON.stringify(r3.primaryCta)}`);
    await page.context().close();
  } catch (err) {
    audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
  }
  if (fake.unhandled.length) audit.fakeUnhandled.push({ journey: audit.journeys.at(-1)?.name, locale, paths: [...new Set(fake.unhandled)] });
}

// ── 실행 ────────────────────────────────────────────────────────────────────────

if (LOCAL_BASE) {
  // 로컬 가짜 서버 모드: J6만(라이브 여정은 라이브 서버가 필요하다).
  // KO 멈춤은 **수정 전 서버**의 다시 시도(502 hosting_d1_failed — 지금 프로덕션 central), EN 멈춤은 수정 뒤 서버(새 잡).
  await runMakeJourney("ko", "not_implemented", { retryConflict: true });
  await runMakeJourney("ko", "done");
  await runMakeClosedJourney("ko");
  if (!KO_ONLY) {
    await runMakeJourney("en", "not_implemented");
    await runMakeClosedJourney("en");
  }
} else {
// ── 라이브: KO 전체 + (기본) EN 축 — J6는 여기서 돌지 않는다(실제 빌드를 시작하므로) ──────

await runFirstVisitLocale("ko-KR");
await runIdeaEntry("ko");
await runCodeJourney("ko");
await runRepoOnlyJourney("ko");
await runDiffersDoorEntry("ko");
await runSpecJourney("ko");
await runConnectJourney("ko");
await runSeededResultJourney("ko");

if (!KO_ONLY) {
  await runFirstVisitLocale("en-US");
  await runIdeaEntry("en");
  await runCodeJourney("en");
  await runRepoOnlyJourney("en");
  await runDiffersDoorEntry("en");
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
} // 라이브 끝

// ── P0/P1/P2 자동 분류 (결정론 — 후보를 빠뜨리지 않기 위한 기계 패스) ─────────
// 사람이 산출물(스크린샷 포함)을 읽고 최종 판정한다. 규칙:
//   P0: 여정 실패(예외/막힘) · happy path에서 오류 카피 노출
//   P1: 액션 스텝인데 primary 0 · 한 화면 primary ≥3(#5 위계 위반 후보)
//       · EN 주행에서 한글 누수 큼(>80자: 셸 잔재 이상의 본문 누수)
//   P2: 비활성 버튼 존재(이유 표시는 스크린샷 확인 필요) · 막힘 스텝인데 안내 신호 0
//   + lib 규칙(C-J1): 초보자 기준(beginnerFindings) · 막다른 길 P0 / 같은 라벨·다른 목적지 P1
//     (structureFindings)
for (const j of audit.journeys) {
  if (j.failure) {
    audit.findings.push({ sev: "P0", journey: j.name, locale: j.locale, step: "(journey)", what: `여정 실패: ${j.failure}` });
  }
  for (const s of j.steps) {
    const isBlockedStep = /막힘|시도/.test(s.label);
    if (s.errorish > 0 && !isBlockedStep) {
      audit.findings.push({ sev: "P0", journey: j.name, locale: s.locale, step: s.label, what: `happy path 오류 카피 ${s.errorish}건 노출 — ${(s.errorishHits ?? []).join(" ⟂ ")}` });
    }
    // 갈래 선택(chooser)은 3개의 동등한 문 설계라 primary-0이 정상 — 기준선
    // 판독(2026-07-21)에서 거짓 양성으로 확정, 규칙 예외. (추천 배지는 D16이
    // 별도로 담당한다.) "만드는 중"(B-8 J6-2)은 "변환 중"과 같은 기다림 화면 —
    // 할 일이 없는 동안 버튼을 만들어 넣으면 그게 거짓 행동이다.
    if (s.primaryCtaCount === 0 && !/입력 후|변환 중|만드는 중|갈래 선택/.test(s.label)) {
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
    // ★초보자 기준 (Train N6 → C-J1, D-17 amend): 기본 흐름(J0·J1·J2·J6·J7)에서 개발
    // 용어·외부 계정 버튼은 P0 — 단 기존 앱 문(J1)의 GitHub은 선택 단계로 허용(P2).
    // 개발자·시드 화면(J3·J5)은 P2로만. 규칙은 lib에 있다(테스트됨). 문구를 같이 남긴다.
    for (const b of beginnerFindings({ journeyName: j.name, devTerms: s.devTerms, accountCtas: s.accountCtas })) {
      audit.findings.push({ sev: b.sev, journey: j.name, locale: s.locale, step: s.label, what: b.what });
    }
    // ★화면 구조 (C-J1): 막다른 길 P0 · 같은 라벨·다른 목적지 P1.
    for (const x of structureFindings(s)) {
      audit.findings.push({ sev: x.sev, journey: j.name, locale: s.locale, step: s.label, what: x.what });
    }
  }
}

// 로컬 가짜 모드는 라이브 기준선(journey-audit-result.json)을 덮지 않는다.
const RESULT_FILE = LOCAL_BASE ? "./journey-audit-local-result.json" : "./journey-audit-result.json";
writeFileSync(new URL(RESULT_FILE, import.meta.url), JSON.stringify(audit, null, 2));
const bySev = { P0: 0, P1: 0, P2: 0, ALLOWED: 0 };
for (const f of audit.findings) bySev[f.sev]++;
// ALLOWED = 잠긴 결정(D-17 amend)으로 허용된 노출 — 기록은 남기되 결함 수에는 넣지 않는다.
console.log(`
findings: P0=${bySev.P0} P1=${bySev.P1} P2=${bySev.P2} (허용 기록 ALLOWED=${bySev.ALLOWED})`);
if (audit.fakeUnhandled.length) console.log("fake-central unhandled:", JSON.stringify(audit.fakeUnhandled));
console.log(`saved: ${RESULT_FILE} / shots:`, SHOTS);
await browser.close();
