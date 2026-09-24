/**
 * 하이드레이션 가드 (2026-09-25 라이브 E2E: /login React #418).
 *
 * 원인: AppSidebar가 렌더 중 `const userKey = typeof window !== "undefined" ? getUserKey() : ""`로
 * 분기해 서버("C")와 클라이언트 첫 렌더("M")가 다른 글자를 그렸다. 검수 리포트가 우리 대시보드에서
 * 찾아낸 실결함이었다.
 *
 * 규칙: 컴포넌트 본문 최상위(2칸 들여쓰기)에서 `const x = typeof window !== "undefined" ? … : …` 금지.
 * 이펙트·핸들러 안(더 깊은 들여쓰기)은 허용 — 렌더 결과에 안 들어간다.
 * 이 테스트는 고치기 전 코드에서 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const RENDER_TIME_BRANCH = /^  const \w+ = typeof window !== "undefined" \?/m;

test("컴포넌트 본문 최상위에 렌더 시점 typeof window 삼항이 없다 (SSR·첫 클라이언트 렌더 일치)", () => {
  const offenders = [];
  for (const f of walk(SRC)) {
    const src = readFileSync(f, "utf8");
    if (RENDER_TIME_BRANCH.test(src)) offenders.push(path.relative(SRC, f));
  }
  assert.deepEqual(offenders, [], `render-time window branch in: ${offenders.join(", ")}`);
});

test("AppSidebar는 userKey를 state+effect로 읽는다", () => {
  const src = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  assert.match(src, /const \[userKey, setUserKey\] = useState\(""\);/);
  assert.match(src, /setUserKey\(getUserKey\(\)\)/);
});
