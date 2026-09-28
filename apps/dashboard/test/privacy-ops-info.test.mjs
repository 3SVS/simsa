/**
 * Train W — W-9 방침 고지 (재정렬 D-8·D-21 amend: 비식별 운영 메타는 **고지 후** 기록).
 *
 * 0069(C4a) 이후 서버는 검수·수리·프로젝트 행에 국가 코드·봉투·실패 코드·판정 라벨을 기록하는데
 * 개인정보처리방침 §1에는 그 항목이 없었다(가격·동의 계획 §4: "지금 고지 없이 기록 중[확정]").
 *
 * 이 테스트는 방침 문단을 **서버가 실제로 쓰는 것**에 묶는다:
 *   - apps/central-plane/migrations/0069_moat_envelope.sql 의 ADD COLUMN 전부가 고지 항목에 대응
 *   - apps/central-plane/src/workspace/envelope.ts 의 RunEnvelope 필드 전부가 고지 항목에 대응
 * 서버에 컬럼·봉투 필드가 늘었는데 방침이 그대로면 여기서 실패한다(고지 누락 = 버그).
 * 그리고 없는 기능을 약속하지 않는다: '기록 끄기' 토글은 아직 없다.
 *
 * 각 검사는 고치기 전 코드에서 실패한다(고지 모듈이 없었고, §7 직함은 '대표이사'였다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const migration = readFileSync(path.join(REPO, "apps/central-plane/migrations/0069_moat_envelope.sql"), "utf8");
const envelopeTs = readFileSync(path.join(REPO, "apps/central-plane/src/workspace/envelope.ts"), "utf8");
const page = readFileSync(path.join(HERE, "../src/app/legal/privacy/page.tsx"), "utf8");

const ops = await import("../src/lib/privacy-ops-info.mjs").catch(() => ({}));

/** 0069가 실제로 추가한 컬럼 이름 (주석 제외, 실행 문장만). */
function migrationColumns(sql) {
  const out = new Set();
  for (const line of sql.split("\n")) {
    if (line.trim().startsWith("--")) continue;
    const m = /ADD COLUMN\s+(\w+)/i.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** envelope.ts의 `export type RunEnvelope = { … };` 필드 이름. */
function envelopeFields(src) {
  const start = src.indexOf("export type RunEnvelope = {");
  assert.ok(start >= 0, "RunEnvelope type found");
  const body = src.slice(start, src.indexOf("};", start));
  return new Set([...body.matchAll(/^\s+(\w+)\s*:/gm)].map((m) => m[1]));
}

describe("W-9 고지 항목 ↔ 서버가 실제로 기록하는 것", () => {
  it("고지 모듈이 있다 (항목·목적·근거·보유·끄기 안내·시행일)", () => {
    assert.ok(Array.isArray(ops.OPS_INFO_ITEMS) && ops.OPS_INFO_ITEMS.length > 0, "OPS_INFO_ITEMS");
    for (const k of ["OPS_INFO_TITLE", "OPS_INFO_PURPOSE", "OPS_INFO_BASIS", "OPS_INFO_RETENTION", "OPS_INFO_OPT_OUT", "PRIVACY_EFFECTIVE_DATE"]) {
      assert.equal(typeof ops[k], "string", k);
      assert.ok(ops[k].trim().length > 0, k);
    }
  });

  it("0069의 컬럼 전부가 어떤 항목에 대응한다 (envelope_json은 봉투 필드 전부가 대응할 때)", () => {
    const cols = migrationColumns(migration);
    // 기준선: 0069가 말하는 컬럼(과제 계약) — 파서가 조용히 0개를 읽으면 이 검사가 무의미해진다.
    for (const c of ["region", "envelope_json", "finding_codes_json", "user_verdict", "source_check_id", "resolved"]) {
      assert.ok(cols.has(c), `0069 has ${c}`);
    }
    const items = ops.OPS_INFO_ITEMS ?? [];
    const covered = new Set(items.flatMap((i) => i.columns ?? []));
    const envCovered = new Set(items.flatMap((i) => i.envelope ?? []));
    const fields = envelopeFields(envelopeTs);
    assert.ok(fields.size >= 5, `RunEnvelope fields parsed: ${[...fields].join(",")}`);
    const missingEnv = [...fields].filter((f) => !envCovered.has(f));
    assert.deepEqual(missingEnv, [], `봉투 필드 고지 누락: ${missingEnv.join(", ")}`);
    covered.add("envelope_json");
    const missing = [...cols].filter((c) => !covered.has(c));
    assert.deepEqual(missing, [], `0069 컬럼 고지 누락: ${missing.join(", ")}`);
  });

  it("항목은 쉬운 말 이름과 설명을 갖는다 (컬럼 이름을 그대로 노출하지 않는다)", () => {
    assert.ok((ops.OPS_INFO_ITEMS ?? []).length > 0, "no items — nothing to check");
    for (const i of ops.OPS_INFO_ITEMS ?? []) {
      assert.equal(typeof i.label, "string");
      assert.equal(typeof i.detail, "string");
      assert.ok(!/_json|_id\b|region|envelope|verdict/.test(`${i.label} ${i.detail}`), `${i.label}: ${i.detail}`);
    }
  });

  it("필수 단어: 국가 코드·만든 도구·실패 유형·결과 판정 (+ 화면 언어·입력 언어·앱 유형·진입 경로·해결 여부)", () => {
    const text = (ops.OPS_INFO_ITEMS ?? []).map((i) => `${i.label} ${i.detail}`).join("\n");
    for (const w of ["국가 코드", "만든 도구", "실패 유형", "결과 판정", "화면 언어", "입력 언어", "앱 유형", "진입 경로", "해결 여부"]) {
      assert.ok(text.includes(w), `missing: ${w}`);
    }
  });

  it("국가 코드는 IP로 판별하되 IP 자체는 이 기록에 남기지 않는다고 말한다", () => {
    const region = (ops.OPS_INFO_ITEMS ?? []).find((i) => (i.columns ?? []).includes("region"));
    assert.ok(region, "region item");
    assert.match(region.detail, /IP/);
    assert.match(region.detail, /저장하지 않/);
  });

  it("목적·근거·보유는 계약대로", () => {
    assert.match(ops.OPS_INFO_PURPOSE ?? "", /실패 통계/);
    assert.match(ops.OPS_INFO_BASIS ?? "", /정당한 이익/);
    assert.match(ops.OPS_INFO_RETENTION ?? "", /서비스 운영 기간/);
  });

  it("없는 기능을 약속하지 않는다 — 끄기는 '준비 중', 요청은 문의 이메일로", () => {
    const s = ops.OPS_INFO_OPT_OUT ?? "";
    assert.match(s, /문의 이메일/);
    assert.match(s, /준비 중/);
    assert.ok(!/설정에서 (끌|끄실) 수 있/.test(s), s);
  });

  it("시행일은 YYYY-MM-DD 상수 한 곳 (배포일에 맞춰 이것만 바꾼다)", () => {
    assert.match(ops.PRIVACY_EFFECTIVE_DATE ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("W-9 방침 페이지 배선", () => {
  it("페이지가 고지 모듈을 가져와 항목을 모두 그린다", () => {
    assert.match(page, /from "@\/lib\/privacy-ops-info\.mjs"/);
    assert.match(page, /OPS_INFO_ITEMS\.map\(/);
    for (const k of ["OPS_INFO_TITLE", "OPS_INFO_PURPOSE", "OPS_INFO_BASIS", "OPS_INFO_RETENTION", "OPS_INFO_OPT_OUT"]) {
      assert.match(page, new RegExp(`\\{${k}\\}`), k);
    }
  });

  it("시행일은 상수로 — 날짜를 페이지에 박지 않는다", () => {
    assert.match(page, /\{PRIVACY_EFFECTIVE_DATE\}/);
    assert.ok(!/시행일: 20\d\d-/.test(page), "hard-coded effective date");
  });

  it("§7 직함은 '대표자' (대표이사 아님)", () => {
    assert.match(page, /대표자/);
    assert.ok(!page.includes("대표이사"), "still says 대표이사");
  });
});
