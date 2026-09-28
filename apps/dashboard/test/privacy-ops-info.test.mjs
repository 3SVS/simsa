/**
 * Train W — W-9 방침 고지 (재정렬 D-8·D-21 amend: 비식별 운영 메타는 **고지 후** 기록).
 *
 * 0069(C4a) 이후 서버는 검수·수리·프로젝트 행에 국가 코드·봉투·실패 코드·판정 라벨을 기록하는데
 * 개인정보처리방침 §1에는 그 항목이 없었다(가격·동의 계획 §4: "지금 고지 없이 기록 중[확정]").
 *
 * 이 테스트는 방침 문단을 **서버가 실제로 쓰는 것**에 묶는다:
 *   - apps/central-plane/migrations/0069 **이상 모든** 파일의 ADD COLUMN·CREATE TABLE이 고지 항목에
 *     대응하거나 NOT_OPS_META(운영 메타 아님, 이유 포함)에 있다 (P2-5)
 *   - 0055·0056의 프로젝트 행 P1 캡처 컬럼(만든 도구·진입 경로·앱 유형·유입 경로)이 대응 (P2-5)
 *   - apps/central-plane/src/workspace/envelope.ts 의 RunEnvelope 필드 전부가 고지 항목에 대응
 * 서버에 컬럼·테이블·봉투 필드가 늘었는데 방침이 그대로면 여기서 실패한다(고지 누락 = 버그).
 * 그리고 없는 기능을 약속하지 않는다: '기록 끄기' 토글은 아직 없다.
 *
 * ★머지 순서 (#558 검증 2차 P2-3) — 이 가드는 **대시보드 패키지 밖**(central-plane/migrations)을 읽는다.
 *  0069 이상 마이그레이션을 추가하는 PR(서버 PR 포함)은 **같은 PR에서** 고지 항목(src/lib/privacy-ops-info.mjs
 *  OPS_INFO_ITEMS의 columns)을 넣거나 아래 NOT_OPS_META에 이유와 함께 추가해야 한다. 두 PR이 각자 green이어도
 *  pull_request CI는 base가 바뀌면 다시 돌지 않으므로, 형제 PR이 먼저 머지되면 **CI를 다시 돌린 뒤** 머지한다.
 *
 * 표시 규칙(회귀 증거를 부풀리지 않는다 — #558 검증 P2-12 · 2차 P2-7):
 *   [서버 사실]  서버 소스를 읽어 방침 문장의 전제를 고정 — 옛 코드에서도 통과, 회귀 증거 아님.
 *   [가드]       하네스 자체 검사·전체 스캔 — 옛 코드에서도 통과, 회귀 증거 아님.
 *   표시 없음    고치기 전 코드에서 실패한다(고지 모듈이 없었고, §7 직함은 '대표이사'였다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const MIGRATIONS_DIR = path.join(REPO, "apps/central-plane/migrations");
const migration = readFileSync(path.join(MIGRATIONS_DIR, "0069_moat_envelope.sql"), "utf8");
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

// PR #558 검증 P1 — 방침 문구가 "서버가 실제로 저장하는 것"과 어긋났다:
//   ① 없는 'URL 추정'을 적었고(주소로 빌더를 알아내는 source-evidence.ts BUILDER_HOSTS는
//     infer-intent 응답으로만 돌려주고 저장하지 않는다),
//   ② 실제로 저장되는 '기타' 자유 입력·모델 메모(built-with.ts normalizeBuiltWith가 원문 보존)는 빠졌고,
//   ③ LEAD가 "입력하신 내용이 아니라"고 예외 없이 단정했고,
//   ④ '다시 확인 연결'이 사용자가 직접 한 경우만 말했다(verify-sweep 자동 재검수도 source_check_id를 찍는다).
// 서버 사실은 소스에서 읽어 고정한다 — 서버가 바뀌면 여기서 먼저 실패한다.
const CP = path.join(REPO, "apps/central-plane/src");
const builtWithTs = readFileSync(path.join(CP, "workspace/built-with.ts"), "utf8");
const workspaceRouteTs = readFileSync(path.join(CP, "routes/workspace.ts"), "utf8");
const verifySweepTs = readFileSync(path.join(CP, "workspace/verify-sweep.ts"), "utf8");
const builtWithItem = () => (ops.OPS_INFO_ITEMS ?? []).find((i) => (i.envelope ?? []).includes("builtWith"));

// PR #558 검증 P2-5 — 가드가 0069 한 파일에만 묶여 있어 "서버에 컬럼이 늘면 실패"가 0070 이후엔
// 성립하지 않았다. 0069 이상 **모든** 마이그레이션의 ADD COLUMN·CREATE TABLE을 모아, 고지하거나
// 아래 '운영 메타 아님' 목록에 이유와 함께 넣는 결정을 강제한다. 0069 이전의 P1 캡처 컬럼
// (0055·0056 — 만든 도구·진입 경로·앱 유형·유입 경로)도 봉투가 아니라 프로젝트 행에 따로 있으므로 명시 대응.
const OPS_MIGRATIONS_FROM = 69;

/** '운영 메타 아님' — 고지 대상이 아닌 새 컬럼/테이블. 넣을 때는 이유를 적는다. */
const NOT_OPS_META = new Map([
  // 예: ["build_verified", "수리 잡의 빌드 검사 결과 — 사람에 대한 값이 아님"],
]);

/** 0069 이전에 생겨 프로젝트 행에 저장되는 P1 운영 메타 컬럼(0055·0056). */
const PRE_0069_OPS_COLUMNS = ["built_with_json", "entry_path", "topic_tags_json", "acquisition_json"];

function migrationFilesFrom(n) {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) >= n)
    .sort();
}

/** 실행 문장(주석 제외)의 ADD COLUMN 이름과 CREATE TABLE 이름. */
function schemaAdditions(sql) {
  const out = new Set();
  for (const line of sql.split("\n")) {
    if (line.trim().startsWith("--")) continue;
    const col = /ADD COLUMN\s+(\w+)/i.exec(line);
    if (col) out.add(col[1]);
    const tbl = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/i.exec(line);
    if (tbl) out.add(`table:${tbl[1]}`);
  }
  return out;
}

/** 고지 항목(columns + envelope_json)·'운영 메타 아님' 어디에도 없는 추가분. */
function undisclosed(sqlTexts, items) {
  const covered = new Set(items.flatMap((i) => i.columns ?? []));
  covered.add("envelope_json"); // 봉투 필드 전부가 대응하는지는 따로 검사한다
  const out = [];
  for (const sql of sqlTexts) {
    for (const name of schemaAdditions(sql)) {
      if (!covered.has(name) && !NOT_OPS_META.has(name)) out.push(name);
    }
  }
  return out;
}

describe("P2-5: 0069 이후 모든 마이그레이션 + 0069 이전 P1 캡처 컬럼이 고지에 대응", () => {
  it("[가드] 0069 이상 마이그레이션의 ADD COLUMN·CREATE TABLE 전부가 고지되거나 '운영 메타 아님'에 이유와 함께 있다", () => {
    const files = migrationFilesFrom(OPS_MIGRATIONS_FROM);
    assert.ok(files.includes("0069_moat_envelope.sql"), files.join(","));
    const texts = files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    const missing = undisclosed(texts, ops.OPS_INFO_ITEMS ?? []);
    assert.deepEqual(
      missing,
      [],
      `고지 누락: ${missing.join(", ")} — 이 마이그레이션을 추가한 PR에서 apps/dashboard/src/lib/privacy-ops-info.mjs ` +
        `OPS_INFO_ITEMS(columns)에 고지 항목을 넣거나, apps/dashboard/test/privacy-ops-info.test.mjs NOT_OPS_META에 ` +
        `이유와 함께 추가하세요 (파일 머리말 '머지 순서' 참고).`,
    );
  });

  it("[가드] 가드가 실제로 잡는다 — 가상의 다음 마이그레이션이 운영 메타 컬럼·테이블을 더하면 누락으로 보고", () => {
    const hypothetical = [
      "ALTER TABLE workspace_visual_checks ADD COLUMN referrer_host TEXT;",
      "CREATE TABLE IF NOT EXISTS ops_meta_daily (id TEXT PRIMARY KEY);",
      "-- ALTER TABLE x ADD COLUMN commented_out TEXT;",
    ].join("\n");
    assert.deepEqual(undisclosed([hypothetical], ops.OPS_INFO_ITEMS ?? []), ["referrer_host", "table:ops_meta_daily"]);
  });

  it("0069 이전 P1 캡처 컬럼(0055·0056)도 항목에 대응한다 — 유입 경로(acquisition_json) 포함", () => {
    const pre = ["0055_project_builtwith_entrypath.sql", "0056_project_topic_acquisition.sql"]
      .map((f) => schemaAdditions(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
    for (const c of PRE_0069_OPS_COLUMNS) {
      assert.ok(pre.some((set) => set.has(c)), `baseline: ${c} exists in 0055/0056`);
    }
    const covered = new Set((ops.OPS_INFO_ITEMS ?? []).flatMap((i) => i.columns ?? []));
    const missing = PRE_0069_OPS_COLUMNS.filter((c) => !covered.has(c));
    assert.deepEqual(missing, [], `고지 누락: ${missing.join(", ")}`);
  });

  it("유입 경로 항목은 쉬운 말로 적는다", () => {
    const item = (ops.OPS_INFO_ITEMS ?? []).find((i) => (i.columns ?? []).includes("acquisition_json"));
    assert.ok(item, "acquisition item");
    assert.match(item.label, /유입 경로/);
  });
});

describe("P1: '만든 도구' 설명 = 서버가 실제로 저장하는 것", () => {
  it("[서버 사실] 프로젝트의 만든 도구는 클라이언트가 보낸 선택값 하나에서만 온다 (주소 추정값은 저장 경로가 없다)", () => {
    // upsertProject(…) 호출은 routes/workspace.ts 하나이고, builtWith 인자는 요청 본문이다.
    const writers = [...workspaceRouteTs.matchAll(/builtWith:\s*normalizeBuiltWith\(([^)]*)\)/g)].map((m) => m[1]);
    assert.deepEqual(writers, ['b["builtWith"]']);
    assert.match(envelopeTs, /const builtWith = project\?\.builtWith;/);
  });

  it("그래서 '추정'이라고 쓰지 않는다", () => {
    const item = builtWithItem();
    assert.ok(item, "builtWith item");
    assert.ok(!/추정/.test(item.detail), item.detail);
  });

  it("[서버 사실] '기타' 자유 입력과 모델 메모는 적은 그대로 보존된다 → 방침이 그 사실을 적는다", () => {
    assert.match(builtWithTs, /if \(other\) result\.other = other;/);
    assert.match(builtWithTs, /if \(modelNote\) result\.modelNote = modelNote;/);
    const item = builtWithItem();
    assert.ok(item, "builtWith item");
    assert.match(item.detail, /기타/, item.detail);
    assert.match(item.detail, /직접 적으신/, item.detail);
    assert.match(item.detail, /모델/, item.detail);
  });

  it("LEAD는 '입력하신 내용이 아니다'를 예외 없이 단정하지 않는다 — 기타 칸 예외를 적는다", () => {
    const lead = ops.OPS_INFO_LEAD ?? "";
    assert.match(lead, /기타 칸/, lead);
    assert.ok(!/입력하신 내용 같은 식별 정보가 아니라/.test(lead), lead);
  });

  it("[서버 사실] 자동 재검수(verify-sweep)도 source_check_id를 찍는다 → '다시 확인 연결'은 자동 경우를 포함해 적는다", () => {
    assert.match(verifySweepTs, /sourceCheckId:\s*origin\.id/);
    const item = (ops.OPS_INFO_ITEMS ?? []).find((i) => (i.columns ?? []).includes("source_check_id"));
    assert.ok(item, "source_check_id item");
    assert.match(item.detail, /자동/, item.detail);
  });
});

// PR #558 검증 P2-6 — 보유 문장이 "프로젝트 삭제 시 함께 삭제"를 조건 없이 단정했다. D1은 맞지만
// (deleteProject의 PROJECT_SCOPED_TABLES), 학습 데이터 제공에 동의한 사용자의 R2 사본
// (training-store events/{region}/… · journey-store journey/…)은 국가 코드·만든 도구를 담고,
// deleteProject는 checks/·docs/ 두 접두어만 지운다. 설계 §4: "유저→R2 키 인덱스가 없어 삭제 불가".
const dbTs = readFileSync(path.join(CP, "workspace/db.ts"), "utf8");
const trainingStoreTs = readFileSync(path.join(CP, "workspace/training-store.ts"), "utf8");

describe("P2-6: 보유 기간 — 학습 데이터 사본 예외를 적는다", () => {
  it("[서버 사실] 프로젝트 삭제는 checks/·docs/ 접두어만 지우고, 학습 사본(events/{region}/…)은 그 밖에 있다", () => {
    assert.match(dbTs, /for \(const prefix of \[`checks\/\$\{userKey\}\/\$\{id\}\/`, `docs\/\$\{userKey\}\/\$\{id\}\/`\]\)/);
    assert.match(trainingStoreTs, /return `events\/\$\{safeRegion\}\//);
  });

  it("§1 보유 문장: 삭제 범위를 한정하고 학습 데이터 사본은 지워지지 않는다고 적는다", () => {
    const s = ops.OPS_INFO_RETENTION ?? "";
    assert.match(s, /서비스 운영 기간/, s);
    assert.match(s, /학습 데이터 제공에 동의하신 경우/, s);
    assert.match(s, /지워지지 않/, s);
  });

  it("§3 보관과 파기도 같은 예외를 적는다 (§1과 §3이 서로 다르게 말하지 않게)", () => {
    const s3 = page.slice(page.indexOf("3. 보관과 파기"), page.indexOf("4. 저장 위치"));
    assert.ok(s3.length > 0, "§3 found");
    // 한 문장을 두 곳이 같이 쓴다 — 모듈 상수로 그리거나 같은 말을 직접 적는다.
    const saysIt = s3.includes("{TRAINING_COPY_NOTE}") || /학습 데이터 제공에 동의하신 경우/.test(s3);
    assert.ok(saysIt, s3);
    assert.match(ops.TRAINING_COPY_NOTE ?? "", /학습 데이터 제공에 동의하신 경우/);
    assert.match(ops.TRAINING_COPY_NOTE ?? "", /지워지지 않/);
  });
});

// PR #558 검증 P2-7 — "기록을 원하지 않으시면 문의 이메일로 요청"은 요청하면 기록이 멈추는 것처럼
// 읽혔다. 실제로는 regionFromRequest가 생성·검수·수리 요청마다 조건 없이 불리고 사용자별 제외
// 플래그가 없다(K-1 ops_meta_opt_out + 0071에서 생김). 그리고 익명 사용자는 화면에서 자기 키를 볼 수
// 없어 이메일에 무엇을 적어야 할지 모른다 → 요청이 **실제로 하는 일**과 **무엇을 적을지**를 말한다.
const repairRouteTs = readFileSync(path.join(CP, "routes/workspace-repair-jobs.ts"), "utf8");
const runRouteTs = readFileSync(path.join(CP, "routes/workspace-visual-check-runs.ts"), "utf8");

describe("P2-7: '원하지 않으시면' — 요청이 실제로 하는 일만 약속한다", () => {
  it("[서버 사실] 국가 코드는 요청마다 조건 없이 기록된다 (사용자별 제외 플래그 없음)", () => {
    for (const src of [workspaceRouteTs, runRouteTs, repairRouteTs]) {
      assert.match(src, /regionFromRequest\(c\.req\.raw\)/);
    }
    assert.ok(!/ops_meta_opt_out|opsMetaOptOut/.test(workspaceRouteTs + runRouteTs + repairRouteTs));
  });

  it("요청하면 지금까지 기록된 것을 지운다 — 앞으로의 기록을 멈춘다고 하지 않는다", () => {
    const s = ops.OPS_INFO_OPT_OUT ?? "";
    assert.match(s, /지금까지 기록된/, s);
    assert.match(s, /지워/, s);
    assert.ok(!/요청하시면[^.]*(멈추|멈춰|중단|기록하지 않)/.test(s), s);
  });

  it("앞으로의 기록을 끄는 설정은 '준비 중'이고, 그 전까지는 계속 기록된다고 말한다", () => {
    const s = ops.OPS_INFO_OPT_OUT ?? "";
    assert.match(s, /준비 중/, s);
    assert.match(s, /그 전까지는[^.]*기록/, s);
  });

  it("익명 사용자도 자기 기록을 특정할 수 있게 무엇을 적을지 알려 준다 (프로젝트 화면 주소)", () => {
    assert.match(ops.OPS_INFO_OPT_OUT ?? "", /프로젝트 화면의 주소/);
  });
});

// PR #558 검증 P2-8 — 시행일을 그 자리에서 바꾸면서 이전 시행일(2026-07-19)과 무엇이 바뀌었는지가
// 사라졌다. 설계 §4 처리방침 변경 목록: "시행일 갱신 + 변경 이력". 방침 변경 시 변경 내용·시행 시기를
// 계속 공개한다.
describe("P2-8: 변경 이력 — 이전 시행일과 바뀐 것을 남긴다", () => {
  it("변경 이력은 날짜 오름차순이고, 첫 줄은 최초 시행(2026-07-19), 마지막 줄 날짜 = 현재 시행일", () => {
    const log = ops.PRIVACY_CHANGE_LOG ?? [];
    assert.ok(Array.isArray(log) && log.length >= 2, "PRIVACY_CHANGE_LOG");
    for (const e of log) {
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(typeof e.summary === "string" && e.summary.trim().length > 0, e.date);
    }
    const dates = log.map((e) => e.date);
    assert.deepEqual([...dates].sort(), dates, "ascending");
    assert.equal(log[0].date, "2026-07-19");
    assert.equal(log[log.length - 1].date, ops.PRIVACY_EFFECTIVE_DATE);
  });

  it("이번 변경 줄은 무엇이 바뀌었는지 말한다 (§1 운영 정보 · §7 직함)", () => {
    const last = (ops.PRIVACY_CHANGE_LOG ?? []).at(-1)?.summary ?? "";
    assert.match(last, /운영 정보/);
    assert.match(last, /대표자/);
  });

  it("페이지가 변경 이력을 그린다", () => {
    assert.match(page, /변경 이력/);
    assert.match(page, /PRIVACY_CHANGE_LOG\.map\(/);
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
