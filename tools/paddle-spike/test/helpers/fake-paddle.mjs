/**
 * `node --import ./test/helpers/fake-paddle.mjs <script>` — 메모리(파일) 가짜 Paddle 샌드박스.
 *
 * **글루 코드 스모크 전용.** 진짜 Paddle 동작의 증거가 아니다 — 이 가짜는 "trialing 에 /charge 가
 * 즉시 completed 거래를 만든다"고 **가정**한다. 그 가정의 진위는 샌드박스 실행(S-A)만 판정한다.
 *
 * 상태는 env PADDLE_FAKE_STATE(JSON 파일)에 둔다 — 스크립트가 프로세스마다 따로 뜨기 때문.
 * 샌드박스 origin 이 아니거나 Bearer 가 없으면 테스트가 드러나도록 500 을 돌려준다.
 * env PADDLE_FAKE_REJECT_ZERO=1 이면 $0 반복 가격 생성을 400 으로 거부한다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE = process.env.PADDLE_FAKE_STATE;
if (!STATE) throw new Error("PADDLE_FAKE_STATE 필요");

function load() {
  if (!existsSync(STATE)) return { seq: 0, products: [], prices: [], subscriptions: [], transactions: [], adjustments: [], calls: [] };
  return JSON.parse(readFileSync(STATE, "utf8"));
}
function save(s) {
  writeFileSync(STATE, JSON.stringify(s, null, 2), "utf8");
}
function newId(s, prefix) {
  s.seq += 1;
  return `${prefix}_${("fake" + s.seq.toString(36)).padEnd(26, "0")}`;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (status, data, extra = {}) => json(status, { data, meta: { request_id: "fake-req", ...extra } });
const err = (status, code, detail) => json(status, { error: { type: "request_error", code, detail }, meta: { request_id: "fake-req-err" } });

function addTxn(s, sub, price, origin) {
  const amount = String(price.unit_price.amount);
  const t = {
    id: newId(s, "txn"),
    status: "completed",
    origin,
    subscription_id: sub.id,
    currency_code: "USD",
    created_at: new Date().toISOString(),
    billed_at: new Date().toISOString(),
    items: [{ price: { id: price.id }, quantity: 1 }],
    details: { totals: { subtotal: amount, tax: "0", total: amount, grand_total: amount, fee: amount === "0" ? "0" : "1045", earnings: amount } },
    payments: [{ status: "captured", error_code: null, method_details: { card: { last4: "4242" } } }],
  };
  s.transactions.push(t);
  return t;
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = String(init.method ?? "GET");
  const headers = init.headers ?? {};
  if (url.origin !== "https://sandbox-api.paddle.com") return err(500, "fake_wrong_origin", url.origin);
  if (!String(headers.Authorization ?? "").startsWith("Bearer ")) return err(500, "fake_no_bearer", "");
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  const s = load();
  s.calls.push(`${method} ${url.pathname}`);
  const p = url.pathname;
  const q = url.searchParams;
  let res;
  let m;
  if (p === "/products" && method === "GET") res = ok(200, s.products, { pagination: { has_more: false, next: null } });
  else if (p === "/products" && method === "POST") {
    const prod = { id: newId(s, "pro"), status: "active", ...body };
    s.products.push(prod);
    res = ok(201, prod);
  } else if (p === "/prices" && method === "GET") {
    const ids = (q.get("product_id") ?? "").split(",").filter(Boolean);
    res = ok(200, s.prices.filter((x) => ids.length === 0 || ids.includes(x.product_id)), { pagination: { has_more: false, next: null } });
  } else if (p === "/prices" && method === "POST") {
    if (process.env.PADDLE_FAKE_REJECT_ZERO === "1" && body.unit_price.amount === "0" && body.billing_cycle) {
      res = err(400, "fake_zero_recurring_not_allowed", "zero");
    } else {
      const price = { id: newId(s, "pri"), status: "active", ...body };
      s.prices.push(price);
      res = ok(201, price);
    }
  } else if ((m = /^\/subscriptions\/([a-z0-9_]+)(\/.*)?$/.exec(p))) {
    const sub = s.subscriptions.find((x) => x.id === m[1]);
    const suffix = m[2] ?? "";
    if (!sub) res = err(404, "not_found", m[1]);
    else if (suffix === "" && method === "GET") res = ok(200, sub);
    else if (suffix === "" && method === "PATCH") {
      if ("scheduled_change" in body) sub.scheduled_change = body.scheduled_change;
      if (body.next_billed_at) sub.next_billed_at = body.next_billed_at;
      res = ok(200, sub);
    } else if (suffix === "/charge/preview") res = ok(200, { ...sub, immediate_transaction: { details: { totals: { grand_total: "19900" } } } });
    else if (suffix === "/charge") {
      if (!["trialing", "active"].includes(sub.status)) res = err(400, "subscription_locked", sub.status);
      else {
        for (const it of body.items) {
          const price = s.prices.find((x) => x.id === it.price_id);
          if (!price || price.billing_cycle) {
            res = err(400, "invalid_price", String(it.price_id));
            break;
          }
          addTxn(s, sub, price, "subscription_charge");
        }
        res = res ?? ok(201, sub);
      }
    } else if (suffix === "/cancel") {
      if (body.effective_from === "immediately") {
        sub.status = "canceled";
        sub.canceled_at = new Date().toISOString();
        sub.scheduled_change = null;
      } else sub.scheduled_change = { action: "cancel", effective_at: sub.next_billed_at, resume_at: null };
      res = ok(200, sub);
    } else if (suffix === "/activate") {
      sub.status = "active";
      res = ok(200, sub);
    } else res = err(404, "no_route", p);
  } else if (p === "/transactions" && method === "GET") {
    const subIds = (q.get("subscription_id") ?? "").split(",").filter(Boolean);
    const origins = (q.get("origin") ?? "").split(",").filter(Boolean);
    const list = s.transactions.filter((t) => (subIds.length === 0 || subIds.includes(t.subscription_id)) && (origins.length === 0 || origins.includes(t.origin)));
    res = ok(200, list, { pagination: { has_more: false, next: null } });
  } else if ((m = /^\/transactions\/([a-z0-9_]+)$/.exec(p))) {
    const t = s.transactions.find((x) => x.id === m[1]);
    res = t ? ok(200, t) : err(404, "not_found", m[1]);
  } else if (p === "/adjustments" && method === "POST") {
    const a = { id: newId(s, "adj"), status: "pending_approval", ...body, totals: { subtotal: "19900", total: "19900", fee: "1045", earnings: "18855", currency_code: "USD" } };
    s.adjustments.push(a);
    res = ok(201, a);
  } else if (p === "/adjustments" && method === "GET") {
    for (const a of s.adjustments) a.status = "approved";
    res = ok(200, s.adjustments.filter((a) => !q.get("transaction_id") || a.transaction_id === q.get("transaction_id")));
  } else res = err(404, "no_route", `${method} ${p}`);
  save(s);
  return res;
};
