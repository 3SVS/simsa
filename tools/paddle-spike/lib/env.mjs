/**
 * env.mjs — 샌드박스 값 로딩 + "키 없음 — 실행 대기" 정직 종료.
 *
 * 값의 출처는 두 곳뿐이다: 프로세스 환경변수(PADDLE_* 만) > tools/paddle-spike/.env.local.
 * .env.local 은 .gitignore 대상이다. 이 모듈은 값을 **절대 출력하지 않는다** —
 * 없는 값의 **이름**만 말한다.
 *
 * 키가 없으면 스크립트는 네트워크를 한 번도 부르지 않고 EXIT_WAITING(3)으로 끝난다.
 * 0(성공)도 1(오류)도 아닌 별도 코드인 이유: "실행 대기"를 성공으로 세는 체인이
 * 생기지 않게 하기 위해서다(세 칸 보고의 '미측정'을 기계적으로 구분).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ENV_FILE = join(SPIKE_DIR, ".env.local");
export const DEFAULT_EVIDENCE_DIR = join(SPIKE_DIR, "evidence");
export const EXIT_WAITING = 3;
export const WAITING_MESSAGE = "키 없음 — 실행 대기";

const KEY_NAME = /^[A-Z][A-Z0-9_]*$/;

/** KEY=VALUE 줄 파서. 주석(#)·빈 줄·잘못된 줄은 버린다. 따옴표 한 겹은 벗긴다. */
export function parseEnvFile(text) {
  /** @type {Record<string,string>} */
  const out = {};
  if (typeof text !== "string") return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_NAME.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * 스파이크 값 로드. 프로세스 환경변수 중 PADDLE_ 로 시작하는 것만 파일 값을 덮는다.
 * @param {{ env?: Record<string, string|undefined>, envFile?: string }} [opts]
 */
export function loadSpikeEnv(opts = {}) {
  const env = opts.env ?? process.env;
  const envFile = opts.envFile ?? env.PADDLE_SPIKE_ENV_FILE ?? DEFAULT_ENV_FILE;
  /** @type {Record<string,string>} */
  let merged = {};
  if (typeof envFile === "string" && envFile !== "" && existsSync(envFile)) {
    merged = parseEnvFile(readFileSync(envFile, "utf8"));
  }
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("PADDLE_") && typeof v === "string" && v.trim() !== "") merged[k] = v.trim();
  }
  return merged;
}

/** @returns {{ ok: boolean, missing: string[] }} */
export function checkRequired(vars, names) {
  const missing = names.filter((n) => typeof vars[n] !== "string" || vars[n].trim() === "");
  return { ok: missing.length === 0, missing };
}

export function waitingReport(missing) {
  return [
    WAITING_MESSAGE,
    `  없는 값(이름만 표시): ${missing.join(", ")}`,
    "  → tools/paddle-spike/README.md 의 'Bae가 할 일' 3줄을 먼저 해 주세요.",
    "  네트워크 호출은 하지 않았습니다. 결과 문서의 해당 칸은 '실행 대기'로 둡니다.",
  ].join("\n");
}

/**
 * 필요한 값이 없으면 정직하게 끝낸다(네트워크 0). 있으면 값 묶음을 돌려준다.
 * 테스트는 log·exit 를 주입한다(실제 종료 없이 null 반환 확인).
 * @param {string[]} names
 * @param {{ env?: Record<string, string|undefined>, envFile?: string, log?: (s: string) => void, exit?: (code: number) => void }} [opts]
 */
export function requireOrWait(names, opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const exit = opts.exit ?? ((code) => process.exit(code));
  const vars = loadSpikeEnv(opts);
  const res = checkRequired(vars, names);
  if (!res.ok) {
    log(waitingReport(res.missing));
    exit(EXIT_WAITING);
    return null;
  }
  return vars;
}

/** 로컬 사전조건(카탈로그 없음 등)도 같은 규칙으로 끝낸다 — 성공으로 세지 않는다. */
export function waitFor(reason, opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const exit = opts.exit ?? ((code) => process.exit(code));
  log(`실행 대기 — ${reason}`);
  exit(EXIT_WAITING);
}

export function evidenceDirFrom(env = process.env) {
  const v = env.PADDLE_SPIKE_EVIDENCE_DIR;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : DEFAULT_EVIDENCE_DIR;
}

/** 이 파일이 `node <script>` 로 직접 실행됐는지(테스트 import 시에는 false). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  try {
    return pathToFileURL(resolve(entry)).href === importMetaUrl;
  } catch {
    return false;
  }
}

/** --key value / --flag 파서(의존성 없이). */
export function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== "string" || !a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      out[name] = next;
      i++;
    } else {
      out[name] = true;
    }
  }
  return out;
}
