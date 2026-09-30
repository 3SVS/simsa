/**
 * redos-linear-hardening.test.mjs — 밖에서 들어오는 입력을 훑는 정규식의 되돌아감(제곱 이상) 제거 (2026-10-01).
 *
 * 3a1ca07 실측(Node 24, 실제 함수 호출):
 *   - generate.detectSoloUse `로그인\s*(?:은)?\s*…`       '로그인'+공백 80K+'x' 5.6초 · answers(상한 없음) 160K 17.4초
 *   - probe-mailbox.extractLinks `[)\]>"'.,;]+$`          href="https://"+')'×64K 7.1초 · 256K 107초 (메일 원문 상한 500K)
 *   - email-notify.isValidEmailAddress `^[^\s@]+@[^\s@]+\.[^\s@]+$`  'a@'+'a.'×64K+'@' 6.6초 (길이 상한 없음)
 *   - source-evidence.textFromHtml (HTML 상한 200K)       '<h1'×n 15초 · '<a'×n 11.6초 · '<meta name="description"'×n 50K에서 57초
 *   - auth-signup-policy.isSignupPath `\/+$`               '/'×32K 0.66초 (엣지 URL 상한 16KB에서는 ~0.2초)
 *
 * 고정하는 계약:
 *   ① 같은 결과 — 옛 구현(아래에 원문 그대로 둠)과 새 구현을 실제 모양의 입력(한글 포함)과
 *      시드 고정 무작위 입력 수만 개에서 비교한다(차등 퍼징).
 *   ② 병적인 입력을 **워커 스레드**에서 돌려 호출 하나가 2초를 넘으면 실패(워커를 끊는다). 입력은 운영 상한 크기.
 *   ③ 입력 길이 상한: 인터뷰 답(30개 × 4,000자) · 이메일 주소(254자).
 *
 * 표시 규칙: [가드] = 옛 코드에서도 통과(동작 보존 가드) · [의도한 변화] = 옛 코드와 일부러 다른 곳 · 표시 없음 = 옛 코드에서 실패.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const dist = (p) => new URL(`../dist/${p}`, import.meta.url).href;

const generate = await import(dist("workspace/generate.js"));
const { isValidEmailAddress } = await import(dist("workspace/email-notify.js"));
const probeMailbox = await import(dist("probe-mailbox.js"));
const { textFromHtml } = await import(dist("workspace/source-evidence.js"));
const { isSignupPath } = await import(dist("auth-signup-policy.js"));

// ─── 옛 구현 (3a1ca07 원문) — 비교 기준 ─────────────────────────────────────────

const OLD_SOLO_MARKERS =
  /혼자|나\s*혼자|나만|내가?\s*쓰|개인용|개인\s*용도|본인만|자기만|로그인\s*(?:은)?\s*(?:필요\s*없|안\s*)|just\s+for\s+me|only\s+me|for\s+myself|personal\s+use|single[-\s]?user|no\s+(?:login|sign[-\s]?up|account)/i;
const MULTIUSER_MARKERS =
  /여러\s*(?:사람|명|사용자)|팀|조직|회사|직원|고객|손님|회원|가입자|멀티|multi[-\s]?user|team|organization|customers?|clients?|members?|employees?|users\s+(?:sign|log)/i;
function oldDetectSoloUse(req) {
  const text = [req.idea, req.context ?? "", ...(req.answers ?? []).map((a) => a.answer)].join(" ");
  if (MULTIUSER_MARKERS.test(text)) return false;
  return OLD_SOLO_MARKERS.test(text);
}

const oldIsValidEmailAddress = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function oldExtractLinks(body) {
  const seen = new Set();
  const out = [];
  const push = (raw) => {
    const url = raw.replace(/[)\]>"'.,;]+$/, "").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return;
    if (/unsubscribe|수신거부|opt[-_]?out|구독\s*취소/i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  for (const m of body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) push(m[1] ?? "");
  for (const m of body.matchAll(/https?:\/\/[^\s<>"']+/gi)) push(m[0]);
  return out.slice(0, 25);
}

function oldTextFromHtml(html) {
  const strip = (s) =>
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => strip(m[1] ?? ""))
    .filter(Boolean)
    .slice(0, 8);
  const parts = [desc, ...headings].filter(Boolean);
  const body = parts.length > 0 ? parts.join("\n") : strip(html).slice(0, 4000);
  return { ...(title ? { title } : {}), text: body.slice(0, 4000) };
}

function oldIsSignupPath(pathname) {
  if (typeof pathname !== "string") return false;
  const p = pathname.split("?")[0].replace(/\/+$/, "");
  return p === "/api/auth/sign-up" || p.startsWith("/api/auth/sign-up/");
}

// ─── 차등 퍼징 도구 (시드 고정 — 실패하면 같은 입력이 다시 나온다) ─────────────

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 0x100000000;
  };
}
function fuzz(seed, tokens, maxTokens, iterations, check) {
  const rnd = prng(seed);
  for (let i = 0; i < iterations; i++) {
    const n = Math.floor(rnd() * (maxTokens + 1));
    let s = "";
    for (let j = 0; j < n; j++) s += tokens[Math.floor(rnd() * tokens.length)];
    check(s);
  }
}

// ─── 병적 입력 시간 상한: 워커 스레드, 호출 하나 2초 ─────────────────────────

const LIMIT_MS = 2_000;
const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const mod = await import(workerData.modUrl);
  const input = new Function(workerData.gen)();
  const run = new Function("mod", "input", workerData.call);
  parentPort.postMessage({ type: "ready" });
  const t0 = performance.now();
  const out = await run(mod, input);
  const ms = performance.now() - t0;
  parentPort.postMessage({ type: "done", ms, out: JSON.stringify(out === undefined ? null : out).slice(0, 300) });
})().catch((e) => parentPort.postMessage({ type: "error", error: String((e && e.stack) || e) }));
`;

/** Runs `call` on the generated input in a worker; the 2 s budget starts after the input is built. */
function timeInWorker({ modUrl, gen, call }) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { modUrl, gen, call } });
    let timer = null;
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      w.terminate().then(() => resolve(r), () => resolve(r));
    };
    w.on("message", (m) => {
      if (m.type === "ready") timer = setTimeout(() => finish({ timedOut: true }), LIMIT_MS);
      else if (m.type === "done") finish({ timedOut: false, ms: m.ms, out: m.out });
      else if (m.type === "error") finish({ error: m.error });
    });
    w.on("error", (e) => finish({ error: String(e) }));
  });
}

async function assertLinear(c) {
  const r = await timeInWorker(c);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.timedOut, false, `${c.label ?? c.call}: over ${LIMIT_MS} ms (worker terminated)`);
  assert.ok(r.ms < LIMIT_MS, `${r.ms} ms`);
  return r;
}

// ─── ① generate.ts: SOLO_MARKERS ───────────────────────────────────────────────

test("[가드] ① detectSoloUse: 실제 모양의 한국어·영어 문장에서 옛 정규식과 같은 판정", () => {
  for (const idea of [
    "혼자 쓰는 가계부 앱",
    "로그인은 필요 없어요. 열면 바로 쓰는 메모장",
    "로그인 안 해도 되는 할 일 목록",
    "로그인필요없이 바로 시작",
    "로그인  은   필요   없음",
    "로그인은\n안 해요",
    "로그인이 필요한 회원제 쇼핑몰",
    "팀이 쓰는 로그인 없는 일정표",
    "just for me — a reading log",
    "동네 빵집 사전 예약 앱",
    "(주)트루픽셀 사내 장비 대여 — 직원 30명",
  ]) {
    for (const req of [{ idea }, { idea: "앱", answers: [{ questionId: "q1", answer: idea }] }, { idea: "앱", context: idea }]) {
      assert.equal(generate.detectSoloUse(req), oldDetectSoloUse(req), JSON.stringify(req));
    }
  }
});

test("[가드] ① detectSoloUse: 시드 고정 무작위 30,000개에서 옛 정규식과 같은 판정", () => {
  const tokens = ["로그인", "은", " ", "\t", "　", "\n", "필요", "없", "안", "요", "로그", "인", "필요 없", "x", "혼자", "팀", "나", "내가", "쓰"];
  fuzz(20261001, tokens, 12, 30_000, (s) => {
    assert.equal(generate.detectSoloUse({ idea: s }), oldDetectSoloUse({ idea: s }), JSON.stringify(s));
  });
});

test("① detectSoloUse: '로그인'+공백 80K+'x'(아이디어 상한) 한 번 호출 < 2초", async () => {
  await assertLinear({
    modUrl: dist("workspace/generate.js"),
    gen: `return { idea: "로그인" + " ".repeat(79996) + "x", answers: [] };`,
    call: `return mod.detectSoloUse(input);`,
  });
});

test("① detectSoloUse: '로그인'+공백 40K+'은'+공백 40K+'x' < 2초", async () => {
  await assertLinear({
    modUrl: dist("workspace/generate.js"),
    gen: `return { idea: "로그인" + " ".repeat(40000) + "은" + " ".repeat(40000) + "x" };`,
    call: `return mod.detectSoloUse(input);`,
  });
});

test("① detectSoloUse: 답 하나가 400K여도(함수 자체) < 2초", async () => {
  await assertLinear({
    modUrl: dist("workspace/generate.js"),
    gen: `return { idea: "a", answers: [{ questionId: "q", answer: "로그인" + " ".repeat(400000) + "x" }] };`,
    call: `return mod.detectSoloUse(input);`,
  });
});

test("① generateIdeaToSpecDraft(키 없음 → 목업 경로): 200K 답 5개를 받아도 < 2초", async () => {
  const r = await assertLinear({
    modUrl: dist("workspace/generate.js"),
    gen: `const a = "로그인" + " ".repeat(200000) + "x"; return { idea: "혼자 쓰는 가계부", answers: [1,2,3,4,5].map((i) => ({ questionId: "q" + i, answer: a })) };`,
    call: `return mod.generateIdeaToSpecDraft(input, undefined).then((d) => ({ ok: d.ok !== false }));`,
  });
  assert.match(r.out, /"ok":true/);
});

// ─── ③ 인터뷰 답 상한 ──────────────────────────────────────────────────────────

test("③ boundIdeaAnswers: 30개 · 답 4,000자 · questionId 200자 · 문자열 아닌 답은 버린다", () => {
  assert.equal(typeof generate.boundIdeaAnswers, "function", "generate.ts must export boundIdeaAnswers");
  assert.equal(generate.MAX_IDEA_ANSWERS, 30);
  assert.equal(generate.MAX_IDEA_ANSWER_CHARS, 4_000);
  const many = Array.from({ length: 31 }, (_, i) => ({ questionId: `q${i}`, answer: `답 ${i}` }));
  assert.equal(generate.boundIdeaAnswers(many).length, 30);
  const [long] = generate.boundIdeaAnswers([{ questionId: "질".repeat(201), answer: "가".repeat(4_001) }]);
  assert.equal(long.answer.length, 4_000);
  assert.equal(long.questionId.length, 200);
  assert.deepEqual(
    generate.boundIdeaAnswers([null, 3, "문자열", { questionId: "q", answer: 7 }, { answer: "주소 없이 답만" }, { questionId: "q2", answer: "네, 카드만요" }]),
    [{ questionId: "", answer: "주소 없이 답만" }, { questionId: "q2", answer: "네, 카드만요" }],
  );
  assert.deepEqual(generate.boundIdeaAnswers(undefined), []);
  assert.deepEqual(generate.boundIdeaAnswers({ answer: "배열 아님" }), []);
});

test("③ 평범한 답(한글·짧음)은 그대로 통과한다", () => {
  assert.equal(typeof generate.boundIdeaAnswers, "function", "generate.ts must export boundIdeaAnswers");
  const answers = [
    { questionId: "payment", answer: "카드만 받을게요 (주)트루픽셀 법인카드 포함" },
    { questionId: "who", answer: "저 혼자 씁니다" },
  ];
  assert.deepEqual(generate.boundIdeaAnswers(answers), answers);
});

// ─── ① email-notify.ts ─────────────────────────────────────────────────────────

test("[가드] ① isValidEmailAddress: 실제 모양의 주소(한글 포함)에서 옛 정규식과 같은 판정", () => {
  for (const e of [
    "hong@example.com",
    "홍길동@예시.한국",
    "trupixel.design+notify@example.co.kr",
    "a@b.c",
    "a@b",
    "a@.c",
    "a@b.",
    "@b.c",
    "a b@c.d",
    "a@b@c.d",
    "a@b..c",
    "a@.b.c",
    " a@b.c",
    "a@b.c\n",
    "a@b.c　",
    "",
  ]) {
    assert.equal(isValidEmailAddress(e), oldIsValidEmailAddress(e), JSON.stringify(e));
  }
});

test("[가드] ① isValidEmailAddress: 시드 고정 무작위 50,000개(254자 이하)에서 옛 정규식과 같은 판정", () => {
  const tokens = ["a", "b", "@", ".", "한", " ", "\t", "\n", " ", " ", "﻿", "　", "..", "@."];
  fuzz(4242, tokens, 14, 50_000, (s) => {
    assert.equal(isValidEmailAddress(s), oldIsValidEmailAddress(s), JSON.stringify(s));
  });
});

test("[의도한 변화] ③ isValidEmailAddress: 254자까지는 옛 판정 그대로, 255자부터는 거절(RFC 5321)", () => {
  const at254 = `${"a".repeat(254 - "@example.com".length)}@example.com`;
  assert.equal(at254.length, 254);
  assert.equal(isValidEmailAddress(at254), true);
  const at255 = `a${at254}`;
  assert.equal(oldIsValidEmailAddress(at255), true, "the old check accepted it");
  assert.equal(isValidEmailAddress(at255), false);
});

test("① isValidEmailAddress: 'a@'+'a.'×64K+'@'(128K) < 2초", async () => {
  const r = await assertLinear({
    modUrl: dist("workspace/email-notify.js"),
    gen: `return "a@" + "a.".repeat(64000) + "@";`,
    call: `return mod.isValidEmailAddress(input);`,
  });
  assert.equal(r.out, "false");
});

// ─── ① probe-mailbox.ts ────────────────────────────────────────────────────────

test("① trimTrailingLinkPunctuation: 시드 고정 무작위 30,000개에서 옛 `replace(/[)\\]>\"'.,;]+$/, \"\")`와 같은 결과", () => {
  assert.equal(typeof probeMailbox.trimTrailingLinkPunctuation, "function", "probe-mailbox.ts must export trimTrailingLinkPunctuation");
  const punct = [")", "]", ">", '"', "'", ".", ",", ";", "a", "/", "한", "\n", " ", "(", "["];
  fuzz(777, punct, 16, 30_000, (s) => {
    assert.equal(probeMailbox.trimTrailingLinkPunctuation(s), s.replace(/[)\]>"'.,;]+$/, ""), JSON.stringify(s));
  });
});

test("[가드] ① extractLinks: 시드 고정 무작위 20,000개 메일 본문에서 옛 구현과 같은 링크 목록", () => {
  const body =['href="', "href='", "HREF = '", "https://", "http://", "myapp.com/v/", "확인", ")", "]", ">", '"', "'", ".", ",", ";", " ", "\n", "&amp;", "unsubscribe", "?t=1"];
  fuzz(778, body, 18, 20_000, (s) => {
    assert.deepEqual(probeMailbox.extractLinks(s), oldExtractLinks(s), JSON.stringify(s));
  });
});

test("① extractLinks: 메일 원문 상한 500K의 href=\"https://\"+')'×n < 2초", async () => {
  await assertLinear({
    modUrl: dist("probe-mailbox.js"),
    gen: `return ('href="https://' + ")".repeat(499980) + 'x"').slice(0, 500000);`,
    call: `return mod.extractLinks(mod.decodeBodyForLinks(input)).length;`,
  });
});

test("① extractLinks: 본문 속 https://+')'×n(500K) < 2초", async () => {
  await assertLinear({
    modUrl: dist("probe-mailbox.js"),
    gen: `return ("https://" + ")".repeat(499980) + "x ").slice(0, 500000);`,
    call: `return mod.extractLinks(mod.decodeBodyForLinks(input)).length;`,
  });
});

// ─── ① source-evidence.ts: textFromHtml ─────────────────────────────────────────

const PAGES = [
  `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>주말 티타임 — 골프 예약</title>
<meta name="description" content="주말 티타임을 찾아주는 서비스입니다"><style>body{margin:0}</style>
<script>window.__NEXT_DATA__={"page":"/"}</script></head><body><h1 class="hero">빈 티타임을 한눈에</h1>
<h2>오늘 남은 자리</h2><p>서울&nbsp;경기 골프장</p></body></html>`,
  `<HTML><HEAD><TITLE lang=ko>(주)트루픽셀</TITLE><META NAME='description' CONTENT='사진 보정 — 서울대학교 로고.ai 포함'></HEAD>
<BODY><H1>사진 보정</H1><H2 id=x>가격표</H2></BODY></HTML>`,
  `<html><head><meta property="og:title" name="description" data-x="1" content="속성 순서가 달라도"></head><body>본문만 있는 페이지 &nbsp; 끝</body></html>`,
  `<meta content="내용이 먼저" name="description"><p>설명 없음 — 본문으로</p>`,
  `<meta name="description" content="첫째"><meta name="description" content="둘째"><h1><span>빵집</span> 예약</h1>`,
  `<head><title>제목만</title></head><body><script>if (a < b) { x() }</script><div>스크립트 뒤 본문</div></body>`,
  `<h1>열린 제목 <h2>안쪽</h2> 끝</h1><h1>닫히지 않은 제목`,
  `<meta name="description" content='값에 > 들어감'>`,
  ``,
];

test("[가드] ① textFromHtml: 실제 모양의 페이지(한글·대문자·홑따옴표·순서 바뀐 속성)에서 옛 정규식과 같은 결과", () => {
  for (const html of PAGES) assert.deepEqual(textFromHtml(html), oldTextFromHtml(html), html.slice(0, 80));
});

test("[가드] ① textFromHtml: 시드 고정 무작위 30,000개에서 옛 정규식과 같은 결과", () => {
  const tokens = [
    "<", ">", "<meta", "<META", " ", "name=", 'name="description"', "name='description'", 'NAME="DESCRIPTION"',
    "content=", 'content="', "content='", 'CONTENT="', '"', "'", "값", "x", "<title>", "</title>", "<TITLE", "<title a>",
    "<h1>", "</h1>", "<h2 class=a>", "</H2>", "<h3>", "</h3>", "<h", "</h1", "<script>", "</script>", "<SCRIPT",
    "</Script>", "<style>", "</style>", "&nbsp;", "\n", "<>", "a>b", " ", "İ", "ſ", "K",
  ];
  fuzz(9090, tokens, 24, 30_000, (s) => {
    assert.deepEqual(textFromHtml(s), oldTextFromHtml(s), JSON.stringify(s));
  });
});

const HTML_ATTACKS = [
  ["'<a'×n", `return "<a".repeat(100000);`],
  ["'<title>'×n", `return "<title>".repeat(28572).slice(0, 200000);`],
  ["'<h1'×n", `return "<h1".repeat(66667).slice(0, 200000);`],
  ["'<h1>'×n (닫는 짝 없음)", `return "<h1>".repeat(50000);`],
  ["'<meta'+' name=\"description\"'×n", `return ("<meta" + ' name="description"'.repeat(10600)).slice(0, 200000);`],
  ["'<meta name=\"description\"'×n", `return '<meta name="description"'.repeat(8334).slice(0, 200000);`],
  ["'<meta name=\"description\" content='×n (값 없음)", `return '<meta name="description" content='.repeat(6000).slice(0, 200000);`],
  ["'<script'×n", `return "<script".repeat(28572).slice(0, 200000);`],
  ["'<style'×n", `return "<style".repeat(33334).slice(0, 200000);`],
];

for (const [label, gen] of HTML_ATTACKS) {
  test(`① textFromHtml: ${label} — HTML 상한 200K 한 번 호출 < 2초`, async () => {
    await assertLinear({ label, modUrl: dist("workspace/source-evidence.js"), gen, call: `return mod.textFromHtml(input).text.length;` });
  });
}

test("① evidenceFromWebsite(실제 진입점, 가짜 fetch): 주인이 쓴 병적 HTML 200K도 < 2초", async () => {
  await assertLinear({
    modUrl: dist("workspace/source-evidence.js"),
    gen: `return '<meta name="description"'.repeat(20000);`,
    call: `return mod.evidenceFromWebsite("https://예시.한국/", async () => new Response(input, { status: 200 })).then((e) => e.readSources);`,
  });
});

// ─── ① auth-signup-policy.ts ───────────────────────────────────────────────────

test("[가드] ① isSignupPath: 시드 고정 무작위 30,000개에서 옛 정규식과 같은 판정", () => {
  const tokens = ["/", "api", "auth", "sign-up", "?", "x", "/api/auth/sign-up", "/api/auth/", "sign-up/", "%2F", "로그인"];
  fuzz(5151, tokens, 10, 30_000, (s) => {
    assert.equal(isSignupPath(s), oldIsSignupPath(s), JSON.stringify(s));
  });
  assert.equal(isSignupPath("/api/auth/sign-up///"), true);
  assert.equal(isSignupPath("/api/auth/sign-up/email?x=1"), true);
  assert.equal(isSignupPath("/api/auth/sign-in"), false);
});

test("① isSignupPath: '/api/auth/sign-up'+'/'×128K < 2초 (엣지 URL 상한은 16KB — 함수 자체의 차수 확인)", async () => {
  const r = await assertLinear({
    modUrl: dist("auth-signup-policy.js"),
    gen: `return "/api/auth/sign-up" + "/".repeat(128000) + "x";`,
    call: `return mod.isSignupPath(input);`,
  });
  assert.equal(r.out, "true");
});
