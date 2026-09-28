#!/usr/bin/env node
/**
 * serve.mjs — checkout/index.html 을 127.0.0.1 에서만 서빙하는 최소 서버(샌드박스 체크아웃 전용).
 *
 *   node serve.mjs [--variant trial19|trial0] [--port 4817]
 *
 * 필요한 값: PADDLE_SANDBOX_CLIENT_TOKEN (없으면 "키 없음 — 실행 대기", 종료 코드 3)
 * 필요한 파일: evidence/catalog.json (node setup.mjs 가 만든다. 없으면 실행 대기)
 *
 * /config.json 으로 페이지에 넘기는 것: client-side token(공개 가능 토큰 — Paddle 문서 "safe to publish"),
 * 가격 id, 고객 미리 채움(가짜 이메일·국가·우편번호), customData(한글 프로젝트명).
 * API 키는 이 서버에 절대 들어오지 않는다.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SandboxOnlyError } from "./paddle-client.mjs";
import { CHECKOUT_VARIANTS, SPIKE_TAG, parseCatalog } from "./lib/catalog.mjs";
import { SPIKE_DIR, evidenceDirFrom, isMain, parseArgs, requireOrWait, waitFor } from "./lib/env.mjs";
import { readEvidence } from "./lib/evidence.mjs";

/** 실제 한국 유저가 넣을 법한 이름 — 공백·괄호·대시·한글(규칙 6). */
export const DEFAULT_PROJECT_NAME = "(주)트루픽셀 — 우리 동네 빵집 예약 앱";
export const DEFAULT_PORT = 4817;

export function assertSandboxClientToken(token) {
  if (typeof token !== "string" || token.trim() === "") throw new TypeError("PADDLE_SANDBOX_CLIENT_TOKEN 이 비어 있습니다");
  const t = token.trim();
  if (/^live_/i.test(t)) {
    throw new SandboxOnlyError("라이브 client-side token(live_…)입니다 — 샌드박스 토큰(test_…)만 씁니다. 값은 출력하지 않았습니다");
  }
  return t;
}

function assertCheckoutEmail(email) {
  // Paddle.js: 이메일은 올바른 형식이어야 하고 공백·비ASCII 불가(build-overlay-checkout, 2026-09-28 접근)
  if (typeof email !== "string" || !/^[\x21-\x7e]+@[\x21-\x7e]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new TypeError("체크아웃 이메일은 공백·비ASCII 없는 형식이어야 합니다(한글은 프로젝트명에만)");
  }
  return email;
}

/**
 * @param {{ clientToken: string, catalog: { prices: Record<string, {id: string|null, status: string}> }, variant: string,
 *           projectName?: string, email?: string, countryCode?: string, postalCode?: string }} p
 */
export function buildCheckoutConfig(p) {
  const clientToken = assertSandboxClientToken(p?.clientToken);
  const variant = p.variant;
  if (typeof variant !== "string" || !Object.hasOwn(CHECKOUT_VARIANTS, variant)) {
    throw new TypeError(`변형은 ${Object.keys(CHECKOUT_VARIANTS).join(" | ")} 중 하나`);
  }
  const priceKey = CHECKOUT_VARIANTS[/** @type {keyof typeof CHECKOUT_VARIANTS} */ (variant)];
  const price = p.catalog?.prices?.[priceKey];
  if (!price || typeof price.id !== "string" || price.status === "rejected") {
    throw new Error(`가격 ${priceKey} 이(가) 없거나 샌드박스에서 거부(rejected)됐습니다 — 이 변형은 열 수 없습니다`);
  }
  const projectName = typeof p.projectName === "string" && p.projectName.trim() !== "" ? p.projectName.trim() : DEFAULT_PROJECT_NAME;
  const email = assertCheckoutEmail(p.email ?? "paddle-spike@example.com");
  const countryCode = typeof p.countryCode === "string" && /^[A-Z]{2}$/.test(p.countryCode) ? p.countryCode : "US";
  const postalCode = typeof p.postalCode === "string" && p.postalCode.trim() !== "" ? p.postalCode.trim() : "10021";
  return {
    environment: "sandbox",
    clientToken,
    variant,
    priceId: price.id,
    customer: { email, address: { countryCode, postalCode } },
    customData: { spike: SPIKE_TAG, spike_key: "checkout", variant, simsa_project_name: projectName },
    settings: { displayMode: "overlay", theme: "light", locale: "ko" },
  };
}

/**
 * @param {string} pathname
 * @param {{ config: unknown, html: string }} ctx
 * @returns {{ status: number, headers: Record<string,string>, body: string }}
 */
export function routeRequest(pathname, ctx) {
  const base = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (pathname === "/" || pathname === "/index.html") {
    return { status: 200, headers: { ...base, "content-type": "text/html; charset=utf-8" }, body: ctx.html };
  }
  if (pathname === "/config.json") {
    return { status: 200, headers: { ...base, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(ctx.config) };
  }
  return { status: 404, headers: { ...base, "content-type": "text/plain; charset=utf-8" }, body: "not found" };
}

export function loadCheckoutHtml() {
  return readFileSync(join(SPIKE_DIR, "checkout", "index.html"), "utf8");
}

/** @returns {Promise<{ url: string, close: () => Promise<void> }>} */
export function startServer({ config, html, port = DEFAULT_PORT }) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const out = req.method === "GET" ? routeRequest(pathname, { config, html }) : { status: 405, headers: { "content-type": "text/plain" }, body: "method not allowed" };
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = addr !== null && typeof addr === "object" ? addr.port : port;
      resolvePromise({
        url: `http://127.0.0.1:${actualPort}/`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

/** 카탈로그 파일 → 검증된 카탈로그. 없으면 null. */
export function loadCatalog(evidenceDir) {
  const raw = readEvidence(evidenceDir, "catalog");
  if (raw === null) return null;
  const parsed = parseCatalog(raw);
  return parsed.ok ? parsed.catalog : null;
}

async function main() {
  const vars = requireOrWait(["PADDLE_SANDBOX_CLIENT_TOKEN"]);
  if (vars === null) return;
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog(evidenceDirFrom());
  if (catalog === null) return waitFor("evidence/catalog.json 이 없습니다 — 먼저 `node setup.mjs` 를 실행하세요");
  const config = buildCheckoutConfig({
    clientToken: vars.PADDLE_SANDBOX_CLIENT_TOKEN ?? "",
    catalog,
    variant: typeof args.variant === "string" ? args.variant : "trial19",
    projectName: vars.PADDLE_SPIKE_PROJECT_NAME,
    email: vars.PADDLE_SPIKE_CUSTOMER_EMAIL,
  });
  const port = typeof args.port === "string" && /^\d+$/.test(args.port) ? Number(args.port) : DEFAULT_PORT;
  const { url } = await startServer({ config, html: loadCheckoutHtml(), port });
  console.log(`체크아웃 페이지: ${url}  (변형 ${config.variant}, 샌드박스 전용) — Ctrl+C 로 종료`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error(`serve 실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
