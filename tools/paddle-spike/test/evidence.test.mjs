/**
 * 증거 쓰기 · 구독 풀. 파일 I/O 는 OS 임시 폴더에서만(네트워크 0).
 *  - 쓰기 전에 가린다 → 직렬화 뒤 누출 재검사 → UTF-8 로 쓴다(한글 보존, 규칙 6).
 *  - 증거 이름으로 경로를 빠져나갈 수 없다.
 *  - 풀: 체크아웃으로 만든 trialing 구독을 시나리오가 하나씩 소비(S-D·S-E 는 S-A 것을 재사용).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEvidence, readEvidence, parsePool, addToPool, takeFromPool, findUsedBy } from "../lib/evidence.mjs";
import { FAKE_SANDBOX_KEY, KO_PROJECT_NAME, fakeId } from "./helpers/fakes.mjs";

describe("writeEvidence", () => {
  it("가림 + 한글 보존 + 되읽기", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "paddle-ev-")), "evidence");
    const path = writeEvidence(
      dir,
      "S-A",
      { customer: { email: "bae.spike@example.com" }, custom_data: { simsa_project_name: KO_PROJECT_NAME }, note: `k=${FAKE_SANDBOX_KEY}` },
      { secrets: [FAKE_SANDBOX_KEY] },
    );
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes(KO_PROJECT_NAME), "한글 프로젝트명이 그대로 있어야 한다");
    assert.ok(!text.includes("example.com"));
    assert.ok(!text.includes(FAKE_SANDBOX_KEY));
    assert.equal(readEvidence(dir, "S-A").custom_data.simsa_project_name, KO_PROJECT_NAME);
    assert.equal(readEvidence(dir, "S-Z"), null);
  });
  it("이름으로 경로 탈출 금지", () => {
    const dir = mkdtempSync(join(tmpdir(), "paddle-ev2-"));
    for (const bad of ["../x", "a/b", "..", "", "S A"]) assert.throws(() => writeEvidence(dir, bad, {}), TypeError);
  });
});

describe("구독 풀", () => {
  const e = (seed, variant) => ({ subscriptionId: fakeId("sub", seed), transactionId: fakeId("txn", seed), variant, createdAt: "2026-10-01T00:00:00Z" });

  it("추가(중복 무시) → 미사용 하나 꺼내며 usedBy 기록", () => {
    let pool = addToPool({ entries: [] }, e("a", "trial19"));
    pool = addToPool(pool, e("a", "trial19"));
    pool = addToPool(pool, e("b", "trial0"));
    assert.equal(pool.entries.length, 2);
    const taken = takeFromPool(pool, { scenario: "S-B", variant: "trial0" });
    assert.equal(taken.entry.subscriptionId, fakeId("sub", "b"));
    assert.equal(taken.pool.entries.find((x) => x.subscriptionId === fakeId("sub", "b")).usedBy, "S-B");
    assert.equal(findUsedBy(taken.pool, "S-B").subscriptionId, fakeId("sub", "b"));
    assert.equal(pool.entries.find((x) => x.subscriptionId === fakeId("sub", "b")).usedBy, null, "원본 풀 불변");
  });
  it("같은 시나리오 재실행이면 이미 쓴 구독을 다시 준다(재실행 멱등)", () => {
    let pool = addToPool({ entries: [] }, e("a", "trial19"));
    pool = takeFromPool(pool, { scenario: "S-A" }).pool;
    const again = takeFromPool(pool, { scenario: "S-A" });
    assert.equal(again.entry.subscriptionId, fakeId("sub", "a"));
    assert.equal(again.reused, true);
  });
  it("남은 게 없으면 null", () => {
    const pool = takeFromPool(addToPool({ entries: [] }, e("a", "trial19")), { scenario: "S-A" }).pool;
    assert.equal(takeFromPool(pool, { scenario: "S-B" }), null);
  });
  it("pool.json 경계 검증: 형식이 틀린 항목은 버린다", () => {
    const parsed = parsePool({ entries: [e("a", "trial19"), { subscriptionId: "nope" }, null, { ...e("c", "weird") }] });
    assert.equal(parsed.entries.length, 1);
    assert.deepEqual(parsePool("garbage"), { entries: [] });
  });
});
