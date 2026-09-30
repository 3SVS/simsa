/**
 * _sqlite-d1.mjs — 실제 SQLite(D1과 같은 엔진) 위의 D1 모양 어댑터 (Train K 테스트 공용).
 *
 * `node --test test/*.test.mjs` 글롭에 잡히지 않는 이름(밑줄 + `.mjs`)이다.
 *
 * migrations/ 의 **모든** 파일을 번호순으로 적용한 메모리 DB를 연다 — 가짜 D1이 정규식으로 흉내내는 것과 달리
 * 문법·제약·ON CONFLICT·부분 인덱스·배치 원자성이 여기서만 증명된다.
 *
 * node:sqlite는 Node 22.13+/24에만 있다. 없으면 openSqliteD1()이 null을 돌려주고, 호출하는 테스트는
 * `{ skip }`으로 건너뛴다(건너뜀은 통과가 아니라 '미측정' — CI 매트릭스의 Node 20).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "migrations");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

/** `{ skip }` 값: node:sqlite가 없으면 이유 문자열. */
export const SQLITE_SKIP = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";

/** 번호순 마이그레이션 파일 이름(upTo가 있으면 그 번호까지). */
export function migrationFiles(upTo = Infinity) {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) <= upTo)
    .sort();
}

/**
 * D1 모양: prepare(sql).bind(...).first/all/run, batch([...]) (트랜잭션 — 하나라도 실패하면 전부 되돌림).
 * `log`에는 실행된 SQL이 순서대로 쌓인다(순서 검사용).
 */
export function d1FromSqlite(db, log = []) {
  function exec(sql, args, mode) {
    log.push(sql);
    const stmt = db.prepare(sql);
    if (mode === "run") {
      const r = stmt.run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    }
    if (mode === "first") return stmt.get(...args) ?? null;
    return { results: stmt.all(...args) };
  }
  function statement(sql, args = []) {
    return {
      _sql: sql,
      _args: args,
      bind: (...a) => statement(sql, a),
      async run() {
        return exec(sql, args, "run");
      },
      async first() {
        return exec(sql, args, "first");
      },
      async all() {
        return exec(sql, args, "all");
      },
    };
  }
  return {
    log,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => exec(s._sql, s._args, "run"));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** 모든 마이그레이션을 적용한 메모리 DB + D1 어댑터. node:sqlite가 없으면 null. */
export function openSqliteD1({ upTo = Infinity } = {}) {
  if (!DatabaseSync) return null;
  const db = new DatabaseSync(":memory:");
  for (const f of migrationFiles(upTo)) db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  const log = [];
  return { db, d1: d1FromSqlite(db, log), log };
}

/** 메모리 R2: put/get/delete/list + 호출 기록. failDelete(key)가 true면 그 키 delete는 던진다. */
export function makeMemoryR2({ failDelete = () => false } = {}) {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    async put(key, value) {
      calls.push(["put", key]);
      objects.set(key, typeof value === "string" ? value : String(value));
    },
    async get(key) {
      calls.push(["get", key]);
      const v = objects.get(key);
      return v === undefined ? null : { text: async () => v };
    },
    async delete(key) {
      calls.push(["delete", key]);
      if (failDelete(key)) throw new Error(`r2 delete failed: ${key}`);
      objects.delete(key);
    },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      calls.push(["list", prefix]);
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + limit);
      const end = start + page.length;
      return { objects: page.map((key) => ({ key })), truncated: end < all.length, cursor: String(end) };
    },
  };
}
