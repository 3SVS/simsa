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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRecheckBody } from "../src/lib/visual-check-recheck.mjs";
// 네임스페이스로도 읽는다 — 옛 코드에서 새 export가 없을 때 파일 전체가 링크 오류로
// 죽지 않고, 케이스별 실패 메시지가 남게.
import * as recheck from "../src/lib/visual-check-recheck.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CHECK = {
  id: "wvc_abc123",
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
      sourceCheckId: "wvc_abc123",
    });
  });

  it("intent가 비어 있으면 intent 키를 보내지 않는다 — 서버가 프로젝트 확정 의도로 대신한다", () => {
    for (const intent of ["", "   ", undefined, null]) {
      const body = buildRecheckBody({ ...CHECK, intent }, "uk_1", "en");
      assert.equal("intent" in body, false, `intent=${JSON.stringify(intent)} should be omitted`);
      assert.equal(body.sourceCheckId, "wvc_abc123");
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

// ── PR #552 검증 결함 #2 (P1) — 서버 기본 문장을 명시 intent로 되돌려보내지 않는다 ──
//
// 첫 런은 projects/new가 `{ userKey, locale }`만 보내므로 서버가 DEFAULT_INSPECTION_INTENT
// 를 런 행에 저장하고 GET 상세로 그대로 돌려준다. 옛 buildRecheckBody는 그 기본 문장을
// "원 런의 intent"로 보고 명시 전송했다 → 계약 1 캐스케이드(body.intent → 원 런 → 확정
// oneLine → 기본)가 body.intent에서 멈춰, "맞나요?"로 확정한 의도가 재검수 기준이 되지
// 못했다(끊김 #1이 code 갈래 주 경로에서 그대로). 서버(#553) 캐스케이드도 원 런 intent(=
// 기본 문장)를 물려받으므로 intent를 단순 생략해도 확정 oneLine에 닿지 않는다 — 클라이언트가
// 기본 문장을 '없음'으로 보고 로컬에 확정된 oneLine을 명시로 보낸다.
// 이 describe는 고치기 전 코드에서 실패한다(SERVER_DEFAULT_INTENT 없음, 기본 문장 그대로 전송).
describe("buildRecheckBody — 서버 기본 문장은 '의도 없음'이다 (계약 1이 확정 의도에 닿아야 한다)", () => {
  it("SERVER_DEFAULT_INTENT는 central-plane의 DEFAULT_INSPECTION_INTENT와 글자 그대로 같다 (표류 감시)", () => {
    const src = readFileSync(
      path.resolve(HERE, "../../central-plane/src/routes/workspace-visual-check-runs.ts"),
      "utf8",
    );
    const m = /export const DEFAULT_INSPECTION_INTENT =\s*"([^"]+)"/.exec(src);
    assert.ok(m, "central-plane exports DEFAULT_INSPECTION_INTENT as a string literal");
    assert.equal(recheck.SERVER_DEFAULT_INTENT, m[1]);
    assert.equal(recheck.isServerDefaultIntent(m[1]), true);
    assert.equal(recheck.isServerDefaultIntent(`  ${m[1]}  `), true);
    assert.equal(recheck.isServerDefaultIntent(CHECK.intent), false);
    assert.equal(recheck.isServerDefaultIntent(undefined), false);
  });

  it("첫 런(의도 미지정)의 재검수: 원 런 intent가 기본 문장이면 확정 oneLine을 명시 intent로 보낸다", () => {
    const body = recheck.buildRecheckBody(
      { ...CHECK, intent: recheck.SERVER_DEFAULT_INTENT },
      "uk_1",
      "ko",
      { confirmedIntent: "회원가입 후 첫 예약이 끝까지 되어야 한다" },
    );
    assert.equal(body.intent, "회원가입 후 첫 예약이 끝까지 되어야 한다");
    assert.equal(body.sourceCheckId, CHECK.id);
    assert.equal(body.locale, "ko");
  });

  it("기본 문장 + 확정 oneLine 없음 → intent 키를 보내지 않는다 (기본 문장을 명시 의도로 되돌려보내지 않는다)", () => {
    // 상수가 아니라 글자 그대로 — 옛 코드(상수 없음)에서도 이 케이스가 스스로 실패하게.
    const serverDefault = "사용자가 앱을 열어 핵심 기능이 실제로 작동하는지 눈으로 확인할 수 있어야 한다";
    for (const opts of [undefined, {}, { confirmedIntent: null }, { confirmedIntent: undefined }, { confirmedIntent: "   " }]) {
      const body = recheck.buildRecheckBody({ ...CHECK, intent: serverDefault }, "uk_1", "ko", opts);
      assert.equal("intent" in body, false, `opts=${JSON.stringify(opts)}`);
      assert.equal(body.sourceCheckId, CHECK.id);
    }
  });

  it("원 런 intent가 비어 있고 확정 oneLine이 있으면 그것을 보낸다 (앞뒤 공백 정리)", () => {
    const body = recheck.buildRecheckBody({ ...CHECK, intent: "" }, "uk_1", "en", {
      confirmedIntent: "  Sign-up then the first booking must finish  ",
    });
    assert.equal(body.intent, "Sign-up then the first booking must finish");
  });

  it("사용자가 그 런에 직접 적은 intent는 확정 oneLine보다 우선한다 (원 런과 같은 자)", () => {
    const body = recheck.buildRecheckBody({ ...CHECK, intent: "로그인이 되어야 한다" }, "uk_1", "ko", {
      confirmedIntent: "다른 문장",
    });
    assert.equal(body.intent, "로그인이 되어야 한다");
  });
});
