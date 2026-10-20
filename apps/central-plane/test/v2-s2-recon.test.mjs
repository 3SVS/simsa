// v2 S2 (2026-10-21, `train v2-S2 start approved.`) — 정찰: 첫 화면 즉시 판정 + 소스·번들 정적 사실.
// 완료 증거(설계 §5 S2): 파일럿 v0·Gemini 1차가 "고장(원인)"으로 끝남. 정적 사실 규칙은 사전 등록 실험(d1240c7) 그대로 + R3 보완.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const R = await import("../dist/recon.js");
const E = await import("../dist/evidence-chain.js");
const { collectRecon, visibleText } = await import("../inspector-container/recon-collect.mjs");

// 실제 호스트 안내 페이지의 화면 글자(2026-10-04 파일럿·2026-10-21 재확인).
const NETLIFY_404 = "Page not found Looks like you've followed a broken link or entered a URL that doesn't exist on this site. ← Back to our site If this is your site, and you weren't expecting a 404 for this path, please visit Netlify's \"page not found\" support guide for troubleshooting tips.";
const VERCEL_DEPLOYMENT_NOT_FOUND = "404: NOT_FOUND Code: DEPLOYMENT_NOT_FOUND ID: icn1::abcde-1760000000000-0123456789ab Read our documentation to learn more about this error.";

describe("첫 화면 즉시 판정 — 안내 페이지를 앱으로 보지 않는다", () => {
  it("Gemini 1차(Netlify 맨 위 404) → 고장 missing_index_file — 옛 v1은 지원 링크를 앱 버튼으로 눌렀다", () => {
    const v = R.reconEntry({ targetUrl: "https://stellar-mandazi-2a81dc.netlify.app/", status: 404, bodyText: NETLIFY_404 });
    assert.deepEqual(v.broken, { cause: "missing_index_file", status: 404 });
  });
  it("v0 1차(Vercel 배포 없음) → 고장 deployment_not_found", () => {
    const v = R.reconEntry({ targetUrl: "https://verifiy-sigma.vercel.app/", status: 404, bodyText: VERCEL_DEPLOYMENT_NOT_FOUND });
    assert.deepEqual(v.broken, { cause: "deployment_not_found", status: 404 });
  });
  it("호스트가 200으로 '배포 없음'을 보여도 고장", () => {
    assert.equal(R.reconEntry({ targetUrl: "https://x.vercel.app/", status: 200, bodyText: VERCEL_DEPLOYMENT_NOT_FOUND }).broken?.cause, "deployment_not_found");
  });
  it("401/403은 로그인 벽(고장 아님) · 5xx는 server_error · 빈 200은 blank_page · 정상 앱은 계속", () => {
    assert.deepEqual(R.reconEntry({ targetUrl: "https://a.app/", status: 403, bodyText: "Forbidden" }), { broken: null, loginWall: true });
    assert.equal(R.reconEntry({ targetUrl: "https://a.app/", status: 502, bodyText: "Bad gateway" }).broken?.cause, "server_error");
    assert.equal(R.reconEntry({ targetUrl: "https://a.app/", status: 200, bodyText: "  " }).broken?.cause, "blank_page");
    assert.deepEqual(R.reconEntry({ targetUrl: "https://a.app/", status: 200, bodyText: "동네 미용실 예약 이름 휴대폰 예약하기" }), { broken: null, loginWall: false });
  });
  it("긴 진짜 앱이 문서 안에서 'Page not found'를 언급해도 고장 아님(오탐 방지 — 기존 판별기 규칙 재사용)", () => {
    const longApp = `우리 앱 소개 ${"내용 ".repeat(400)} 도움말: Page not found 오류가 나면 새로고침하세요`;
    assert.equal(R.reconEntry({ targetUrl: "https://a.app/", status: 200, bodyText: longApp }).broken, null);
  });
});

describe("정적 사실 — 사전 등록 실험 규칙 + R3 보완", () => {
  const f = (url, text) => ({ url, text });
  it("chatgpt형: 연결 설정 안내 → R1 missing_backend_config, 현지 시간 보정된 날짜 코드는 R3 아님(실험 오발화 수정)", () => {
    const facts = R.extractStaticFacts([
      f("/app.js", 'if (!supabaseClient) { setMessage("관리자에게 사이트 연결 설정을 먼저 요청해주세요.", "error"); return; } const local = new Date(d - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10);'),
    ]);
    assert.deepEqual(facts.map((x) => x.rule), ["R1"]);
    assert.match(facts[0].excerpt, /연결 설정을 먼저/);
  });
  it("gemini형: localStorage 저장 + 서버 흔적 없음 → R2 · UTC 날짜 → R3", () => {
    const facts = R.extractStaticFacts([f("/", "function saveReservations(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } function initDateInputs() { const today = new Date().toISOString().split('T')[0]; }")]);
    assert.deepEqual(facts.map((x) => [x.rule, x.cls]), [["R2", "client_only_storage"], ["R3", "timezone_date"]]);
  });
  it("서버 쓰기 흔적이 있으면 R2 아님(로컬 캐시만 쓰는 정상 앱)", () => {
    const facts = R.extractStaticFacts([f("/a.js", "localStorage.setItem('draft', x); await fetch('/api/bookings', { method: 'POST' })")]);
    assert.ok(!facts.some((x) => x.rule === "R2"));
  });
  it("bolt형: 현지 자정을 UTC로 → R3", () => {
    const facts = R.extractStaticFacts([f("/assets/index.js", "p=new Date;p.setHours(0,0,0,0);const w=p.toISOString().slice(0,10),j=Array.from({length:14})")]);
    assert.deepEqual(facts.map((x) => x.rule), ["R3"]);
  });
  it("v0형: 보정된 클라이언트 날짜는 R3 아님 · 서버 액션 흔적 → R5 server_rendered_dates(서버 날짜 가설의 근거)", () => {
    const facts = R.extractStaticFacts([f("/_next/chunk.js", 'let t=e.getTimezoneOffset();return new Date(e.getTime()-t).toISOString().slice(0,10)}; createServerReference("7f3a", callServer)')]);
    assert.deepEqual(facts.map((x) => x.rule), ["R5"]);
  });
  it("Claude 파일럿형: 사용자 API 키 입력 → R4 needs_api_key", () => {
    const facts = R.extractStaticFacts([f("/", '<input id="key" placeholder="sk-ant-... 본인의 API 키를 입력하세요">')]);
    assert.deepEqual(facts.map((x) => x.rule), ["R4"]);
  });
  it("lovable형(정상, 서버 저장): 사실 없음 — 헛짚음 0", () => {
    assert.deepEqual(R.extractStaticFacts([f("/assets/index.js", "const { data } = await supabase.from('bookings').insert(row); const d = format(new Date(), 'yyyy-MM-dd');")]), []);
  });
  it("정적 사실은 증거물(kind source)로 남고 id로 인용된다", () => {
    const s = E.createEvidenceStore();
    const rec = R.recordStaticFacts(s, R.extractStaticFacts([f("/", "localStorage.setItem('k', v)")]));
    assert.equal(rec[0].artifactId, "E1");
    assert.equal(s.get("E1").kind, "source");
    assert.match(s.get("E1").raw, /localStorage\.setItem/);
  });
});

describe("수집기 — 같은 출처 GET만, 실행 없음, 상한", () => {
  let server;
  let base;
  const hits = [];
  before(async () => {
    server = createServer((req, res) => {
      hits.push(req.method + " " + req.url);
      const pages = {
        "/": '<!doctype html><html><body><h1>예약</h1><script src="/app.js"></script><script src="https://cdn.example.com/x.js"></script></body></html>',
        "/app.js": 'import("/chunk.js"); localStorage.setItem("b", "1");',
        "/chunk.js": 'import("/deeper.js"); const today = new Date().toISOString().slice(0, 10);',
        "/deeper.js": "// 2단계는 받지 않는다",
      };
      const body = pages[req.url];
      res.writeHead(body ? 200 : 404, { "content-type": req.url.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" });
      res.end(body ?? "Page not found Looks like you've followed a broken link");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/`;
  });
  after(() => server?.close());

  it("첫 화면 + 같은 출처 스크립트 + 동적 import 1단계, 외부 스크립트·2단계는 받지 않는다, GET만", async () => {
    const out = await collectRecon(base);
    assert.equal(out.entry.status, 200);
    assert.match(out.entry.bodyText, /예약/);
    assert.deepEqual(out.files.map((x) => new URL(x.url).pathname), ["/", "/app.js", "/chunk.js"]);
    assert.ok(hits.every((h) => h.startsWith("GET ")));
    assert.ok(!hits.some((h) => h.includes("deeper")), "2단계 import는 받지 않는다");
    const facts = R.extractStaticFacts(out.files);
    assert.deepEqual(facts.map((x) => x.rule), ["R2", "R3"]);
  });
  it("visibleText는 스크립트·태그를 걷어 낸다", () => {
    assert.equal(visibleText('<html><script>var x="숨김"</script><p>보임 &nbsp;글자</p></html>'), "보임 글자");
  });
});
