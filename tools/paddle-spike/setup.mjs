#!/usr/bin/env node
/**
 * setup.mjs — 샌드박스에 상품 2개·가격 4개를 **멱등**으로 만든다.
 *
 *   node setup.mjs
 *
 * 필요한 값: PADDLE_SANDBOX_API_KEY (없으면 "키 없음 — 실행 대기", 종료 코드 3, 네트워크 0)
 * 결과: evidence/catalog.json(가격 id·상태, $0 가격 허용 여부) + evidence/setup.json(요청·응답 요약)
 *
 * 멱등: 모든 엔티티 custom_data 에 { spike, spike_key } — 만들기 전에 같은 키를 찾아 재사용한다.
 * probe 가격($0/월)은 거부돼도 계속 진행하고 status "rejected" 로 기록한다 — 거부 자체가 관측 결과.
 */
import { createPaddleClient } from "./paddle-client.mjs";
import { PRODUCTS, PRICES, SPIKE_TAG, findBySpikeKey, spikeCustomData } from "./lib/catalog.mjs";
import { buildPriceBody, buildProductBody } from "./lib/requests.mjs";
import { evidenceDirFrom, isMain, requireOrWait } from "./lib/env.mjs";
import { writeEvidence } from "./lib/evidence.mjs";
import { summarizeResult } from "./lib/observe.mjs";

/**
 * catalog.json 의 $0 가격 결과 → 분기 판정 입력.
 * @returns {boolean|null} true=허용, false=거부, null=미확인
 */
export function zeroPriceAcceptedFrom(catalog) {
  const p = catalog && typeof catalog === "object" ? /** @type {any} */ (catalog).prices?.card_trial_0 : null;
  if (!p || typeof p !== "object") return null;
  if (p.status === "rejected") return false;
  if (typeof p.id === "string" && (p.status === "created" || p.status === "existing")) return true;
  return null;
}

async function main() {
  const vars = requireOrWait(["PADDLE_SANDBOX_API_KEY"]);
  if (vars === null) return;
  const apiKey = vars.PADDLE_SANDBOX_API_KEY ?? "";
  const client = createPaddleClient({ apiKey });
  const evidenceDir = evidenceDirFrom();
  const steps = [];
  const record = (name, res) => {
    steps.push({ name, at: new Date().toISOString(), ...summarizeResult(res, (d) => (d && typeof d === "object" && !Array.isArray(d) ? { id: d.id, status: d.status } : null)) });
    return res;
  };

  // 1) 상품
  const existingProducts = await client.listAll("/products", { per_page: 200 });
  record("list products", existingProducts.last);
  if (!existingProducts.ok) throw new Error(`상품 목록 조회 실패(HTTP ${existingProducts.last?.status})`);
  /** @type {Record<string,string>} */
  const productIds = {};
  for (const p of PRODUCTS) {
    const found = findBySpikeKey(existingProducts.items, p.key);
    if (found && typeof found.id === "string") {
      productIds[p.key] = found.id;
      continue;
    }
    const res = record(
      `create product ${p.key}`,
      await client.products.create(buildProductBody({ name: p.name, description: p.description, taxCategory: p.taxCategory, customData: spikeCustomData(p.key) })),
    );
    if (!res.ok || !res.data || typeof res.data.id !== "string") throw new Error(`상품 생성 실패: ${p.key} (${res.error?.code ?? res.status})`);
    productIds[p.key] = res.data.id;
  }

  // 2) 가격
  const existingPrices = await client.listAll("/prices", { product_id: Object.values(productIds).join(","), per_page: 200 });
  record("list prices", existingPrices.last);
  if (!existingPrices.ok) throw new Error(`가격 목록 조회 실패(HTTP ${existingPrices.last?.status})`);
  /** @type {Record<string, { id: string|null, status: string, amountMinor: string, billingCycle: unknown, trialPeriod: unknown, error: unknown }>} */
  const prices = {};
  let hardFailures = 0;
  for (const pr of PRICES) {
    const base = { amountMinor: pr.amountMinor, billingCycle: pr.billingCycle, trialPeriod: pr.trialPeriod };
    const found = findBySpikeKey(existingPrices.items, pr.key);
    if (found && typeof found.id === "string") {
      prices[pr.key] = { id: found.id, status: "existing", ...base, error: null };
      continue;
    }
    const productId = productIds[pr.product];
    if (typeof productId !== "string") throw new Error(`상품 id 없음: ${pr.product}`);
    const res = record(
      `create price ${pr.key}`,
      await client.prices.create(
        buildPriceBody({
          productId,
          name: pr.name,
          description: pr.description,
          amountMinor: pr.amountMinor,
          billingCycle: pr.billingCycle,
          trialPeriod: pr.trialPeriod,
          customData: spikeCustomData(pr.key),
        }),
      ),
    );
    if (res.ok && res.data && typeof res.data.id === "string") {
      prices[pr.key] = { id: res.data.id, status: "created", ...base, error: null };
    } else {
      const error = { http: res.status, code: res.error?.code ?? null, detail: res.error?.detail ?? null, requestId: res.requestId };
      prices[pr.key] = { id: null, status: pr.probe ? "rejected" : "failed", ...base, error };
      if (!pr.probe) hardFailures += 1;
    }
  }

  const catalog = { spikeTag: SPIKE_TAG, updatedAt: new Date().toISOString(), products: productIds, prices };
  const zeroPriceAccepted = zeroPriceAcceptedFrom(catalog);
  writeEvidence(evidenceDir, "catalog", { ...catalog, zeroPriceAccepted }, { secrets: [apiKey] });
  writeEvidence(evidenceDir, "setup", { spikeTag: SPIKE_TAG, finishedAt: new Date().toISOString(), steps }, { secrets: [apiKey] });

  console.log("샌드박스 카탈로그");
  for (const [k, v] of Object.entries(prices)) console.log(`  ${k.padEnd(16)} ${v.status.padEnd(9)} ${v.id ?? "-"}${v.error ? `  (${v.error.code ?? v.error.http})` : ""}`);
  console.log(`  $0/월 반복 가격 허용: ${zeroPriceAccepted === null ? "미확인" : zeroPriceAccepted ? "예" : "아니오"}`);
  console.log(`증거: ${evidenceDir}`);
  if (hardFailures > 0) process.exit(1);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`setup 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
