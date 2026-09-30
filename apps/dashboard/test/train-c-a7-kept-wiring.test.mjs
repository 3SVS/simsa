/**
 * Train C · C-A7 ① — "맞나요?" 카드의 kept id → 서버 userConfirmedAcIds 배선 (정적 검사, 소스 grep).
 *
 * 컴포넌트 렌더링은 node --test 범위 밖이라(train-c-wiring과 같은 방식) "그 값이 그 자리로 가는가"를
 * 소스에서 고정한다. 각 검사는 고치기 전 코드에서 실패한다.
 *
 *  K-1  confirm()이 체크를 남긴 항목 id를 intentConfirmedItemIds로 로컬에 남긴다
 *  K-2  confirm()이 그 id를 미러 뒤 역추론 지시서 생성에 동봉한다(mirrorThenBuildIntentRuler)
 *  K-3  헬퍼: 확인된 항목이 없으면 생성하지 않는다(must 0짜리 자는 비용만 든다), 있으면 confirmedItemIds로 보낸다
 *  K-4  API 클라이언트: confirmedItemIds가 있을 때만 본문에 싣는다(옛 호출 = 필드 없음 → 서버 빈 배열)
 *  K-5  지시서 화면의 재생성도 같은 id를 보낸다(역추론 must가 재생성에서 사라지지 않게)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const card = read("components/IntentConfirmCard.tsx");
const ruler = read("lib/intent-ruler.ts");
const api = read("lib/dev-spec-api.ts");
const devSpecPage = read("app/projects/[id]/dev-spec/page.tsx");
const store = read("lib/workflow-store.ts");

function confirmBody(src) {
  const start = src.indexOf("  function confirm()");
  assert.ok(start >= 0);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

test("K-1: confirm()이 kept 항목 id를 intentConfirmedItemIds로 남긴다(타입도 선언)", () => {
  const body = confirmBody(card);
  assert.match(body, /intentConfirmedItemIds: kept\.map\(\(i\) => i\.id\)/);
  assert.match(store, /intentConfirmedItemIds\?: string\[\];/);
});

test("K-2: confirm()이 미러 뒤 역추론 지시서 생성에 kept id를 동봉한다(실패는 조용히)", () => {
  const body = confirmBody(card);
  assert.match(body, /void mirrorThenBuildIntentRuler\(projectId, locale === "en" \? "en" : "ko", kept\.map\(\(i\) => i\.id\)\)\.catch\(\(\) => undefined\)/);
});

test("K-3: 헬퍼 — 미러 먼저, 확인 0이면 생성 안 함, 있으면 confirmedItemIds로", () => {
  const mirror = ruler.indexOf("await mirrorLocalProjectToDb(projectId)");
  const skip = ruler.indexOf("if (confirmedItemIds.length === 0) return \"skipped_no_confirmed\"");
  const gen = ruler.indexOf("generateDevSpecApi(projectId, getUserKey(), locale, { confirmedItemIds })");
  assert.ok(mirror >= 0 && skip > mirror && gen > skip, "mirror → skip-if-empty → generate");
});

test("K-4: API 클라이언트는 confirmedItemIds가 있을 때만 싣는다(옛 호출은 그대로)", () => {
  assert.match(api, /opts: \{ confirmedItemIds\?: readonly string\[\] \} = \{\}/);
  assert.match(api, /\.\.\.\(opts\.confirmedItemIds \? \{ confirmedItemIds: \[\.\.\.opts\.confirmedItemIds\]\.slice\(0, 60\) \} : \{\}\)/);
});

test("K-5: 지시서 화면의 재생성도 확인 id를 보낸다", () => {
  assert.match(devSpecPage, /confirmedItemIds: ext\?\.intentConfirmedItemIds/);
});
