/**
 * d1-migrations-gate.test.mjs — PR #553 review P1: 0069 컬럼을 하드 참조하는 Worker가 0069 미적용 D1에
 * 배포되면 workspace 라우트 전체가 500. 문서 경고만 있고 강제 장치가 없었다 → 순서를 코드로 강제한다.
 *
 * 고정하는 계약:
 *   ① `wrangler d1 migrations list --remote` 출력 파서 — "No migrations to apply" → 통과, 미적용 파일명 → 실패,
 *      알아볼 수 없는 출력·비정상 종료 → 실패(fail-closed: "모른다"는 "적용됐다"가 아니다)
 *   ② deploy-central-plane 워크플로: 게이트 스텝이 `if:` 없이(항상) 'Deploy Worker' 앞에 있다 —
 *      `apply-migrations: false`로도 스키마보다 앞선 Worker를 내보낼 수 없다
 *   ③ `pnpm ship`(로컬 배포 경로)도 같은 게이트를 지난다
 *
 * wrangler는 실행하지 않는다(네트워크 없음) — 파서는 출력 문자열을, 워크플로는 YAML 텍스트를 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { parsePendingMigrations, evaluateMigrationsList } = await import("../scripts/d1-migrations-gate.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(here, "..", "..", "..", ".github", "workflows", "deploy-central-plane.yml");
const PKG = join(here, "..", "package.json");

const BANNER = " ⛅️ wrangler 4.83.0\n───────────────────\n";
const UP_TO_DATE = `${BANNER}✅ No migrations to apply!\n`;
const ONE_PENDING = `${BANNER}Migrations to be applied:\n┌────────────────────────┐\n│ name                   │\n├────────────────────────┤\n│ 0069_moat_envelope.sql │\n└────────────────────────┘\n`;
const TWO_PENDING = `${BANNER}Migrations to be applied:\n┌──────────────────────────┐\n│ name                     │\n├──────────────────────────┤\n│ 0068_org_hosting.sql     │\n│ 0069_moat_envelope.sql   │\n└──────────────────────────┘\n`;

// ─── ① parser ─────────────────────────────────────────────────────────────────

test("parsePendingMigrations: up to date → []; table rows → migration file names (sorted, deduped); banner noise ignored", () => {
  assert.deepEqual(parsePendingMigrations(UP_TO_DATE), []);
  assert.deepEqual(parsePendingMigrations(ONE_PENDING), ["0069_moat_envelope.sql"]);
  assert.deepEqual(parsePendingMigrations(TWO_PENDING), ["0068_org_hosting.sql", "0069_moat_envelope.sql"]);
  assert.deepEqual(parsePendingMigrations(`${ONE_PENDING}${ONE_PENDING}`), ["0069_moat_envelope.sql"]);
  assert.deepEqual(parsePendingMigrations(""), []);
  assert.deepEqual(parsePendingMigrations(undefined), []);
});

test("evaluateMigrationsList: passes ONLY on exit 0 + 'No migrations to apply'; pending names, non-zero exit and unrecognized output all refuse (fail-closed)", () => {
  const ok = evaluateMigrationsList({ status: 0, stdout: UP_TO_DATE, stderr: "" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.pending, []);

  const pending = evaluateMigrationsList({ status: 0, stdout: TWO_PENDING, stderr: "" });
  assert.equal(pending.ok, false);
  assert.deepEqual(pending.pending, ["0068_org_hosting.sql", "0069_moat_envelope.sql"]);
  assert.match(pending.reason, /0069_moat_envelope\.sql/);

  const crashed = evaluateMigrationsList({ status: 1, stdout: "", stderr: "✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN" });
  assert.equal(crashed.ok, false);
  assert.match(crashed.reason, /exited 1/);

  const weird = evaluateMigrationsList({ status: 0, stdout: `${BANNER}Something new wrangler prints\n`, stderr: "" });
  assert.equal(weird.ok, false, "unknown output must not be read as 'up to date'");
  assert.match(weird.reason, /could not recognize/i);

  // wrangler sometimes writes the banner to stderr and the verdict to stdout — both streams are read.
  const split = evaluateMigrationsList({ status: 0, stdout: "✅ No migrations to apply!\n", stderr: BANNER });
  assert.equal(split.ok, true);
  const splitPending = evaluateMigrationsList({ status: 0, stdout: "", stderr: ONE_PENDING });
  assert.equal(splitPending.ok, false);
  assert.deepEqual(splitPending.pending, ["0069_moat_envelope.sql"]);
});

// ─── ② workflow shape ───────────────────────────────────────────────────────────

test("deploy-central-plane workflow: an UNCONDITIONAL migrations-gate step runs before 'Deploy Worker' — apply-migrations=false cannot ship a Worker ahead of its schema", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const gateIdx = yml.indexOf("scripts/d1-migrations-gate.mjs");
  const deployIdx = yml.indexOf("name: Deploy Worker");
  assert.ok(gateIdx > 0, "gate step must be present in the workflow");
  assert.ok(deployIdx > 0, "Deploy Worker step present");
  assert.ok(gateIdx < deployIdx, "gate must run BEFORE the Worker deploy");
  const gateStepStart = yml.lastIndexOf("- name:", gateIdx);
  const gateStep = yml.slice(gateStepStart, deployIdx);
  assert.doesNotMatch(gateStep, /^\s*if:/m, "the gate step must have no `if:` — it always runs");
  // The migrations-apply step stays conditional (operator choice) — the gate is what makes the choice safe.
  const applyIdx = yml.indexOf("name: Apply D1 migrations");
  assert.ok(applyIdx > 0 && applyIdx < gateIdx, "apply step (conditional) precedes the gate, so a default run applies then verifies");
});

// ─── ③ local ship path ──────────────────────────────────────────────────────────

test("package.json `ship`: preflight → migrations gate → wrangler deploy, in that order", () => {
  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  const ship = pkg.scripts.ship;
  const i1 = ship.indexOf("scripts/preflight.mjs");
  const i2 = ship.indexOf("scripts/d1-migrations-gate.mjs");
  const i3 = ship.indexOf("wrangler deploy");
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, `ship must gate before deploying: ${ship}`);
  assert.match(ship, /&&/, "steps are chained with && so a refusal stops the deploy");
});
