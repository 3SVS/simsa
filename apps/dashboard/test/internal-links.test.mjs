/**
 * 내부 링크 가드 (2026-09-25 프로덕션 실측): `/projects`·`/`를 열면 `GET /settings?_rsc=…` 404 —
 * ImproveSimsaPrompt의 "설정에서 관리" 링크가 존재하지 않는 경로를 가리켰다(Next가 프리페치해 콘솔 오류로
 * 드러남). 사용자가 누르면 404 화면.
 *
 * 규칙: `href="/…"` 리터럴은 전부 `src/app/<경로>/page.tsx`로 해석되어야 한다.
 * 이 테스트는 고치기 전 코드(`/settings`)에서 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const APP = path.join(SRC, "app");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** `/a/b` → src/app/a/b/page.tsx 존재. 동적 세그먼트(`[id]`)는 리터럴 href에 안 나오므로 고려하지 않는다. */
function routeExists(href) {
  const clean = href.split(/[?#]/)[0].replace(/\/+$/, "");
  const dir = clean === "" ? APP : path.join(APP, ...clean.split("/").filter(Boolean));
  return existsSync(path.join(dir, "page.tsx")) || existsSync(path.join(dir, "route.ts"));
}

test("모든 리터럴 내부 href가 실제 app 라우트를 가리킨다", () => {
  const dead = [];
  for (const f of walk(SRC)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/href="(\/[a-zA-Z0-9/_-]*)"/g)) {
      const href = m[1];
      if (!routeExists(href)) dead.push(`${path.relative(SRC, f)} → ${href}`);
    }
  }
  assert.deepEqual(dead, [], `dead internal links: ${dead.join(", ")}`);
});
