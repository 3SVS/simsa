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

  it("EN 기본 문장도 '의도 없음'이다 — central-plane DEFAULT_INSPECTION_INTENT_EN과 같다 (표류 감시, #553 머지 전에는 리터럴만 검사)", () => {
    const src = readFileSync(
      path.resolve(HERE, "../../central-plane/src/routes/workspace-visual-check-runs.ts"),
      "utf8",
    );
    const m = /const DEFAULT_INSPECTION_INTENT_EN =\s*"([^"]+)"/.exec(src);
    if (m) assert.equal(recheck.SERVER_DEFAULT_INTENT_EN, m[1]);
    assert.equal(typeof recheck.SERVER_DEFAULT_INTENT_EN, "string");
    assert.ok(/^[ -~]+$/.test(recheck.SERVER_DEFAULT_INTENT_EN), "EN placeholder is ASCII prose");
    assert.equal(recheck.isServerDefaultIntent(recheck.SERVER_DEFAULT_INTENT_EN), true);
    assert.equal(recheck.isServerDefaultIntent(`  ${recheck.SERVER_DEFAULT_INTENT_EN}  `), true);
    // EN 첫 런 + 확정 oneLine → 확정 oneLine이 명시 intent (옛 코드: EN 기본 문장을 '적은 의도'로 봐 그대로 전송 → 실패)
    const body = recheck.buildRecheckBody(
      { ...CHECK, intent: recheck.SERVER_DEFAULT_INTENT_EN },
      "uk_1",
      "en",
      { confirmedIntent: "A visitor can book a table and get a confirmation" },
    );
    assert.equal(body.intent, "A visitor can book a table and get a confirmation");
    assert.equal(body.locale, "en");
    // EN 기본 문장 + 확정 없음 → intent 키 없음
    const bare = recheck.buildRecheckBody({ ...CHECK, intent: recheck.SERVER_DEFAULT_INTENT_EN }, "uk_1", "en");
    assert.equal("intent" in bare, false);
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

// ── C-A7 검증 P2-5 — 인터뷰로 확정 의도를 바꾼 뒤의 '다시 확인' ─────────────────
//
// 재검수의 자는 두 조각이다: intent(클라이언트가 보낸다)와 acceptancePlan(서버가 **지금의** 지시서에서
// 만든다). 인터뷰로 의도를 X → Y로 고치면 지시서(AC)는 Y 기준으로 다시 만들어지는데, 옛 규칙은 원 런의
// intent X를 그대로 보냈다 — 재검수에서 intent(X)와 AC(Y)가 어긋났다. 이제 확정 의도가 원 런보다 **뒤에**
// 바뀌었으면 확정 의도가 재검수 intent다. 원 런보다 앞선 확정은 종전대로 원 런 intent(C0 같은 자).
// 이 describe의 표시 없는 케이스는 고치기 전 코드에서 실패한다.
describe("buildRecheckBody — 확정 의도가 원 런 뒤에 바뀌었으면 확정 의도가 재검수 intent다 (지시서의 AC와 같은 자)", () => {
  const RUN = { ...CHECK, intent: "미용실 예약 앱", createdAt: "2026-10-01T01:00:00.000Z" };
  const Y = "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것";

  it("원 런 intent X, 그 뒤 인터뷰로 확정 Y → 재검수 body.intent === Y (sourceCheckId는 그대로)", () => {
    const body = recheck.buildRecheckBody(RUN, "uk_트루픽셀_대표", "ko", { confirmedIntent: Y, confirmedIntentAt: "2026-10-01T02:30:00.000Z" });
    assert.equal(body.intent, Y);
    assert.equal(body.sourceCheckId, CHECK.id);
  });

  it("[가드 — 옛 코드에서도 통과] 확정이 원 런보다 앞서면(또는 같은 시각) 원 런 intent를 지킨다 — C0 같은 자", () => {
    for (const at of ["2026-09-30T23:00:00.000Z", "2026-10-01T01:00:00.000Z"]) {
      const body = recheck.buildRecheckBody(RUN, "uk_1", "ko", { confirmedIntent: Y, confirmedIntentAt: at });
      assert.equal(body.intent, "미용실 예약 앱", at);
    }
  });

  it("[가드 — 옛 코드에서도 통과] 시각을 모르면(없음·깨진 값·원 런 시각 없음) 종전 규칙 — 원 런 intent", () => {
    for (const [run, at] of [[RUN, undefined], [RUN, "어제"], [{ ...RUN, createdAt: undefined }, "2026-10-01T02:30:00.000Z"], [{ ...RUN, createdAt: "?" }, "2026-10-01T02:30:00.000Z"]]) {
      const body = recheck.buildRecheckBody(run, "uk_1", "ko", { confirmedIntent: Y, confirmedIntentAt: at });
      assert.equal(body.intent, "미용실 예약 앱", `${run.createdAt} / ${at}`);
    }
  });

  it("[가드 — 옛 코드에서도 통과] 확정 의도가 비어 있으면 시각이 뒤여도 원 런 intent(빈 의도로 덮지 않는다)", () => {
    const body = recheck.buildRecheckBody(RUN, "uk_1", "ko", { confirmedIntent: "   ", confirmedIntentAt: "2026-10-01T02:30:00.000Z" });
    assert.equal(body.intent, "미용실 예약 앱");
  });

  it("confirmedIntentAtOf: intentRevisedAt·intentConfirmedAt 중 늦은 것(깨진 값은 무시), 둘 다 없으면 null", () => {
    assert.equal(typeof recheck.confirmedIntentAtOf, "function");
    assert.equal(recheck.confirmedIntentAtOf({ intentConfirmedAt: "2026-09-20T02:00:00.000Z", intentRevisedAt: "2026-10-01T02:30:00.000Z" }), "2026-10-01T02:30:00.000Z");
    assert.equal(recheck.confirmedIntentAtOf({ intentConfirmedAt: "2026-10-02T00:00:00.000Z", intentRevisedAt: "2026-10-01T02:30:00.000Z" }), "2026-10-02T00:00:00.000Z");
    assert.equal(recheck.confirmedIntentAtOf({ intentConfirmedAt: "깨진 값", intentRevisedAt: "2026-10-01T02:30:00.000Z" }), "2026-10-01T02:30:00.000Z");
    assert.equal(recheck.confirmedIntentAtOf({}), null);
    assert.equal(recheck.confirmedIntentAtOf(null), null);
  });
});
