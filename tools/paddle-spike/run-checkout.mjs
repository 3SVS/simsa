#!/usr/bin/env node
/**
 * run-checkout.mjs — Playwright 로 로컬 체크아웃 페이지에서 Paddle 공개 테스트 카드로 트라이얼 구독을 만든다.
 * **샌드박스 전용**: client-side token 은 test_… 만, 페이지는 Paddle.Environment.set("sandbox") 고정,
 * API 클라이언트는 sandbox-api 외 주소면 즉시 throw.
 *
 *   node run-checkout.mjs [--variant trial19|trial0] [--count 1] [--headed] [--locale ko|en]
 *
 * 필요한 값: PADDLE_SANDBOX_API_KEY, PADDLE_SANDBOX_CLIENT_TOKEN (없으면 "키 없음 — 실행 대기", 코드 3)
 * 필요한 파일: evidence/catalog.json (node setup.mjs)
 * 필요한 도구: playwright (이 폴더에서 `npm install` + `npx playwright install chromium`) — 없으면 실행 대기
 *
 * 한 번 돌 때마다: 체크아웃 화면(상품 표시) 스크린샷 → 테스트 카드 입력 → checkout.completed 의 거래 id →
 * API 로 거래→구독 id → 구독 상태(trialing)·custom_data 한글 왕복 확인 → evidence/pool.json 에 추가.
 * 실패하면 스크린샷(evidence/shots/)과 이벤트를 남기고 다음 회차로.
 *
 * 스크린샷은 이미지라 redact → assertNoLeak 를 거치지 않는다(JSON 증거만 가려진다). 그래서 화면에 들어가는
 * 값을 코드로 묶는다: 이메일은 예약 도메인만(serve.mjs buildCheckoutConfig), 카드는 공개 테스트 카드 상수 TEST_CARD.
 * 새 입력값을 화면에 넣게 되면 같은 규칙을 먼저 건다.
 *
 * 테스트 카드(developer.paddle.com/concepts/payment-methods/credit-debit-card, 2026-09-28 접근):
 *   성공(3DS 없음) 4242 4242 4242 4242 · 이름 아무거나 · 만료 미래 · CVC 아무 3자리. 샌드박스에서만 동작.
 * 입력 칸 찾기는 라벨/placeholder 추정(한·영)이다 — 첫 실행에서 실패하면 스크린샷을 보고 셀렉터를 고친다.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createPaddleClient } from "./paddle-client.mjs";
import { evidenceDirFrom, isMain, parseArgs, requireOrWait, waitFor } from "./lib/env.mjs";
import { addToPool, parsePool, readEvidence, writeEvidence } from "./lib/evidence.mjs";
import { extractCompletedTransactionId, failureEvents } from "./lib/checkout-events.mjs";
import { koreanRoundTrip, summarizeSubscription, summarizeTransaction } from "./lib/observe.mjs";
import { buildCheckoutConfig, loadCatalog, loadCheckoutHtml, startServer } from "./serve.mjs";

export const TEST_CARD = Object.freeze({ number: "4242 4242 4242 4242", name: "Simsa Spike", expiry: "12/30", cvc: "123" });

const FIELD = {
  number: /card number|카드 ?번호/i,
  name: /name on card|cardholder|카드.*(소유자|명의|이름)/i,
  expiry: /expir|만료/i,
  cvc: /security code|cvv|cvc|보안 ?코드/i,
};
const SUBMIT = /start trial|subscribe|pay|continue|체험|구독|결제|계속|시작/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 모든 프레임에서 라벨·placeholder 로 입력 칸을 찾아 채운다. @returns {Promise<boolean>} */
async function fillAnyFrame(page, pattern, value) {
  for (const frame of page.frames()) {
    for (const locator of [frame.getByLabel(pattern), frame.getByPlaceholder(pattern)]) {
      try {
        const first = locator.first();
        if (await first.isVisible({ timeout: 500 })) {
          await first.fill(value);
          return true;
        }
      } catch {
        /* 다음 후보 */
      }
    }
  }
  return false;
}

async function clickSubmit(page) {
  for (const frame of page.frames()) {
    try {
      const btn = frame.getByRole("button", { name: SUBMIT }).last();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        return true;
      }
    } catch {
      /* 다음 프레임 */
    }
  }
  return false;
}

async function paddleFrameText(page) {
  for (const frame of page.frames()) {
    if (!/paddle\.com/.test(frame.url())) continue;
    try {
      const text = await frame.locator("body").innerText({ timeout: 2_000 });
      if (text.trim() !== "") return text.slice(0, 2_000);
    } catch {
      /* 다음 */
    }
  }
  return null;
}

async function waitForSubscription(client, txnId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.transactions.get(txnId);
    const subId = last.ok && last.data && typeof last.data.subscription_id === "string" ? last.data.subscription_id : null;
    if (subId) return { subId, txn: last.data };
    await sleep(5_000);
  }
  return { subId: null, txn: last?.data ?? null };
}

async function main() {
  const vars = requireOrWait(["PADDLE_SANDBOX_API_KEY", "PADDLE_SANDBOX_CLIENT_TOKEN"]);
  if (vars === null) return;
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = evidenceDirFrom();
  const catalog = loadCatalog(evidenceDir);
  if (catalog === null) return waitFor("evidence/catalog.json 이 없습니다 — 먼저 `node setup.mjs`");

  const apiKey = vars.PADDLE_SANDBOX_API_KEY ?? "";
  const clientToken = vars.PADDLE_SANDBOX_CLIENT_TOKEN ?? "";
  const secrets = [apiKey, clientToken];
  const variant = typeof args.variant === "string" ? args.variant : "trial19";
  const count = typeof args.count === "string" && /^\d+$/.test(args.count) ? Math.min(10, Math.max(1, Number(args.count))) : 1;
  const config = buildCheckoutConfig({ clientToken, catalog, variant, projectName: vars.PADDLE_SPIKE_PROJECT_NAME, email: vars.PADDLE_SPIKE_CUSTOMER_EMAIL });
  if (args.locale === "en") config.settings.locale = "en";
  const client = createPaddleClient({ apiKey });

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return waitFor("playwright 가 없습니다 — tools/paddle-spike 에서 `npm install` 후 `npx playwright install chromium`");
  }

  const shotsDir = join(evidenceDir, "shots");
  mkdirSync(shotsDir, { recursive: true });
  const server = await startServer({ config, html: loadCheckoutHtml(), port: 0 });
  const browser = await playwright.chromium.launch({ headless: args.headed !== true });
  const runs = [];
  let pool = parsePool(readEvidence(evidenceDir, "pool"));
  try {
    for (let i = 1; i <= count; i++) {
      const stamp = `${variant}-${Date.now()}-${i}`;
      const page = await browser.newPage({ locale: config.settings.locale === "en" ? "en-US" : "ko-KR" });
      /** @type {Record<string, unknown>} */
      const run = { i, variant, startedAt: new Date().toISOString() };
      try {
        await page.goto(server.url);
        await page.waitForFunction(() => /** @type {any} */ (window).__spikeReady === true, null, { timeout: 30_000 });
        await page.click("#open");
        await page.waitForFunction(() => /** @type {any} */ (window).__spikeEvents.some((e) => e.name === "checkout.loaded"), null, { timeout: 45_000 });
        await sleep(2_000);
        await page.screenshot({ path: join(shotsDir, `display-${stamp}.png`), fullPage: true });
        run.displayText = await paddleFrameText(page); // 상품 표시 관측(가림은 저장 시 적용)
        const filled = {
          number: await fillAnyFrame(page, FIELD.number, TEST_CARD.number),
          name: await fillAnyFrame(page, FIELD.name, TEST_CARD.name),
          expiry: await fillAnyFrame(page, FIELD.expiry, TEST_CARD.expiry),
          cvc: await fillAnyFrame(page, FIELD.cvc, TEST_CARD.cvc),
        };
        run.filled = filled;
        run.submitted = await clickSubmit(page);
        await page.waitForFunction(() => /** @type {any} */ (window).__spikeEvents.some((e) => e.name === "checkout.completed"), null, { timeout: 120_000 });
        const events = await page.evaluate(() => /** @type {any} */ (window).__spikeEvents);
        const txnId = extractCompletedTransactionId(events);
        run.transactionId = txnId;
        if (!txnId) throw new Error("checkout.completed 에 거래 id 가 없습니다");
        const { subId, txn } = await waitForSubscription(client, txnId);
        run.checkoutTransaction = summarizeTransaction(txn);
        if (!subId) throw new Error("거래에서 구독 id 를 찾지 못했습니다(90초)");
        const sub = await client.subscriptions.get(subId);
        const s = summarizeSubscription(sub.data);
        run.subscription = s;
        run.koreanCustomData = koreanRoundTrip(config.customData.simsa_project_name, s?.custom_data?.simsa_project_name);
        run.ok = s?.status === "trialing";
        if (run.ok) pool = addToPool(pool, { subscriptionId: subId, transactionId: txnId, variant, createdAt: new Date().toISOString() });
        await page.screenshot({ path: join(shotsDir, `done-${stamp}.png`), fullPage: true });
      } catch (e) {
        run.ok = false;
        run.error = e instanceof Error ? e.message : String(e);
        try {
          await page.screenshot({ path: join(shotsDir, `fail-${stamp}.png`), fullPage: true });
          run.failureEvents = failureEvents(await page.evaluate(() => /** @type {any} */ (window).__spikeEvents));
        } catch {
          /* 페이지가 닫혔으면 스크린샷 없이 */
        }
      } finally {
        run.finishedAt = new Date().toISOString();
        runs.push(run);
        await page.close().catch(() => {});
      }
      console.log(`  ${i}/${count} ${run.ok ? "trialing 구독 생성" : `실패: ${String(run.error ?? "trialing 아님")}`}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close();
    writeEvidence(evidenceDir, "pool", pool, { secrets });
    const prev = readEvidence(evidenceDir, `checkout-${variant}`);
    const prevRuns = prev && typeof prev === "object" && Array.isArray(/** @type {any} */ (prev).runs) ? /** @type {any} */ (prev).runs : [];
    writeEvidence(evidenceDir, `checkout-${variant}`, { variant, priceId: config.priceId, runs: [...prevRuns, ...runs] }, { secrets });
  }
  const okCount = runs.filter((r) => r.ok).length;
  console.log(`완료: ${okCount}/${count} — 풀에 쓸 수 있는 구독 ${pool.entries.filter((e) => e.usedBy === null).length}개. 증거: ${evidenceDir}`);
  if (okCount === 0) process.exit(1);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`run-checkout 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
