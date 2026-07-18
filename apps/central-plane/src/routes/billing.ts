/**
 * v0.14.5 — billing routes.
 *
 * Lemon Squeezy is the first wired provider (KR business + global MoR).
 * Routes:
 *   GET  /billing                  — HTML page with the buy button
 *   POST /billing/checkout         — body: { product, email? } → { url }
 *   GET  /billing/success          — landing after LS Checkout success
 *   GET  /billing/cancel           — landing after LS Checkout cancel
 *
 * The POST is unauthenticated by design: anyone can click the buy
 * button on the landing without logging in first. The webhook + the
 * pending-link flow in db/saas.ts:upsertUser handle credit assignment
 * after the fact — buyer signs up via CLI / GitHub App install later
 * and we claim their pending order by matching email.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { createCheckoutSession } from "../lemonsqueezy.js";
import { corsMiddleware } from "./cors.js";

// G6-1 (2026-07-19, Bae 확정 구조): Simsa 상품 3종 — 단건 협의체 $1/회(구 $3
// 패스 대체), Solo $19/월, Pro $49/월. variant env가 비어 있는 동안은 각 상품이
// 정직한 503으로 응답한다(결제 비활성 배선) — 활성화는 LS 상품 생성+env 설정만.
const KNOWN_PRODUCTS = ["first-pr-pass", "council-single", "solo-monthly", "pro-monthly"] as const;
type KnownProduct = (typeof KNOWN_PRODUCTS)[number];

function variantIdFor(env: Env, product: KnownProduct): string | undefined {
  if (product === "first-pr-pass") return env.LEMONSQUEEZY_VARIANT_ID_FIRST_PR;
  if (product === "council-single") return env.LEMONSQUEEZY_VARIANT_ID_COUNCIL_SINGLE;
  if (product === "solo-monthly") return env.LEMONSQUEEZY_VARIANT_ID_SOLO;
  if (product === "pro-monthly") return env.LEMONSQUEEZY_VARIANT_ID_PRO;
  return undefined;
}

export function createBillingRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  // G6-1: 대시보드(/pricing)가 브라우저에서 체크아웃을 호출한다 — 프리플라이트+CORS.
  app.use("/billing/*", corsMiddleware);

  // GET /billing — minimal landing-on-Worker page. The landing
  // (apps/landing) also renders a richer billing page; this one is
  // the fallback when someone lands directly on the Worker URL (e.g.
  // from a 402 credits-exhausted error pointing here).
  app.get("/billing", (c) => {
    const html = renderBillingHtml({
      configured: Boolean(c.env.LEMONSQUEEZY_API_KEY && c.env.LEMONSQUEEZY_STORE_ID),
    });
    return c.html(html);
  });

  // POST /billing/checkout — create Lemon Squeezy Checkout session.
  app.post("/billing/checkout", async (c) => {
    if (
      !c.env.LEMONSQUEEZY_API_KEY ||
      !c.env.LEMONSQUEEZY_STORE_ID
    ) {
      return c.json(
        { error: "billing_not_configured", error_description: "LS API key / store not set on the Worker." },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as
      | { product?: unknown; email?: unknown }
      | null;
    const product = typeof body?.product === "string" ? body.product : "first-pr-pass";
    if (!(KNOWN_PRODUCTS as readonly string[]).includes(product)) {
      return c.json({ error: "invalid_request", error_description: "unknown product" }, 400);
    }
    const variantId = variantIdFor(c.env, product as KnownProduct);
    if (!variantId) {
      return c.json(
        { error: "billing_not_configured", error_description: `variant id for '${product}' not set.` },
        503,
      );
    }
    const email = typeof body?.email === "string" ? body.email.slice(0, 320) : "";
    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;

    try {
      const session = await createCheckoutSession({
        apiKey: c.env.LEMONSQUEEZY_API_KEY,
        storeId: c.env.LEMONSQUEEZY_STORE_ID,
        variantId,
        ...(email ? { email } : {}),
        custom: {
          product_label: product,
        },
        successUrl: `${publicBaseUrl}/billing/success`,
      });
      return c.json({ url: session.url, checkout_id: session.checkoutId });
    } catch (err) {
      console.error("billing/checkout: LS create failed:", err);
      return c.json({ error: "checkout_failed" }, 502);
    }
  });

  app.get("/billing/success", (c) => {
    return c.html(renderSuccessHtml());
  });

  app.get("/billing/cancel", (c) => {
    return c.html(renderCancelHtml());
  });

  return app;
}

// ---- HTML renderers (self-contained, brand-aligned with saas-auth) ----

const SHARED_HEAD = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;0,600;1,500&family=Crimson+Pro:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" />
<style>
  :root {
    --parchment: #F4ECDC;
    --parchment-light: #FBF6E9;
    --parchment-line: #D9C9A6;
    --ink: #1A1310;
    --ink-subtle: #3D2E26;
    --ink-muted: #5C463A;
    --ink-mute: #7A685A;
    --oxblood: #5C111C;
    --oxblood-soft: #8E2C39;
    --gold: #9B7A30;
    --gold-light: #C7A554;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 24px;
    font-family: "Crimson Pro", Georgia, serif;
    color: var(--ink);
    background: var(--parchment);
    background-image:
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='2' stitchTiles='stitch' seed='3'/><feColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.07 0 0 0 0 0.05 0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>"),
      radial-gradient(ellipse 80% 50% at 50% 0%, rgba(155, 122, 48, 0.04), transparent 60%);
    background-size: 220px, 100% 100%;
    display: flex; align-items: center; justify-content: center;
  }
  .stage { width: 100%; max-width: 560px; text-align: center; animation: rise 600ms cubic-bezier(0.2,0,0.15,1); }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .marker {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ink-mute);
    display: flex; align-items: center; gap: 12px; margin: 0 0 24px;
  }
  .marker::before, .marker::after {
    content: ""; flex: 1; height: 1px;
    background: linear-gradient(90deg, transparent, var(--gold) 40%, var(--gold) 60%, transparent);
    opacity: 0.55;
  }
  h1 {
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-weight: 500;
    font-size: clamp(2rem, 4.5vw, 2.75rem);
    line-height: 1.05;
    letter-spacing: -0.01em;
    margin: 0 0 16px;
  }
  h1 em { font-style: italic; }
  .price {
    font-family: "Bodoni Moda", Bodoni, Didot, serif;
    font-weight: 500;
    color: var(--oxblood);
    font-size: 3.5rem; line-height: 1; margin: 24px 0 8px;
  }
  .price small { font-size: 14px; font-style: italic; color: var(--ink-mute); font-family: "Crimson Pro", serif; vertical-align: middle; }
  .body { font-size: 17px; line-height: 1.65; color: var(--ink-muted); max-width: 42ch; margin: 0 auto 28px; }
  .gold-rule { height: 2px; width: 56px; margin: 28px auto; background: linear-gradient(90deg, transparent, var(--gold) 30%, var(--gold-light) 50%, var(--gold) 70%, transparent); }
  .btn {
    display: inline-block;
    font-family: "Bodoni Moda", serif;
    font-size: 18px; font-weight: 500;
    background: var(--oxblood); color: var(--parchment);
    padding: 14px 28px; border-radius: 4px;
    text-decoration: none; cursor: pointer; border: 0;
    transition: background 200ms;
  }
  .btn:hover { background: var(--oxblood-soft); }
  .btn[disabled] { background: var(--ink-mute); cursor: not-allowed; }
  .meta {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ink-mute); margin-top: 40px;
  }
  .note { font-size: 13px; color: var(--ink-mute); margin-top: 16px; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; background: var(--parchment-light); border: 1px solid var(--parchment-line); padding: 2px 8px; border-radius: 3px; font-size: 0.9em; }
  .err {
    background: var(--parchment-light); border-left: 3px solid var(--oxblood);
    padding: 14px 18px; text-align: left;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px; color: var(--ink-subtle);
    margin: 24px auto; max-width: 480px;
  }
</style>`;

function renderBillingHtml(opts: { configured: boolean }): string {
  if (!opts.configured) {
    return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · Billing</title></head>
<body><main class="stage">
  <p class="marker">conclave ai · billing</p>
  <h1>Billing is <em>not yet</em> wired.</h1>
  <div class="gold-rule"></div>
  <p class="body">Paid plans land soon. Use the free BYO-Anthropic-key path for now — install the GitHub App and add your own API key for unlimited reviews.</p>
  <p class="note">If you need an invoice or want to talk pricing, reach <code>hi@conclave-ai.dev</code> or DM <code>@baessi1</code> on Threads.</p>
  <p class="meta">Conclave AI · MMXXVI</p>
</main></body></html>`;
  }
  return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · First-PR Pass</title></head>
<body><main class="stage">
  <p class="marker">conclave ai · first-pr pass</p>
  <h1>One full council review on <em>your</em> PR.</h1>
  <p class="price">$3 <small>once · no card on file</small></p>
  <div class="gold-rule"></div>
  <p class="body">
    A single council review — three frontier models (Claude + GPT-5 + Gemini) reading your pull request and your PRD, with deliberation. Verdict and dissents post to the PR as a check + comment. Includes tier-2 escalation if the council disagrees.
  </p>
  <p class="body">
    Enter the email you'll use for <code>conclave login</code>. After payment we credit your account; if you don't have an account yet, the credit waits for you to sign up.
  </p>
  <form id="buy" onsubmit="return go(event)">
    <input type="email" id="email" placeholder="you@your-email.com" required style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:14px;padding:10px 14px;border:1px solid var(--parchment-line);border-radius:4px;width:280px;max-width:100%;margin:0 0 12px;background:var(--parchment-light);color:var(--ink);" />
    <br>
    <button type="submit" class="btn" id="go">Buy first-PR pass · $3 →</button>
  </form>
  <p class="note" id="err" style="display:none;color:var(--oxblood);"></p>
  <p class="meta">Conclave AI · MMXXVI · Lemon Squeezy handles VAT</p>
  <script>
    async function go(e){
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const btn = document.getElementById('go');
      const err = document.getElementById('err');
      err.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Redirecting…';
      try {
        const r = await fetch('/billing/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ product: 'first-pr-pass', email })
        });
        const j = await r.json();
        if (!r.ok || !j.url) {
          err.style.display = 'block';
          err.textContent = j.error_description || j.error || 'Checkout could not be created. Try again in a moment.';
          btn.disabled = false; btn.textContent = 'Buy first-PR pass · $3 →';
          return false;
        }
        window.location.href = j.url;
      } catch (e) {
        err.style.display = 'block';
        err.textContent = 'Network error. Try again.';
        btn.disabled = false; btn.textContent = 'Buy first-PR pass · $3 →';
      }
      return false;
    }
  </script>
</main></body></html>`;
}

function renderSuccessHtml(): string {
  return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · Payment received</title></head>
<body><main class="stage">
  <p class="marker">conclave ai · audience granted</p>
  <h1>Your first-PR pass is <em>ready</em>.</h1>
  <p class="body">
    Payment confirmed. One paid review credit has been deposited to the email you entered.
  </p>
  <p class="body">
    If your CLI is already logged in, run <code>conclave review --pr &lt;N&gt; --use-saas</code> on a real PR and the credit applies automatically. If you don't have the CLI yet:
  </p>
  <p class="body" style="text-align:left;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;background:var(--parchment-light);border:1px solid var(--parchment-line);border-radius:3px;padding:14px 18px;">
    1. <code>npm i -g @simsa/cli</code><br>
    2. <code>conclave login</code> with the same email<br>
    3. <code>conclave review --pr &lt;N&gt; --use-saas</code>
  </p>
  <p class="meta">Habemus consensum · Conclave AI · MMXXVI</p>
</main></body></html>`;
}

function renderCancelHtml(): string {
  return `<!doctype html>
<html lang="en"><head>${SHARED_HEAD}<title>Conclave AI · Checkout cancelled</title></head>
<body><main class="stage">
  <p class="marker">conclave ai · session closed</p>
  <h1>The session was <em>cancelled</em>.</h1>
  <p class="body">No charge. Whenever you're ready, the first-PR pass is here.</p>
  <p style="margin-top:32px;"><a class="btn" href="/billing">Return to billing</a></p>
  <p class="meta">Conclave AI · MMXXVI</p>
</main></body></html>`;
}
