/**
 * B-8 #578 — 빌드 스위치 단일화. 문 (a) "만들기"를 여닫는 스위치는 BUILD_ENABLED 하나다
 * (workspace/service-switches.ts `buildEnabled` — 검수·수리와 같은 "정확히 off만 꺼짐" 규칙).
 * POST /workspace/projects/:id/build(라우트)와 GET /workspace/build-availability(화면이 묻는 곳)가 같은
 * 판정을 쓰므로, 하나만 켜서 화면과 라우트가 어긋나는 운영 실수가 구조적으로 없다.
 *
 * 예전 PR 헤드는 공개 스위치(BUILD_ + OPEN, 정확히 "on"일 때만 열림)를 따로 두었다. 그 이름이 저장소 어디에도
 * 남지 않았는지(코드·설정·테스트·도구 문서·워크플로) 여기서 전수로 본다 — `rg`와 같은 검사를 테스트로.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
// 이 파일 자신이 걸리지 않게 조각으로 만든다.
const RETIRED_SWITCH = ["BUILD", "OPEN"].join("_");

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".wrangler", ".turbo", "coverage", "journey-audit-shots", ".git"]);
const TEXT_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|toml|md|ya?ml|sh|ps1)$/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.isFile() && TEXT_EXT.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

test("★흔적 0: 은퇴한 공개 스위치 이름이 apps·tools·.github 어디에도 없다", () => {
  // docs/는 날짜가 박힌 기록(HANDOFF·설계)이라 "제거했다"는 역사 서술이 정당하다 — 현재 동작을 말하는 코드·설정·
  // 테스트·도구 문서(tools/…/JOURNEY-AUDIT.md)·워크플로만 본다.
  const roots = ["apps", "tools", ".github"].map((r) => path.join(REPO, r)).filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  assert.ok(roots.includes(path.join(REPO, "apps")), `repo root not found from ${HERE}`);
  const files = roots.flatMap((r) => walk(r, []));
  assert.ok(files.length > 100, `scanned too few files (${files.length}) — walker is broken`);
  const hits = files.filter((f) => readFileSync(f, "utf8").includes(RETIRED_SWITCH)).map((f) => path.relative(REPO, f));
  assert.deepEqual(hits, [], `${RETIRED_SWITCH} still referenced`);
});

test("가용성 판정은 라우트와 같은 헬퍼(buildEnabled)를 쓴다 — 두 번째 스위치 해석이 없다", () => {
  const route = readFileSync(path.join(REPO, "apps/central-plane/src/routes/workspace-build-jobs.ts"), "utf8");
  const fn = /export function buildAvailabilityFor\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(route);
  assert.ok(fn, "buildAvailabilityFor");
  assert.match(fn[1], /buildEnabled\(env\)/, "availability must ask the same switch helper as POST /build");
  assert.doesNotMatch(fn[1], /env\.BUILD_[A-Z]+/, "no raw switch read — service-switches.ts is the single source");
});
