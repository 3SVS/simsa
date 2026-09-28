/**
 * evidence.mjs — 증거 파일 쓰기/읽기 + trialing 구독 풀.
 *
 * 쓰기 순서(바꾸지 말 것): redact → JSON 직렬화 → assertNoLeak(두 번째 안전망) → mkdir → UTF-8 쓰기.
 * 누출이 남으면 파일을 만들기 전에 throw 한다. evidence/ 는 .gitignore 대상이다.
 *
 * 풀(evidence/pool.json): run-checkout 이 만든 trialing 구독 목록. 시나리오는 미사용 구독을 하나씩
 * 가져가며 usedBy 를 적는다. 같은 시나리오를 다시 돌리면 이미 쓴 구독을 다시 준다(재실행 멱등).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact, assertNoLeak } from "./redact.mjs";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SUB_ID = /^sub_[a-z\d]{26}$/;
const TXN_ID = /^txn_[a-z\d]{26}$/;
export const VARIANTS = Object.freeze(["trial19", "trial0"]);

function assertName(name) {
  if (typeof name !== "string" || !NAME.test(name) || name.includes("..")) {
    throw new TypeError("증거 이름은 영문·숫자·-·_·. 만(경로 구분자·'..' 금지)");
  }
  return name;
}

/**
 * @param {string} dir
 * @param {string} name  확장자 없이(예: "S-A")
 * @param {unknown} value
 * @param {{ secrets?: string[] }} [opts]
 * @returns {string} 쓴 파일 경로
 */
export function writeEvidence(dir, name, value, opts = {}) {
  assertName(name);
  const safe = redact(value, { secrets: opts.secrets });
  const text = JSON.stringify(safe, null, 2) + "\n";
  assertNoLeak(text, { secrets: opts.secrets });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  writeFileSync(path, text, "utf8");
  return path;
}

/** @returns {unknown|null} */
export function readEvidence(dir, name) {
  assertName(name);
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * pool.json 경계 검증. 형식이 틀린 항목은 버린다.
 * @returns {{ entries: { subscriptionId: string, transactionId: string|null, variant: string, createdAt: string, usedBy: string|null }[] }}
 */
export function parsePool(raw) {
  const entries = [];
  const list = raw !== null && typeof raw === "object" && Array.isArray(/** @type {any} */ (raw).entries) ? /** @type {any} */ (raw).entries : [];
  for (const e of list) {
    if (e === null || typeof e !== "object") continue;
    if (typeof e.subscriptionId !== "string" || !SUB_ID.test(e.subscriptionId)) continue;
    if (!VARIANTS.includes(e.variant)) continue;
    entries.push({
      subscriptionId: e.subscriptionId,
      transactionId: typeof e.transactionId === "string" && TXN_ID.test(e.transactionId) ? e.transactionId : null,
      variant: e.variant,
      createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
      usedBy: typeof e.usedBy === "string" ? e.usedBy : null,
    });
  }
  return { entries };
}

export function addToPool(pool, entry) {
  const cur = parsePool(pool);
  if (cur.entries.some((e) => e.subscriptionId === entry.subscriptionId)) return cur;
  return parsePool({ entries: [...cur.entries, { ...entry, usedBy: null }] });
}

export function findUsedBy(pool, scenario) {
  return parsePool(pool).entries.find((e) => e.usedBy === scenario) ?? null;
}

/**
 * @param {unknown} pool
 * @param {{ scenario: string, variant?: string }} want
 * @returns {{ entry: ReturnType<typeof parsePool>["entries"][number], pool: ReturnType<typeof parsePool>, reused: boolean } | null}
 */
export function takeFromPool(pool, want) {
  const cur = parsePool(pool);
  const already = cur.entries.find((e) => e.usedBy === want.scenario);
  if (already) return { entry: already, pool: cur, reused: true };
  const idx = cur.entries.findIndex((e) => e.usedBy === null && (want.variant === undefined || e.variant === want.variant));
  if (idx < 0) return null;
  const entries = cur.entries.map((e, i) => (i === idx ? { ...e, usedBy: want.scenario } : { ...e }));
  const entry = entries[idx];
  if (!entry) return null;
  return { entry, pool: { entries }, reused: false };
}
