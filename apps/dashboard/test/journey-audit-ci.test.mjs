/**
 * journey-audit-ci.test.mjs — PR #571 검증 결함 5 (2026-10-01): 여정 감사 규칙 테스트가 CI에서 돈다.
 *
 * `tools/simsa-completion-loop-spike`는 워크스페이스 패키지가 아니다(pnpm-workspace.yaml =
 * packages/* · apps/*). 그래서 `pnpm test`(turbo)는 그 폴더의 test/*.test.mjs를 한 번도
 * 돌리지 않았다 — 막다른 길 규칙(deadEndCheck)·같은 라벨·다른 목적지·초보자 심각도
 * (beginnerFindings)를 누가 약하게 바꿔도 CI는 초록으로 남는다. 대시보드의 흐름·카피가
 * 그 규칙으로 재어지므로, 배선 확인은 CI가 실제로 도는 이 패키지에 둔다.
 *
 * 규칙: 이 테스트는 수정 전(ci.yml에 해당 단계 없음) 코드에서 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const CI = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
const SPIKE_TESTS = new URL("../../../tools/simsa-completion-loop-spike/test/", import.meta.url);

test("ci.yml이 여정 감사 규칙 테스트(tools/simsa-completion-loop-spike/test/*.test.mjs)를 node --test로 돌린다", () => {
  assert.match(
    CI,
    /^\s*run:\s*node --test tools\/simsa-completion-loop-spike\/test\/\*\.test\.mjs\s*$/m,
    "ci.yml에 여정 감사 규칙 테스트 단계가 없다",
  );
});

test("그 폴더에 규칙 테스트가 실제로 있다 (빈 글롭이 조용히 통과하지 않게)", () => {
  const files = readdirSync(SPIKE_TESTS).filter((f) => f.endsWith(".test.mjs"));
  for (const f of ["journey-checks.test.mjs", "beginner-terms.test.mjs"]) {
    assert.ok(files.includes(f), `${f} 없음`);
  }
});

test("그 테스트들은 브라우저·설치 없이 돈다 — 테스트와 규칙 lib가 playwright를 불러오지 않는다 (CI는 그 폴더를 설치하지 않는다)", () => {
  const SPIKE_LIB = new URL("../lib/", SPIKE_TESTS);
  const sources = [
    ...readdirSync(SPIKE_TESTS).filter((f) => f.endsWith(".test.mjs")).map((f) => new URL(f, SPIKE_TESTS)),
    ...readdirSync(SPIKE_LIB).filter((f) => f.endsWith(".mjs")).map((f) => new URL(f, SPIKE_LIB)),
  ];
  assert.ok(sources.length > 2);
  for (const u of sources) {
    const src = readFileSync(u, "utf8");
    assert.doesNotMatch(src, /from\s+["']playwright["']|import\(\s*["']playwright["']\s*\)/, `${u.pathname}가 playwright를 불러온다`);
  }
});
