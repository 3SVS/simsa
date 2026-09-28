/**
 * Train L — 원장 SQL을 **실제 SQLite**(D1과 같은 엔진)에서 확인한다. 가짜 D1은 SQL을 정규식으로만 흉내내므로
 * 문법·충돌 처리·인덱스 사용은 여기서만 증명된다.
 *
 * node:sqlite는 Node 22.13+/24에만 있다(CI 매트릭스의 Node 20에서는 이 파일 전체를 건너뛴다 — 건너뜀은
 * 통과가 아니라 '미측정'이다).
 *
 *   ① 0070을 그대로 적용할 수 있다
 *   ② LLM_USAGE_INSERT_SQL(ON CONFLICT(id) DO NOTHING): 같은 id 두 번 → 1행, 다른 제약 위반(job_kind CHECK)은
 *      여전히 오류(충돌 처리가 PK에만 걸린다)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(here, "..", "migrations", "0070_llm_usage.sql"), "utf8"));
  return db;
}

const row = (o = {}) => {
  const base = {
    id: "lu_fixed_1", created_at: "2026-09-28T10:00:00.000Z", job_kind: "repair", job_id: "wrj_1", project_id: "wsp_빵집", user_key_hash: null,
    vendor: "openai", model_requested: "claude-sonnet-4-6", model_actual: "gpt-5.4-2026-03-05", call_site: null,
    input_tokens: 200, cache_read_tokens: 800, cache_write_tokens: 0, output_tokens: 50, cost_usd: 0.00145, unpriced: 0, latency_ms: 1500, container_seconds: null,
    ...o,
  };
  return base;
};
const COLS = [
  "id", "created_at", "job_kind", "job_id", "project_id", "user_key_hash", "vendor", "model_requested", "model_actual", "call_site",
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "cost_usd", "unpriced", "latency_ms", "container_seconds",
];

describe("실제 SQLite — 원장 INSERT", { skip }, () => {
  it("★ON CONFLICT(id) DO NOTHING: 같은 id 두 번 → 1행, 다른 제약 위반은 그대로 오류", async () => {
    const { LLM_USAGE_INSERT_SQL } = await import("../dist/workspace/llm-usage.js");
    assert.match(LLM_USAGE_INSERT_SQL, /ON CONFLICT\(id\) DO NOTHING$/);
    const db = freshDb();
    const stmt = db.prepare(LLM_USAGE_INSERT_SQL);
    const args = (r) => COLS.map((c) => r[c]);
    stmt.run(...args(row()));
    stmt.run(...args(row({ output_tokens: 999 }))); // 재전송(값이 달라도 먼저 온 행이 남는다)
    const rows = db.prepare("SELECT id, output_tokens, project_id FROM llm_usage").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].output_tokens, 50);
    assert.equal(rows[0].project_id, "wsp_빵집");
    assert.throws(() => stmt.run(...args(row({ id: "lu_fixed_2", job_kind: "없는종류" }))), /CHECK constraint failed/);
  });
});
