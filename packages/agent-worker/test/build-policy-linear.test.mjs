/**
 * build-policy-linear.test.mjs — findSecretLike의 DB 주소 패턴 되돌아감 제거 (2026-10-01).
 *
 * 3a1ca07 실측: `/\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s'"]*:[^\s'"@]+@/i`는
 * 스킴이 공백·따옴표·`@` 없이 반복되면 세제곱 — `redis://x:` × 1,600(16KB) 한 파일에 25초.
 * 빌드 에이전트 create_file의 내용(최대 200KB, 모델이 쓰므로 프롬프트로 조종 가능)이 그대로 들어온다.
 *
 * 고정하는 계약:
 *   ① 옛 구현(아래 원문)과 **같은 반환값**(m[0].slice(0,12)+"…") — 실제 모양의 비밀·가짜 값과 시드 고정 무작위 입력.
 *   ② 병적 입력(200KB)을 워커 스레드에서 돌려 호출 하나가 2초를 넘으면 실패.
 * 표시: [가드] = 옛 코드에서도 통과 · 표시 없음 = 옛 코드에서 실패. 비밀처럼 보이는 값은 전부 가짜다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const MOD_URL = new URL("../dist/build-policy.js", import.meta.url).href;
const { findSecretLike } = await import(MOD_URL);

const OLD_SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bcfat_[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^\s'"]*:[^\s'"@]+@/i,
  /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{20,}["']/i,
];
function oldFindSecretLike(content) {
  for (const re of OLD_SECRET_PATTERNS) {
    const m = re.exec(content);
    if (m) return m[0].slice(0, 12) + "…";
  }
  return null;
}

test("[가드] findSecretLike: 실제 모양의 파일 내용(가짜 비밀·한글 주석)에서 옛 구현과 같은 반환값", () => {
  for (const content of [
    'const url = "postgres://app:FAKEpass0000@db.example.com:5432/빵집";',
    "REDIS_URL=redis://:FAKEpass@cache.example.com:6379 # 캐시",
    "mongodb+srv://user:FAKE@cluster0.example.net/test?retryWrites=true",
    "mysql://root@localhost/db  // 비밀번호 없음",
    "postgresql://localhost:5432/db",
    "// 연결 문자열은 환경변수로: process.env.DATABASE_URL",
    "redis://x:y@z redis://a:b@c",
    "xredis://a:b@c",
    "(redis://a:b@c)",
    "REDIS://a:b@c",
    'const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";',
    'password: "FAKEpasswordFAKEpassword00"',
    "",
  ]) {
    assert.equal(findSecretLike(content), oldFindSecretLike(content), content);
  }
});

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 0x100000000;
  };
}

test("[가드] findSecretLike: 시드 고정 무작위 40,000개에서 옛 구현과 같은 반환값(순서·자른 앞 12자까지)", () => {
  const tokens = [
    "redis://", "REDIS://", "postgres://", "postgresql://", "Postgres://", "mongodb+srv://", "mongodb://", "mongodb+srvx://",
    "mysql://", ":", "@", "x", " ", "'", '"', "a", "_", "user:pass@", "host", "/", "\t", ":@", "@:", "xredis://", "-redis://", "한",
  ];
  const rnd = prng(20261001);
  for (let i = 0; i < 40_000; i++) {
    const n = Math.floor(rnd() * 15);
    let s = "";
    for (let j = 0; j < n; j++) s += tokens[Math.floor(rnd() * tokens.length)];
    assert.equal(findSecretLike(s), oldFindSecretLike(s), JSON.stringify(s));
  }
});

// ─── 병적 입력: 워커 스레드, 호출 하나 2초 ───────────────────────────────────

const LIMIT_MS = 2_000;
const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const mod = await import(workerData.modUrl);
  const input = new Function(workerData.gen)();
  parentPort.postMessage({ type: "ready" });
  const t0 = performance.now();
  const out = mod.findSecretLike(input);
  parentPort.postMessage({ type: "done", ms: performance.now() - t0, out });
})().catch((e) => parentPort.postMessage({ type: "error", error: String((e && e.stack) || e) }));
`;

function timeInWorker(gen) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { modUrl: MOD_URL, gen } });
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

const MAX_FILE = 200 * 1024; // BUILD_LIMITS.maxFileBytes

for (const [label, gen] of [
  ["('redis://x:')×n", `return "redis://x:".repeat(Math.ceil(${MAX_FILE} / 10)).slice(0, ${MAX_FILE});`],
  ["'redis://'+':'×n", `return ("redis://" + ":".repeat(${MAX_FILE})).slice(0, ${MAX_FILE});`],
  // [가드] 끝에 '@'가 있어 일치가 금방 나는 긴 입력 — 옛 코드도 빠르다. 새 코드가 긴 일치에서도 선형인지만 본다.
  ["[가드] ('postgres://u:')×n + 끝에 '@'", `return ("postgres://u:".repeat(15000)).slice(0, ${MAX_FILE} - 1) + "@";`],
  ["재검사 공격 'R'+':REDIS://D'×n+'\\x00'+'::'×n+'\\tREDIS://:T@'", `const n = 8000; return "R" + ":REDIS://D".repeat(n) + "\\x00" + "::".repeat(n) + "\\tREDIS://:T@";`],
]) {
  test(`findSecretLike: ${label} — 파일 상한 200KB 한 번 호출 < 2초`, async () => {
    const r = await timeInWorker(gen);
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.timedOut, false, `over ${LIMIT_MS} ms (worker terminated)`);
    assert.ok(r.ms < LIMIT_MS, `${r.ms} ms`);
  });
}
