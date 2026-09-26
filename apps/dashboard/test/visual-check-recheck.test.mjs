/**
 * Train C — C0 (재정렬 §1 끊김 #2, W1-1): 재검수는 원래 의도를 잃지 않는다.
 *
 * 옛 코드의 handleRecheck는 `{ userKey, locale }`만 보냈고, 서버는 기본 문장으로
 * 재검수했다 — "고친 뒤 다시 확인"이 다른 자(尺)로 잰 셈이다. 이 스위트는
 * 재검수 본문을 만드는 순수 함수를 고정한다. 이 파일은 고치기 전 코드에서 실패한다
 * (모듈 자체가 없다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRecheckBody } from "../src/lib/visual-check-recheck.mjs";

const CHECK = {
  id: "vc_abc123",
  projectId: "proj_1",
  targetUrl: "https://my-app.lovable.app",
  intent: "회원가입 후 첫 예약이 끝까지 되어야 한다",
  decision: "Needs Fix",
  works: false,
  status: "done",
};

describe("buildRecheckBody (C0 — 계약 1 클라이언트)", () => {
  it("원 런의 intent와 id를 sourceCheckId로 물려준다 (한글 의도 그대로)", () => {
    const body = buildRecheckBody(CHECK, "uk_1", "ko");
    assert.deepEqual(body, {
      userKey: "uk_1",
      locale: "ko",
      intent: "회원가입 후 첫 예약이 끝까지 되어야 한다",
      sourceCheckId: "vc_abc123",
    });
  });

  it("intent가 비어 있으면 intent 키를 보내지 않는다 — 서버가 프로젝트 확정 의도로 대신한다", () => {
    for (const intent of ["", "   ", undefined, null]) {
      const body = buildRecheckBody({ ...CHECK, intent }, "uk_1", "en");
      assert.equal("intent" in body, false, `intent=${JSON.stringify(intent)} should be omitted`);
      assert.equal(body.sourceCheckId, "vc_abc123");
      assert.equal(body.locale, "en");
    }
  });

  it("intent 앞뒤 공백은 정리하고, 본문에는 targetUrl/sourceId를 넣지 않는다 (서버가 원 런의 주소를 쓴다)", () => {
    const body = buildRecheckBody({ ...CHECK, intent: "  로그인이 되어야 한다  " }, "uk_1", "ko");
    assert.equal(body.intent, "로그인이 되어야 한다");
    assert.equal("targetUrl" in body, false);
    assert.equal("sourceId" in body, false);
  });

  it("id가 없는 런(옛 응답)에서는 sourceCheckId를 생략하되 나머지는 그대로", () => {
    const body = buildRecheckBody({ ...CHECK, id: undefined }, "uk_1", "ko");
    assert.equal("sourceCheckId" in body, false);
    assert.equal(body.intent, CHECK.intent);
  });
});
