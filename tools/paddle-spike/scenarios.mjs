#!/usr/bin/env node
/**
 * scenarios.mjs — works-or-free 상태 머신 관측 시나리오 S-A ~ S-F (샌드박스 전용).
 *
 *   node scenarios.mjs S-A [--allow-activate]   성공: trialing 구독에 즉시 일회 청구($199) → 거래 추적
 *   node scenarios.mjs S-B                      실패: 청구 없이 즉시 취소 → 청구 0 확인
 *   node scenarios.mjs S-C                      Care 자동 전환 방지: cancel 예약 뒤 /charge 가 예약을 건드리는지
 *   node scenarios.mjs S-D                      S-A 구독에 두 번째 /charge(수리 $29)
 *   node scenarios.mjs S-E [--no-wait]          S-A 청구 전액 환불 Adjustment → 승인·수수료 관측(샌드박스 10분 주기 자동 승인)
 *   node scenarios.mjs S-F                      트라이얼을 35분으로 단축(F1 보호 없음·F2 cancel 예약) → 시작
 *   node scenarios.mjs S-F --observe            만료 뒤 최종 상태·청구 관측
 *   node scenarios.mjs all                      S-A → S-B → S-C → S-D → S-E → S-F(시작) → verdict
 *   node scenarios.mjs verdict                  증거로 분기 A/B/C 판정(네트워크 0)
 *
 * 필요한 값: PADDLE_SANDBOX_API_KEY (verdict 제외. 없으면 "키 없음 — 실행 대기", 코드 3, 네트워크 0)
 * 필요한 파일: evidence/catalog.json(setup) · evidence/pool.json(run-checkout 이 만든 trialing 구독)
 * 결과: evidence/<시나리오>.json — 요청·응답 **요약**, 키·토큰·이메일·카드는 쓰기 전에 가림.
 */
import { createPaddleClient } from "./paddle-client.mjs";
import { SPIKE_TAG, parseCatalog } from "./lib/catalog.mjs";
import {
  buildCancelBody,
  buildChargeBody,
  buildFullRefundBody,
  buildTrialNextBilledAtBody,
} from "./lib/requests.mjs";
import { evidenceDirFrom, isMain, parseArgs, requireOrWait, waitFor } from "./lib/env.mjs";
import { findUsedBy, readEvidence, takeFromPool, writeEvidence } from "./lib/evidence.mjs";
import {
  decideBranch,
  isSettledSuccess,
  observeReadiness,
  scheduledChangeDelta,
  summarizeAdjustment,
  summarizeResult,
  summarizeSubscription,
  summarizeTransaction,
  verdictInputsFrom,
  zeroChargeCheck,
} from "./lib/observe.mjs";

export const SCENARIOS = Object.freeze(["S-A", "S-B", "S-C", "S-D", "S-E", "S-F"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAILED_TXN = new Set(["past_due", "canceled"]);
/** 취소·활성화 직후 뒤늦게 생길 수 있는 거래를 기다리는 시간. 기본 20초(글루 스모크 테스트만 0으로 낮춘다). */
const SETTLE_MS = (() => {
  const v = Number(process.env.PADDLE_SPIKE_SETTLE_MS);
  return Number.isFinite(v) && v >= 0 ? v : 20_000;
})();

function makeRecorder() {
  const steps = [];
  return {
    steps,
    /** @template T @param {string} name @param {() => Promise<T>} fn @param {(d: unknown) => unknown} [summarize] */
    async step(name, fn, summarize) {
      const res = await fn();
      steps.push({ name, at: new Date().toISOString(), ...summarizeResult(res, summarize) });
      return res;
    },
    note(name, detail) {
      steps.push({ name, at: new Date().toISOString(), note: detail });
    },
  };
}

async function listSubTransactions(client, subscriptionId, origin) {
  const res = await client.listAll("/transactions", { subscription_id: subscriptionId, per_page: 50, ...(origin ? { origin } : {}) }, { maxPages: 5 });
  return res.ok ? res.items : null;
}

/** 이 구독의 subscription_charge 거래 중 priceId 를 담은 것이 정산(또는 실패)될 때까지. */
async function pollChargeTransaction(client, rec, subscriptionId, priceId, { knownIds = new Set(), timeoutMs = 120_000, intervalMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const txns = await listSubTransactions(client, subscriptionId, "subscription_charge");
    const mine = (txns ?? []).filter((t) => t && !knownIds.has(t.id) && Array.isArray(t.items) && t.items.some((i) => i?.price?.id === priceId));
    last = mine[0] ?? null;
    if (last && (isSettledSuccess(last.status) || FAILED_TXN.has(last.status))) break;
    await sleep(intervalMs);
  }
  rec.note("poll charge transaction", last ? summarizeTransaction(last) : { found: false, timeoutMs });
  return last;
}

function priceIdOf(catalog, key) {
  const p = catalog.prices[key];
  if (!p || typeof p.id !== "string") throw new Error(`가격 ${key} 없음 — setup 결과(evidence/catalog.json)를 확인하세요`);
  return p.id;
}

/** 풀에서 구독을 가져오고 pool.json 을 갱신. 없으면 실행 대기. */
function takeSub(ctx, scenario, variant) {
  const taken = takeFromPool(ctx.pool, { scenario, variant }) ?? (variant ? takeFromPool(ctx.pool, { scenario }) : null);
  if (!taken) return null;
  ctx.pool = taken.pool;
  writeEvidence(ctx.evidenceDir, "pool", ctx.pool, { secrets: ctx.secrets });
  return taken.entry;
}

function save(ctx, scenario, payload) {
  const path = writeEvidence(
    ctx.evidenceDir,
    scenario,
    { scenario, spikeTag: SPIKE_TAG, finishedAt: new Date().toISOString(), ...payload },
    { secrets: ctx.secrets },
  );
  console.log(`  ${scenario} 증거: ${path}`);
}

// ─── S-A 성공 경로 ────────────────────────────────────────────────────────────
async function scenarioA(ctx, args) {
  const entry = takeSub(ctx, "S-A", "trial0");
  if (!entry) return "no-sub";
  const { client } = ctx;
  const rec = makeRecorder();
  const sub = entry.subscriptionId;
  const priceId = priceIdOf(ctx.catalog, "build_once_199");
  const before = await rec.step("get subscription (before)", () => client.subscriptions.get(sub), summarizeSubscription);
  const chargeBody = buildChargeBody({ priceId });
  await rec.step("preview charge $199", () => client.subscriptions.previewCharge(sub, chargeBody), (d) => {
    const p = d && typeof d === "object" ? /** @type {any} */ (d) : {};
    return {
      status: p.status ?? null,
      immediate_transaction_totals: p.immediate_transaction?.details?.totals ?? null,
      next_transaction_totals: p.next_transaction?.details?.totals ?? null,
      update_summary: p.update_summary ?? null,
    };
  });
  const charge = await rec.step("charge $199 immediately", () => client.subscriptions.charge(sub, chargeBody), summarizeSubscription);
  /** @type {Record<string, unknown>} */
  const observations = {};
  if (charge.ok) {
    const txn = await pollChargeTransaction(client, rec, sub, priceId);
    observations.directCharge = { httpOk: true, transactionId: txn?.id ?? null, transactionStatus: txn?.status ?? null, errorCode: null };
  } else {
    observations.directCharge = { httpOk: false, transactionId: null, transactionStatus: null, errorCode: charge.error?.code ?? null, errorDetail: charge.error?.detail ?? null };
    if (args["allow-activate"] === true && entry.variant === "trial0") {
      const act = await rec.step("activate trialing ($0 price)", () => client.subscriptions.activate(sub), summarizeSubscription);
      await sleep(SETTLE_MS);
      const nonCharge = (await listSubTransactions(client, sub)) ?? [];
      const activationZero = zeroChargeCheck(nonCharge.filter((t) => t?.origin !== "subscription_charge"));
      const charge2 = await rec.step("charge $199 after activate", () => client.subscriptions.charge(sub, chargeBody), summarizeSubscription);
      const txn2 = charge2.ok ? await pollChargeTransaction(client, rec, sub, priceId) : null;
      observations.activateFallback = {
        activateOk: act.ok,
        activationBilledMinor: activationZero.totalMinor,
        chargeHttpOk: charge2.ok,
        transactionId: txn2?.id ?? null,
        transactionStatus: txn2?.status ?? null,
      };
    } else {
      rec.note("activate fallback skipped", entry.variant === "trial0" ? "--allow-activate 없음" : "trial0 구독이 아님($0 가격 필요)");
    }
  }
  const after = await rec.step("get subscription (after)", () => client.subscriptions.get(sub), summarizeSubscription);
  const b = summarizeSubscription(before.data);
  const a = summarizeSubscription(after.data);
  observations.subscriptionStatus = { before: b?.status ?? null, after: a?.status ?? null };
  observations.nextBilledAt = { before: b?.next_billed_at ?? null, after: a?.next_billed_at ?? null };
  observations.scheduledChange = scheduledChangeDelta(b?.scheduled_change, a?.scheduled_change);
  save(ctx, "S-A", { subscriptionId: sub, variant: entry.variant, observations, steps: rec.steps });
  return "done";
}

// ─── S-B 실패 경로: 청구 없이 즉시 취소 ───────────────────────────────────────
async function scenarioB(ctx) {
  const entry = takeSub(ctx, "S-B");
  if (!entry) return "no-sub";
  const { client } = ctx;
  const rec = makeRecorder();
  const sub = entry.subscriptionId;
  await rec.step("get subscription (before)", () => client.subscriptions.get(sub), summarizeSubscription);
  await rec.step("cancel immediately", () => client.subscriptions.cancel(sub, buildCancelBody({ effectiveFrom: "immediately" })), summarizeSubscription);
  await sleep(SETTLE_MS); // 취소 직후 생성될 수 있는 거래까지 보려고 잠깐 기다린다
  const after = await rec.step("get subscription (after)", () => client.subscriptions.get(sub), summarizeSubscription);
  const txns = await listSubTransactions(client, sub);
  const observations = {
    subscriptionStatusAfter: summarizeSubscription(after.data)?.status ?? null,
    transactions: (txns ?? []).map(summarizeTransaction),
    zeroCharge: zeroChargeCheck(txns),
  };
  save(ctx, "S-B", { subscriptionId: sub, variant: entry.variant, observations, steps: rec.steps });
  return "done";
}

// ─── S-C cancel 예약 → /charge 가 예약을 건드리는지 ──────────────────────────
async function scenarioC(ctx) {
  const entry = takeSub(ctx, "S-C");
  if (!entry) return "no-sub";
  const { client } = ctx;
  const rec = makeRecorder();
  const sub = entry.subscriptionId;
  const priceId = priceIdOf(ctx.catalog, "build_once_199");
  await rec.step("get subscription (before)", () => client.subscriptions.get(sub), summarizeSubscription);
  await rec.step("schedule cancel at trial end", () => client.subscriptions.cancel(sub, buildCancelBody({ effectiveFrom: "next_billing_period" })), summarizeSubscription);
  const mid = await rec.step("get subscription (scheduled)", () => client.subscriptions.get(sub), summarizeSubscription);
  const charge = await rec.step("charge $199 immediately", () => client.subscriptions.charge(sub, buildChargeBody({ priceId })), summarizeSubscription);
  const txn = charge.ok ? await pollChargeTransaction(client, rec, sub, priceId) : null;
  const after = await rec.step("get subscription (after)", () => client.subscriptions.get(sub), summarizeSubscription);
  const observations = {
    scheduledCancelCreated: summarizeSubscription(mid.data)?.scheduled_change?.action === "cancel",
    chargeHttpOk: charge.ok,
    chargeErrorCode: charge.error?.code ?? null,
    transactionStatus: txn?.status ?? null,
    scheduledChange: scheduledChangeDelta(summarizeSubscription(mid.data)?.scheduled_change, summarizeSubscription(after.data)?.scheduled_change),
  };
  save(ctx, "S-C", { subscriptionId: sub, variant: entry.variant, observations, steps: rec.steps });
  return "done";
}

// ─── S-D 같은 구독에 두 번째 /charge ─────────────────────────────────────────
async function scenarioD(ctx) {
  const entry = findUsedBy(ctx.pool, "S-A");
  if (!entry) return waitFor("S-D 는 S-A 의 구독을 쓴다 — S-A 를 먼저 실행하세요");
  const { client } = ctx;
  const rec = makeRecorder();
  const sub = entry.subscriptionId;
  const priceId = priceIdOf(ctx.catalog, "repair_once_29");
  const known = new Set(((await listSubTransactions(client, sub, "subscription_charge")) ?? []).map((t) => t?.id));
  await rec.step("get subscription (before)", () => client.subscriptions.get(sub), summarizeSubscription);
  const charge = await rec.step("charge repair $29 immediately", () => client.subscriptions.charge(sub, buildChargeBody({ priceId })), summarizeSubscription);
  const txn = charge.ok ? await pollChargeTransaction(client, rec, sub, priceId, { knownIds: known }) : null;
  const after = await rec.step("get subscription (after)", () => client.subscriptions.get(sub), summarizeSubscription);
  const allCharges = (await listSubTransactions(client, sub, "subscription_charge")) ?? [];
  const observations = {
    chargeHttpOk: charge.ok,
    chargeErrorCode: charge.error?.code ?? null,
    transactionStatus: txn?.status ?? null,
    chargeTransactionsOnSubscription: allCharges.map(summarizeTransaction),
    subscriptionStatusAfter: summarizeSubscription(after.data)?.status ?? null,
  };
  save(ctx, "S-D", { subscriptionId: sub, variant: entry.variant, observations, steps: rec.steps });
  return "done";
}

// ─── S-E 전액 환불 Adjustment ────────────────────────────────────────────────
async function scenarioE(ctx, args) {
  const sa = readEvidence(ctx.evidenceDir, "S-A");
  const direct = sa && typeof sa === "object" ? /** @type {any} */ (sa).observations?.directCharge : null;
  const fallback = sa && typeof sa === "object" ? /** @type {any} */ (sa).observations?.activateFallback : null;
  const txnId = [direct?.transactionId, fallback?.transactionId].find((x) => typeof x === "string") ?? null;
  if (!txnId) return waitFor("S-E 는 S-A 에서 정산된 청구 거래가 필요합니다 — S-A 를 먼저(성공적으로) 실행하세요");
  const { client } = ctx;
  const rec = makeRecorder();
  const before = await rec.step("get transaction (before)", () => client.transactions.get(txnId), summarizeTransaction);
  const create = await rec.step(
    "create full refund adjustment",
    () => client.adjustments.create(buildFullRefundBody({ transactionId: txnId, reason: "Simsa sandbox spike S-E: full refund observation" })),
    summarizeAdjustment,
  );
  let adjustment = create.ok ? create.data : null;
  if (create.ok && args["no-wait"] !== true) {
    const deadline = Date.now() + 15 * 60_000; // 샌드박스는 10분 주기로 자동 승인(문서)
    while (Date.now() < deadline && adjustment && adjustment.status === "pending_approval") {
      await sleep(30_000);
      const list = await client.adjustments.list({ transaction_id: txnId });
      const found = Array.isArray(list.data) ? list.data.find((x) => x?.id === adjustment.id) : null;
      if (found) adjustment = found;
    }
  }
  const after = await rec.step("get transaction (after)", () => client.transactions.get(txnId), summarizeTransaction);
  const t0 = summarizeTransaction(before.data);
  const adj = summarizeAdjustment(adjustment);
  const observations = {
    transactionStatusBefore: t0?.status ?? null,
    transactionTotalsBefore: t0?.totals ?? null,
    transactionPayoutTotalsBefore: t0?.payout_totals ?? null,
    adjustment: adj,
    transactionAfter: summarizeTransaction(after.data),
    feeComparison: {
      originalFee: t0?.totals?.fee ?? null,
      adjustmentFee: adj?.totals?.fee ?? null,
      adjustmentPayoutFee: adj?.payout_totals?.fee ?? null,
      note: "MSA §10.4 는 환불 시 수수료 미반환이라 한다 — 이 숫자들로 샌드박스가 그렇게 처리하는지 대조",
    },
  };
  save(ctx, "S-E", { transactionId: txnId, observations, steps: rec.steps });
  return "done";
}

// ─── S-F 트라이얼 만료 전 미청구 구독의 최종 상태 ───────────────────────────
async function scenarioF(ctx, args) {
  const { client } = ctx;
  if (args.observe === true) {
    const started = readEvidence(ctx.evidenceDir, "S-F");
    const s = started && typeof started === "object" ? /** @type {any} */ (started) : null;
    if (!s || !Array.isArray(s.subs)) return waitFor("S-F 를 먼저 시작하세요(node scenarios.mjs S-F)");
    const ready = observeReadiness(s.expiresAt);
    if (!ready.ready) return waitFor(`S-F 관측은 아직 이릅니다 — 약 ${ready.minutesLeft}분 뒤 다시 실행하세요`);
    const rec = makeRecorder();
    const results = [];
    for (const item of s.subs) {
      const got = await rec.step(`get subscription ${item.role}`, () => client.subscriptions.get(item.subscriptionId), summarizeSubscription);
      const txns = await listSubTransactions(client, item.subscriptionId);
      results.push({
        role: item.role,
        subscriptionId: item.subscriptionId,
        finalStatus: summarizeSubscription(got.data)?.status ?? null,
        scheduledChange: summarizeSubscription(got.data)?.scheduled_change ?? null,
        transactions: (txns ?? []).map(summarizeTransaction),
        zeroCharge: zeroChargeCheck(txns),
      });
    }
    save(ctx, "S-F", { phase: "observed", expiresAt: s.expiresAt, subs: s.subs, observations: { results }, steps: [...(s.steps ?? []), ...rec.steps] });
    return "done";
  }
  const f1 = takeSub(ctx, "S-F1");
  const f2 = takeSub(ctx, "S-F2");
  if (!f1 || !f2) return "no-sub";
  const rec = makeRecorder();
  const expiresAt = new Date(Date.now() + 35 * 60_000);
  const shorten = buildTrialNextBilledAtBody({ nextBilledAt: expiresAt });
  for (const [role, entry] of [["F1-no-protection", f1], ["F2-scheduled-cancel", f2]]) {
    await rec.step(`shorten trial ${role}`, () => client.subscriptions.update(entry.subscriptionId, shorten), summarizeSubscription);
    if (role.startsWith("F2")) {
      await rec.step(`schedule cancel ${role}`, () => client.subscriptions.cancel(entry.subscriptionId, buildCancelBody({ effectiveFrom: "next_billing_period" })), summarizeSubscription);
    }
  }
  save(ctx, "S-F", {
    phase: "started",
    expiresAt: expiresAt.toISOString(),
    subs: [
      { role: "F1-no-protection", subscriptionId: f1.subscriptionId, variant: f1.variant },
      { role: "F2-scheduled-cancel", subscriptionId: f2.subscriptionId, variant: f2.variant },
    ],
    steps: rec.steps,
  });
  console.log(`  S-F 시작 — ${expiresAt.toISOString()} + 5분 뒤 \`node scenarios.mjs S-F --observe\``);
  return "done";
}

function verdict(evidenceDir) {
  const inputs = verdictInputsFrom({
    sa: readEvidence(evidenceDir, "S-A"),
    sb: readEvidence(evidenceDir, "S-B"),
    catalog: readEvidence(evidenceDir, "catalog"),
  });
  const result = decideBranch(inputs);
  writeEvidence(evidenceDir, "verdict", { spikeTag: SPIKE_TAG, decidedAt: new Date().toISOString(), inputs, ...result });
  console.log(`분기 판정: ${result.branch}`);
  for (const r of result.reasons) console.log(`  - ${r}`);
  return result;
}

const RUNNERS = { "S-A": scenarioA, "S-B": scenarioB, "S-C": scenarioC, "S-D": scenarioD, "S-E": scenarioE, "S-F": scenarioF };

async function main() {
  const argv = process.argv.slice(2);
  const which = argv[0];
  const args = parseArgs(argv.slice(1));
  const evidenceDir = evidenceDirFrom();
  if (which === "verdict") {
    verdict(evidenceDir);
    return;
  }
  if (typeof which !== "string" || (which !== "all" && !SCENARIOS.includes(which))) {
    console.error(`사용법: node scenarios.mjs <${[...SCENARIOS, "all", "verdict"].join("|")}> [--observe] [--allow-activate] [--no-wait]`);
    process.exit(2);
  }
  const vars = requireOrWait(["PADDLE_SANDBOX_API_KEY"]);
  if (vars === null) return;
  const apiKey = vars.PADDLE_SANDBOX_API_KEY ?? "";
  const rawCatalog = readEvidence(evidenceDir, "catalog");
  const parsed = rawCatalog === null ? null : parseCatalog(rawCatalog);
  if (!parsed || !parsed.ok) return waitFor("evidence/catalog.json 이 없거나 형식이 틀립니다 — 먼저 `node setup.mjs`");
  const ctx = {
    client: createPaddleClient({ apiKey }),
    catalog: parsed.catalog,
    evidenceDir,
    secrets: [apiKey, vars.PADDLE_SANDBOX_CLIENT_TOKEN ?? ""].filter((s) => s !== ""),
    pool: readEvidence(evidenceDir, "pool") ?? { entries: [] },
  };
  const list = which === "all" ? SCENARIOS : [which];
  for (const id of list) {
    console.log(`▶ ${id}`);
    const runner = RUNNERS[/** @type {keyof typeof RUNNERS} */ (id)];
    const out = await runner(ctx, args);
    if (out === "no-sub") {
      return waitFor(`${id}: 쓸 수 있는 trialing 구독이 풀에 없습니다 — \`node run-checkout.mjs --count 5\` 로 먼저 만드세요`);
    }
  }
  if (which === "all") verdict(evidenceDir);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`scenarios 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
