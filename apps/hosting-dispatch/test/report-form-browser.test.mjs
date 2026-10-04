/**
 * B-7 신고 폼 실브라우저 왕복 — PR #575 검증 P1-2·P1-3.
 *
 * 왜 브라우저인가: CSP `form-action`이 **303 리디렉트에도** 적용되는지, Referrer-Policy가 교차 origin 폼 전송의
 * Origin 헤더를 무엇으로 만드는지는 브라우저만 결정한다. 문자열 단언(hosting-duties.test.mjs)으로는 "Chromium이
 * 실제로 막는가"를 못 본다 — 예전 CSP는 신고를 저장하고도 신고자 화면을 막았다(서버 테스트는 전부 초록이었다).
 *
 * 가짜 두 origin(외부 네트워크 없음): 로컬 HTTPS 서버 하나(자체 서명 인증서 — 실행 때 openssl로 임시 폴더에
 * 만들고 지운다, 저장소에 키를 두지 않는다)가 Host로 갈라
 *   https://report.simsa.test/*        → 라우터 dist `handle()` (report 사이트)
 *   https://api.simsa-central.test/*   → central-plane dist `createApp().fetch()` (POST /hosting/report)
 * 로 넘긴다. 두 쪽 모두 실제 코드다. Chromium은 --host-resolver-rules로 두 이름을 그 서버로 보낸다.
 * (Playwright의 page.route는 리디렉트 뒤 요청을 가로채지 않아 303 복귀를 볼 수 없다 — 그래서 실제 서버.)
 *
 * Playwright·Chromium·openssl 중 하나라도 없으면(CI 기본 설치엔 브라우저가 없다) **건너뜀 = 미측정**으로 남긴다.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ROOT = "simsa.test";
const REPORT_HOST = `report.${ROOT}`;
const API_HOST = "api.simsa-central.test";
const REPORT = `https://${REPORT_HOST}`;
const API = `https://${API_HOST}`;

let chromium = null;
let skip = false;
try {
  const req = createRequire(path.join(REPO, "packages", "visual-review", "package.json"));
  ({ chromium } = req("playwright"));
} catch (e) {
  skip = `playwright 없음 — 미측정 (${String(e?.message ?? e).slice(0, 80)})`;
}

const router = await import("../dist/index.js");
const central = await import("../../central-plane/dist/router.js").catch(() => null);
if (!central && !skip) skip = "central-plane dist 없음 — 미측정";

/** 테스트 전용 자체 서명 인증서(임시 폴더, 끝나면 삭제). openssl이 없으면 null. */
function makeCert() {
  const candidates = ["openssl", "C:/Program Files/Git/mingw64/bin/openssl.exe", "C:/Program Files/Git/usr/bin/openssl.exe"];
  const dir = mkdtempSync(path.join(os.tmpdir(), "simsa-b7-cert-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  for (const bin of candidates) {
    if (bin !== "openssl" && !existsSync(bin)) continue;
    const r = spawnSync(bin, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=simsa.test", "-addext", `subjectAltName=DNS:${REPORT_HOST},DNS:${API_HOST}`], { encoding: "utf8" });
    if (r.status === 0 && existsSync(cert)) return { dir, key: readFileSync(key), cert: readFileSync(cert) };
  }
  rmSync(dir, { recursive: true, force: true });
  return null;
}

/** central-plane 신고 경로가 쓰는 D1 문장만 흉내(요청 한도 슬롯은 늘 성공, build_jobs에 slug 있음). */
function fakeD1() {
  const inserts = [];
  return {
    inserts,
    prepare(sql) {
      const h = (args) => ({
        async run() {
          if (sql.startsWith("INSERT INTO hosting_reports")) inserts.push(args);
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes("FROM build_jobs WHERE slug")) return { found: 1 };
          if (sql.includes("COUNT(*)")) return { n: 0 };
          return null;
        },
        async all() {
          return { results: [] };
        },
      });
      return { bind: (...a) => h(a), ...h([]) };
    },
  };
}

describe("신고 폼 실브라우저 왕복(가짜 두 origin, 로컬 HTTPS)", { skip }, () => {
  let browser = null;
  let server = null;
  let port = 0;
  let certInfo = null;
  let notReady = null;
  const DB = fakeD1();
  const seenOrigins = [];
  const seenReferers = [];

  before(async () => {
    certInfo = makeCert();
    if (!certInfo) {
      notReady = "openssl 없음 — 미측정";
      return;
    }
    const routerEnv = { HOSTING_ROOT_DOMAIN: ROOT, SIMSA_API_BASE: API, HOSTING_REPORTS_ENABLED: "on", DISPATCHER: { get() { throw new Error("no user app"); } } };
    const centralEnv = { DB, ENVIRONMENT: "test", HOSTING_ROOT_DOMAIN: ROOT, HOSTING_REPORTS_ENABLED: "on", CONCLAVE_TOKEN_KEK: "dGVzdC1rZWstbm90LWEtcmVhbC1zZWNyZXQtMzJieXQ=" /* 가짜 값 */ };
    const app = central.createApp({});
    server = https.createServer({ key: certInfo.key, cert: certInfo.cert }, (req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        try {
          const host = String(req.headers.host ?? "").split(":")[0];
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !k.startsWith(":")) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
          const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks);
          let out;
          if (host === REPORT_HOST) {
            out = await router.handle(new Request(`${REPORT}${req.url}`, { method: req.method, headers, body }), routerEnv);
          } else if (host === API_HOST) {
            seenOrigins.push(req.headers.origin ?? null);
            seenReferers.push(req.headers.referer ?? null);
            headers.set("cf-connecting-ip", "203.0.113.7");
            out = await app.fetch(new Request(`${API}${req.url}`, { method: req.method, headers, body }), centralEnv);
          } else {
            out = new Response("unknown host", { status: 421 });
          }
          const h = {};
          out.headers.forEach((v, k) => {
            h[k] = v;
          });
          res.writeHead(out.status, h);
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (e) {
          res.writeHead(500);
          res.end(String(e));
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    try {
      browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${REPORT_HOST} 127.0.0.1:${port}, MAP ${API_HOST} 127.0.0.1:${port}`] });
    } catch (e) {
      notReady = `Chromium 실행 불가 — 미측정 (${String(e?.message ?? e).split("\n")[0]})`;
    }
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    if (certInfo) rmSync(certInfo.dir, { recursive: true, force: true });
  });

  it("◆제출 → 303 → '신고가 접수됐어요'까지 브라우저가 따라간다 · CSP 위반 0 · API가 받은 Origin = 신고 사이트 · 한글 설명 그대로 저장 (8097ac2: form-action이 303 복귀를 막음)", async (t) => {
    if (notReady || !browser) {
      t.skip(notReady ?? "브라우저 없음 — 미측정");
      return;
    }
    const context = await browser.newContext({ locale: "ko-KR", ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const violations = [];
    page.on("console", (m) => {
      if (/Content Security Policy|form-action/i.test(m.text())) violations.push(m.text());
    });
    await page.goto(`${REPORT}/?app=bakery-pickup-1&lang=ko`);
    await page.check('input[name="reason"][value="phishing"]');
    await page.fill('textarea[name="description"]', "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요");
    await page.click('button[type="submit"]');
    let landed = true;
    try {
      await page.waitForURL(/sent=1/, { timeout: 8000 });
    } catch {
      landed = false;
    }
    const finalUrl = page.url();
    const text = await page.textContent("body").catch(() => "");
    await context.close();

    // 한 번에 비교한다 — 옛 코드에서 어느 칸이 틀리는지 전부 보이게(첫 단언에서 멈추지 않게).
    assert.deepEqual(
      {
        saved: DB.inserts.length,
        description: DB.inserts[0]?.[3] ?? null,
        origins: seenOrigins, // strict-origin — 브라우저가 Origin을 신고 사이트로 싣는다('null' 아님)
        referers: seenReferers, // Referer는 origin만(?app= 경로·쿼리 없음)
        cspViolations: violations,
        landedOnSent: landed, // 303 복귀를 브라우저가 따라갔나
        confirmationShown: /신고가 접수됐어요/.test(String(text)),
      },
      {
        saved: 1,
        description: "(주)트루픽셀 예약 앱이라더니 카드 번호를 물어봐요",
        origins: [REPORT],
        referers: [`${REPORT}/`],
        cspViolations: [],
        landedOnSent: true,
        confirmationShown: true,
      },
      `최종 ${finalUrl}`,
    );
  });
});
