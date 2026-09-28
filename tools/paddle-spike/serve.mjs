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
 * 이메일은 예약 도메인(example.com·.net·.org)만 받는다 — 오버레이 화면에 보이고, 그 화면 스크린샷은 가려지지 않는다.
 * API 키는 이 서버에 절대 들어오지 않는다 — 코드로 막는다: client-side token 은 허용 목록(test_ + 영숫자 27자)만 받고,
 * API 키(pdl_…)를 이 칸에 넣으면 서버를 띄우기 전에 거부한다(assertSandboxClientToken).
 * Host 헤더가 127.0.0.1/localhost:<포트> 가 아니면 403(DNS rebinding 방어, isSelfHost).
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

/**
 * 샌드박스 client-side token 형식 — Paddle 문서의 정규식 ^(test|live)_[a-zA-Z0-9]{27}$ 중 샌드박스 쪽만
 * (developer.paddle.com/paddle-js/about/client-side-tokens, 2026-09-28 접근 · 결과 문서 F13).
 */
const SANDBOX_CLIENT_TOKEN = /^test_[A-Za-z0-9]{27}$/;

/**
 * client-side token 은 **허용 목록**으로 받는다. 이 값은 /config.json 으로 서빙되고 브라우저의
 * Paddle.Initialize 로 들어가므로, 거부 목록(live_ 만 막기)이면 두 칸을 바꿔 넣는 실수로 서버 API 키가
 * 그대로 페이지에 실린다. 어떤 오류에도 값은 싣지 않는다.
 */
export function assertSandboxClientToken(token) {
  if (typeof token !== "string" || token.trim() === "") throw new TypeError("PADDLE_SANDBOX_CLIENT_TOKEN 이 비어 있습니다");
  const t = token.trim();
  if (/^live_/i.test(t)) {
    throw new SandboxOnlyError("라이브 client-side token(live_…)입니다 — 샌드박스 토큰(test_…)만 씁니다. 값은 출력하지 않았습니다");
  }
  if (/^pdl_/i.test(t)) {
    throw new TypeError(
      "PADDLE_SANDBOX_CLIENT_TOKEN 칸에 API 키(서버 비밀값, pdl_…)를 넣었습니다 — 이 값은 브라우저로 가므로 받지 않습니다. " +
        "API 키는 PADDLE_SANDBOX_API_KEY 에, client-side token(test_…)은 이 칸에 넣으세요. 값은 출력하지 않았습니다",
    );
  }
  if (!SANDBOX_CLIENT_TOKEN.test(t)) {
    throw new TypeError(
      "PADDLE_SANDBOX_CLIENT_TOKEN 이 샌드박스 client-side token 형식(test_ + 영숫자 27자)이 아닙니다 — " +
        "샌드박스 대시보드 Developer tools → Authentication → Client-side tokens 에서 복사하세요. 값은 출력하지 않았습니다",
    );
  }
  return t;
}

/** 체크아웃 기본 이메일 — 예약 도메인(RFC 2606). */
export const DEFAULT_CHECKOUT_EMAIL = "paddle-spike@example.com";

/**
 * 체크아웃에 미리 채울 수 있는 이메일 도메인: RFC 2606 예약 도메인(example.com·.net·.org)과 그 하위 도메인만.
 * 이유: Paddle 오버레이는 미리 채운 이메일을 화면에 보여 주고, run-checkout 의 스크린샷
 * (evidence/shots/*.png)은 이미지라 redact → assertNoLeak 를 거치지 않는다. 실제 주소가 PNG 에
 * 가려지지 않은 채 남는 길을 여기서 막는다(README §증거).
 */
const RESERVED_EMAIL_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*example\.(?:com|net|org)$/;
const EMAIL_LOCAL_PART = /^[A-Za-z0-9._%+-]{1,64}$/;

function assertCheckoutEmail(email) {
  // Paddle.js: 이메일은 올바른 형식이어야 하고 공백·비ASCII 불가(build-overlay-checkout, 2026-09-28 접근)
  if (typeof email !== "string" || !/^[\x21-\x7e]+@[\x21-\x7e]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new TypeError("체크아웃 이메일은 공백·비ASCII 없는 형식이어야 합니다(한글은 프로젝트명에만)");
  }
  const parts = email.split("@");
  const local = parts[0];
  const domain = parts[1];
  if (parts.length !== 2 || local === undefined || domain === undefined || !EMAIL_LOCAL_PART.test(local) || !RESERVED_EMAIL_DOMAIN.test(domain.toLowerCase())) {
    // 값은 싣지 않는다 — 막으려는 것이 바로 그 주소다.
    throw new TypeError(
      "체크아웃 이메일은 예약 도메인(example.com·example.net·example.org)만 씁니다 — 체크아웃 스크린샷(evidence/shots/*.png)은 가려지지 않으므로 실제 주소를 넣지 마세요. 값은 출력하지 않았습니다",
    );
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
  const email = assertCheckoutEmail(p.email ?? DEFAULT_CHECKOUT_EMAIL);
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

/**
 * Host 헤더가 이 서버 자신(127.0.0.1·localhost + 듣는 포트)인가.
 * 서버는 127.0.0.1 에만 붙지만, DNS rebinding(공격 페이지가 자기 도메인을 127.0.0.1 로 다시 풀게 하는 것)이면
 * 브라우저가 **그 도메인 이름**을 Host 로 싣고 이 서버를 부른다 → 이름이 다르면 거절한다.
 * 포트 80 이면 브라우저가 포트를 생략하므로 포트 없는 형태도 받는다.
 * @param {unknown} host @param {number} port
 */
export function isSelfHost(host, port) {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  const names = ["127.0.0.1", "localhost"];
  return names.some((n) => h === `${n}:${port}` || (port === 80 && h === n));
}

/** @returns {Promise<{ url: string, close: () => Promise<void> }>} */
export function startServer({ config, html, port = DEFAULT_PORT }) {
  const server = createServer((req, res) => {
    const addr = server.address();
    const listening = addr !== null && typeof addr === "object" ? addr.port : port;
    const plain = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
    let out;
    if (!isSelfHost(req.headers.host, listening)) {
      out = { status: 403, headers: plain, body: "forbidden host" };
    } else if (req.method !== "GET") {
      out = { status: 405, headers: plain, body: "method not allowed" };
    } else {
      out = routeRequest(new URL(req.url ?? "/", "http://127.0.0.1").pathname, { config, html });
    }
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
