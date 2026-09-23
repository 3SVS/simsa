import { test } from "node:test";
import assert from "node:assert/strict";

// N8 (2026-09-24, 배포 후 감사 P0 8건의 정체): 기본 흐름 **셸**(사이드바 계정 영역)과 개요 본문이
// 개발 용어를 냈다 — "워크스페이스"(7건), 개요의 GitHub·Lovable·v0(1건). 감사 장비(N6)의 사전과
// 같은 규칙으로 사전(dictionary) 자체를 검사해, 문구가 다시 개발자 말투로 돌아가면 여기서 잡힌다.
// 규칙: 이 테스트는 N8 전 사전에서 실패한다.

const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

/** 기본 흐름에서 항상 보이는 셸 문구 + 개요 본문 문구 — 초보자에게 개발 용어 0이어야 한다. */
function defaultFlowStrings(d) {
  return [
    d.account.workspace,
    d.account.sections.workspace,
    d.account.workspaceInfo.current,
    d.account.workspaceInfo.localScoped,
    d.account.workspaceInfo.teamPlanned,
    d.commandCenter.getPackDesc,
    d.commandCenter.gsStep2,
  ];
}

for (const loc of ["en", "ko"]) {
  test(`[${loc}] 기본 흐름 셸·개요 문구에 개발 용어 0 (워크스페이스·GitHub·Lovable·v0 …)`, () => {
    const d = DICTIONARIES[loc];
    assert.ok(d, `dictionary for ${loc}`);
    for (const s of defaultFlowStrings(d)) {
      assert.equal(typeof s, "string", `string expected: ${JSON.stringify(s)}`);
      const hits = devTermHits(s);
      assert.deepEqual(hits, [], `"${s}" → ${JSON.stringify(hits)}`);
      assert.ok(!/워크스페이스|workspace/i.test(s), `"${s}" still says workspace`);
    }
  });
}
