/**
 * journey-audit.mjs — 신규 유저 시점 "갈래 완주" QA (2026-07-20, Bae:
 * "왜 이렇게 플로우에 허점이 많아 — 뭘 돌린 거야 QA").
 *
 * flow-audit.mjs(아이디어 갈래+탭 순회)가 못 걸었던 표면을 채점한다:
 *   J1 기존-앱(code) 갈래 완주 — 무엇을 묻는가, 만들고 나면 어디로 떨어지고
 *      다음 행동이 보이는가, GitHub 없는 유저의 막힘 안내가 있는가
 *   J2 기획서(spec) 갈래 완주 — 붙여넣기→변환→저장 후 다음 행동
 *   J3 checks 첫 화면 — 검수 모드 선택 가시성, 소스 없이 실행 시 막힘 안내
 *   J4 repo 연결 여정(익명) — 연결 화면에서 비개발자가 다음 행동을 아는가
 *
 * 채점 축(스텝마다 기록): primaryCta(다음 행동이 버튼으로 보이는가),
 * blockedGuidance(막혔을 때 이유+해법 카피), deadEnd(전진 CTA 부재),
 * errorish(오류 신호). 스크립트는 측정만 하고 판정은 산출물을 읽고 내린다.
 *
 * Usage: node journey-audit.mjs   → journey-audit-shots/*.png + journey-audit-result.json
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://app.trysimsa.com";
const SHOTS = new URL("./journey-audit-shots", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const audit = { startedAt: new Date().toISOString(), journeys: [] };

async function newUserPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return ctx.newPage();
}

async function facts(page, label, note = "") {
  const f = await page.evaluate(() => {
    const vis = (el) => el.offsetParent !== null;
    const texts = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean);
    const buttons = texts("button, a.btn, [role=button]");
    const body = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      h1: texts("h1").slice(0, 2),
      buttons: buttons.slice(0, 24),
      primaryCta: [...document.querySelectorAll(".btn-primary, button[class*='primary']")].filter(vis).map((e) => (e.innerText || "").trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 5),
      bodyLen: body.length,
      errorish: (body.match(/문제가 발생|불러오지 못|오류가|실패했|다시 시도/g) ?? []).length,
      guidanceish: (body.match(/연결해 주세요|연결하세요|먼저|필요해요|이렇게 하세요|설치/g) ?? []).length,
      bodyHead: body.slice(0, 400),
    };
  });
  const row = { label, note, url: page.url(), ...f };
  audit.journeys.at(-1).steps.push(row);
  await page.screenshot({ path: `${SHOTS}/${audit.journeys.length}-${audit.journeys.at(-1).steps.length}-${label.replace(/[^\w가-힣-]/g, "_").slice(0, 40)}.png` }).catch(() => {});
  console.log(`  [${label}] cta=${JSON.stringify(f.primaryCta)} err=${f.errorish} guide=${f.guidanceish}`);
  return row;
}

function journey(name) {
  audit.journeys.push({ name, steps: [], failure: null });
  console.log(`\n▶ ${name}`);
}

// ── J1: 기존-앱(code) 갈래 완주 ────────────────────────────────────────────────
try {
  journey("J1 기존-앱 갈래: 만든 앱 검수받기 완주");
  const page = await newUserPage();
  await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle", timeout: 45000 });
  await facts(page, "갈래 선택 화면");
  // chooser에서 code 갈래 진입 (문구는 갈래 카드 — '이미'/'만든' 계열 텍스트)
  const codeCard = page.getByRole("button", { name: /이미|만든|검수/ }).first();
  if (await codeCard.count()) { await codeCard.click(); } else {
    await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle" });
  }
  await page.waitForTimeout(800);
  await facts(page, "code 갈래 스텝1 — 무엇을 묻는가");
  // ★사이드바 검색 input이 first("input")에 걸린다 — 본문 필드는 placeholder로.
  await page.getByPlaceholder(/나의 첫|쇼핑몰/).fill("동네 빵집 예약 테스트앱");
  const descBox = page.locator("textarea").first();
  if (await descBox.count()) await descBox.fill("빵을 예약하고 픽업 시간을 고르는 앱");
  await facts(page, "code 스텝1 입력 후");
  await page.getByRole("button", { name: /프로젝트 만들/ }).first().click();
  await page.waitForURL(/projects\/(?!new)/, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await facts(page, "생성 직후 랜딩 — 여기가 어디고 다음 행동이 보이는가");
  // 개요로 이동해 '지금 할 일' 확인
  const pid = (page.url().match(/projects\/([^/?#]+)/) ?? [])[1];
  if (pid) {
    await page.goto(`${BASE}/projects/${pid}`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "개요 — 지금 할 일이 이 갈래에 맞는가");
    await page.goto(`${BASE}/projects/${pid}/checks`, { waitUntil: "networkidle", timeout: 45000 });
    await facts(page, "checks 첫 화면 — 모드 선택 보이는가/소스 없이 뭐라 하는가");
    // 검수 실행 버튼을 눌러 소스 없는 막힘 안내 확인
    const runBtn = page.getByRole("button", { name: /검수|확인/ }).first();
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

// ── J2: 기획서(spec) 갈래 완주 ────────────────────────────────────────────────
try {
  journey("J2 기획서 갈래: 붙여넣기→변환→다음 행동");
  const page = await newUserPage();
  await page.goto(`${BASE}/projects/new?path=spec`, { waitUntil: "networkidle", timeout: 45000 });
  await facts(page, "spec 갈래 스텝1");
  await page.locator("main textarea, textarea").first().fill("제품: 반려견 산책 기록 앱\n기능: 산책 시작/종료 기록, 주간 거리 통계, 기록 공유\n대상: 반려견 보호자");
  await page.getByRole("button", { name: /확인 항목으로 바꾸기/ }).first().click();
  await page.waitForTimeout(1500);
  await facts(page, "변환 중/직후");
  // 변환은 실 LLM — 최대 60s 대기 후 저장 버튼 탐색
  for (let i = 0; i < 12; i++) {
    if (await page.getByRole("button", { name: /저장|프로젝트로/ }).count()) break;
    await page.waitForTimeout(5000);
  }
  await facts(page, "변환 결과 화면");
  const saveBtn = page.getByRole("button", { name: /저장|프로젝트로/ }).first();
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

// ── J3+J4: repo 연결 여정 (익명 — GitHub 미연결 상태) ─────────────────────────
try {
  journey("J3 repo 연결 여정: GitHub 미연결 신규 유저");
  const page = await newUserPage();
  // 샘플 아님 실 프로젝트가 필요 — J1에서 만든 프로젝트를 재사용할 수 없어(다른 컨텍스트)
  // 로컬-우선 앱 특성상 새로 하나 만들지 않고, 프로젝트 없이 연결 화면 관찰이 목적이므로
  // code 갈래로 최소 생성(설명 생략) 후 settings로.
  await page.goto(`${BASE}/projects/new?path=code`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByPlaceholder(/나의 첫|쇼핑몰/).fill("연결 여정 테스트");
  await page.getByRole("button", { name: /프로젝트 만들/ }).first().click();
  await page.waitForURL(/projects\/(?!new)/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await facts(page, "settings/연결 화면 — 미연결 유저가 보는 것");
  const ghBtn = page.getByRole("button", { name: /GitHub|깃허브|연결/ }).first();
  if (await ghBtn.count()) {
    await facts(page, "GitHub 연결 CTA 존재 확인", (await ghBtn.innerText().catch(() => "")).slice(0, 60));
  }
  await page.context().close();
} catch (err) {
  audit.journeys.at(-1).failure = String(err?.message ?? err).slice(0, 200);
}

writeFileSync(new URL("./journey-audit-result.json", import.meta.url), JSON.stringify(audit, null, 2));
console.log("\nsaved: journey-audit-result.json / shots:", SHOTS);
await browser.close();
