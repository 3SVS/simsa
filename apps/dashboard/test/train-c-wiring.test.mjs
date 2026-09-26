/**
 * Train C — 화면 배선 정적 검사 (hydration-guard.test.mjs 방식: 소스를 grep 한다).
 *
 * 컴포넌트 렌더링은 node --test 범위 밖이라, "그 호출이 그 자리에 있는가"를 소스에서
 * 고정한다. 각 검사는 고치기 전 코드에서 실패한다.
 *
 *  C0-a  IntentConfirmCard.confirm()이 로컬 저장 뒤 mirrorLocalProjectToDb를 부른다
 *        (재정렬 §1 끊김 #1 — "맞나요?" 확정이 D1·검수 기준에 닿지 않았다)
 *  C0-b  리포트 상세의 재검수가 buildRecheckBody를 거친다 (끊김 #2 — 의도 유실)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

const card = readFileSync(path.join(SRC, "components/IntentConfirmCard.tsx"), "utf8");
const page = readFileSync(
  path.join(SRC, "app/projects/[id]/visual-checks/[runId]/page.tsx"),
  "utf8",
);

/** Body of `function confirm() { … }` in IntentConfirmCard (up to the next top-level `  }`). */
function confirmBody(src) {
  const start = src.indexOf("  function confirm()");
  assert.ok(start >= 0, "IntentConfirmCard has a confirm() function");
  const end = src.indexOf("\n  }\n", start);
  return src.slice(start, end);
}

test("C0-a: IntentConfirmCard.confirm()이 로컬 저장 뒤 mirrorLocalProjectToDb(projectId)를 부른다 (실패는 조용히)", () => {
  assert.match(card, /import \{ mirrorLocalProjectToDb \} from "@\/lib\/project-mirror"/);
  const body = confirmBody(card);
  const save = body.indexOf("saveExtendedProjectData(");
  const mirror = body.indexOf("mirrorLocalProjectToDb(projectId)");
  assert.ok(save >= 0, "confirm() saves extended data");
  assert.ok(mirror >= 0, "confirm() mirrors to D1");
  assert.ok(mirror > save, "mirror runs AFTER the local save — local is the source of truth");
  // 실패는 조용히: 로컬이 정본이므로 미러 실패가 확정을 막지 않는다.
  assert.match(body, /void mirrorLocalProjectToDb\(projectId\)\.catch\(\(\) => undefined\)/);
});

test("C0-b: 재검수가 buildRecheckBody(check, userKey, locale)를 거친다 — {userKey, locale}만 보내지 않는다", () => {
  assert.match(page, /import \{ buildRecheckBody \} from "@\/lib\/visual-check-recheck\.mjs"/);
  assert.match(page, /runVisualCheck\(projectId, buildRecheckBody\(check, userKey, locale\)\)/);
  assert.doesNotMatch(page, /runVisualCheck\(projectId, \{ userKey, locale \}\)/);
});
