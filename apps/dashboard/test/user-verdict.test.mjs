/**
 * Train C — C2b (재정렬 §1 끊김 #6·#12, W1-7·W1-8; D-17·D-19 amend):
 * 사람 수용 라벨(user_verdict)과 빌더용 고침 지시의 기본 선택 규칙.
 *
 * 북극성이 "접수 건 중 user_verdict = as_intended로 닫힌 건수"(D-19)이므로, 이 네 값의
 * 표기와 서버값→표시 매핑이 어긋나면 지표 자체가 어긋난다. 그리고 Lovable/Bolt/v0 유저에게
 * CLI 에이전트용 지시를 기본으로 보이면 붙여넣을 곳이 없다(끊김 #6).
 * 이 파일은 고치기 전 코드에서 실패한다(모듈·사전 키가 없다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  USER_VERDICT_OPTIONS,
  WEB_BUILDER_TOOLS,
  normalizeUserVerdict,
  userVerdictLabel,
  pickDefaultPromptTarget,
  fixPromptFor,
  availablePromptTargets,
} from "../src/lib/user-verdict.mjs";
// 네임스페이스로도 읽는다 — 옛 코드에서 새 export가 없을 때 파일 전체가 링크 오류로
// 죽지 않고, 케이스별 실패 메시지가 남게.
import * as uv from "../src/lib/user-verdict.mjs";
import { DICTIONARIES, getDictionary } from "../src/i18n/dictionary.mjs";
import { DEV_TERMS, devTermHits } from "../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs";

// PR #552 검증 P2: 기본 흐름 카피에는 '저장소/repository'도 금칙어로 센다(repair-state.test.mjs와 같은 확장).
const BEGINNER_TERMS = [...DEV_TERMS, "저장소", "리포지토리", "repository", "repositories"];

describe("user_verdict — 4값 (계약 2)", () => {
  it("옵션은 정확히 이 네 값, 이 순서 (생각대로 / 되긴 하는데 달라 / 아직 안 돼 / 모르겠어)", () => {
    assert.deepEqual(USER_VERDICT_OPTIONS, ["as_intended", "works_but_different", "still_broken", "unsure"]);
  });

  it("서버값 → 표시: 네 값은 그대로, 그 밖(null·undefined·옛 서버 필드 없음·오타)은 null", () => {
    for (const v of USER_VERDICT_OPTIONS) assert.equal(normalizeUserVerdict(v), v);
    for (const bad of [null, undefined, "", "AS_INTENDED", "works", 1, {}]) {
      assert.equal(normalizeUserVerdict(bad), null, `normalize(${JSON.stringify(bad)})`);
    }
  });

  it("라벨은 KO/EN 사전에서 오고, 네 값 모두 비어 있지 않으며 서로 다르다", () => {
    for (const loc of ["ko", "en"]) {
      const t = getDictionary(loc);
      const labels = USER_VERDICT_OPTIONS.map((v) => userVerdictLabel(v, t));
      for (const l of labels) assert.ok(typeof l === "string" && l.trim().length > 0, `${loc} label empty`);
      assert.equal(new Set(labels).size, 4, `${loc} labels must be distinct: ${labels.join(" | ")}`);
    }
    assert.equal(userVerdictLabel("as_intended", getDictionary("ko")), "생각대로 됐어요");
    assert.equal(userVerdictLabel("works_but_different", getDictionary("ko")), "되긴 하는데 달라요");
    assert.equal(userVerdictLabel("still_broken", getDictionary("ko")), "아직 안 돼요");
    assert.equal(userVerdictLabel("unsure", getDictionary("ko")), "모르겠어요");
  });
});

describe("pickDefaultPromptTarget — 빌더 채팅 vs 코딩 도구 (계약 3)", () => {
  it("lovable/bolt/v0/replit/base44 중 하나 + builderPrompt 있음 → web_builder", () => {
    for (const tool of WEB_BUILDER_TOOLS) {
      assert.equal(pickDefaultPromptTarget([tool], true), "web_builder", tool);
    }
    // 대소문자·여러 도구 섞임에도 하나라도 빌더면 빌더.
    assert.equal(pickDefaultPromptTarget(["claude-code", "Lovable"], true), "web_builder");
    // 프로젝트 저장 형태 {tools: [...]}도 받는다.
    assert.equal(pickDefaultPromptTarget({ tools: ["bolt"] }, true), "web_builder");
  });

  it("cursor / claude-code / 미응답 → cli", () => {
    assert.equal(pickDefaultPromptTarget(["cursor"], true), "cli");
    assert.equal(pickDefaultPromptTarget(["claude-code"], true), "cli");
    assert.equal(pickDefaultPromptTarget([], true), "cli");
    assert.equal(pickDefaultPromptTarget(undefined, true), "cli");
    assert.equal(pickDefaultPromptTarget(null, true), "cli");
  });

  it("builderPrompt가 없는 옛 런은 도구가 빌더여도 cli (없는 것을 기본으로 고르지 않는다)", () => {
    assert.equal(pickDefaultPromptTarget(["lovable"], false), "cli");
  });
});

// ── PR #552 검증 결함 #3 (P1) — 주소만 앱(저장소 미연결)의 기본 형식 ──
//
// C2a는 저장소가 없거나(false) 모르면(null) BuilderPasteSection("아래 고침 지시를 복사해 그
// 도구의 채팅창에 붙여넣으세요")을 보이는데, 옛 pickDefaultPromptTarget은 저장소 사실을 보지
// 않아 도구 미응답·other·{tools:[]}이면 바로 아래 카드가 CLI 형식("Claude Code, Cursor 등")으로
// 떴다 — 같은 화면에서 지시가 모순되고 기본 흐름에 금칙어(Cursor)가 노출됐다(D-17 amend 위반).
// 이 describe는 고치기 전 코드에서 실패한다(옵션을 무시하고 "cli", CLI_AGENT_TOOLS 없음).
describe("pickDefaultPromptTarget — addressOnly (C2a 진입 모드와 같은 편을 든다)", () => {
  it("도구 미응답 / other / {tools:[]} + 저장소 없음 + builderPrompt 있음 → web_builder", () => {
    for (const bw of [undefined, null, [], ["other"], { tools: [] }, { tools: ["other"] }]) {
      assert.equal(uv.pickDefaultPromptTarget(bw, true, { addressOnly: true }), "web_builder", JSON.stringify(bw));
    }
  });

  it("저장소가 없어도 builderPrompt가 없으면 cli (없는 것을 기본으로 고르지 않는다)", () => {
    assert.equal(uv.pickDefaultPromptTarget(undefined, false, { addressOnly: true }), "cli");
    assert.equal(uv.pickDefaultPromptTarget(["other"], false, { addressOnly: true }), "cli");
  });

  it("코딩 도구를 직접 골랐으면(cursor·claude-code·windsurf·codex·hand-coded) 저장소가 없어도 cli — 사용자가 말한 도구가 이긴다", () => {
    assert.deepEqual(uv.CLI_AGENT_TOOLS, ["cursor", "claude-code", "windsurf", "codex", "hand-coded"]);
    for (const tool of uv.CLI_AGENT_TOOLS) {
      assert.equal(uv.pickDefaultPromptTarget([tool], true, { addressOnly: true }), "cli", tool);
    }
    // 빌더와 코딩 도구를 함께 골랐으면 빌더(채팅에 붙일 곳이 있다).
    assert.equal(uv.pickDefaultPromptTarget(["cursor", "lovable"], true, { addressOnly: true }), "web_builder");
  });

  it("저장소 연결됨(addressOnly:false)·옵션 없음은 종전 규칙 그대로 — 미응답은 cli, 빌더는 web_builder", () => {
    assert.equal(uv.pickDefaultPromptTarget(undefined, true, { addressOnly: false }), "cli");
    assert.equal(uv.pickDefaultPromptTarget(["other"], true, {}), "cli");
    assert.equal(uv.pickDefaultPromptTarget(["other"], true), "cli");
    assert.equal(uv.pickDefaultPromptTarget(["lovable"], true, { addressOnly: false }), "web_builder");
    assert.equal(uv.pickDefaultPromptTarget(["cursor"], true, { addressOnly: false }), "cli");
  });
});

describe("fixPromptFor / availablePromptTargets — 두 형식 토글", () => {
  const both = { agentPrompt: "CLI 지시", report: { builderPrompt: "빌더 지시" } };
  it("target별 본문을 고르고, 없으면 null", () => {
    assert.equal(fixPromptFor(both, "web_builder"), "빌더 지시");
    assert.equal(fixPromptFor(both, "cli"), "CLI 지시");
    assert.equal(fixPromptFor({ agentPrompt: "CLI 지시", report: null }, "web_builder"), null);
    assert.equal(fixPromptFor({ report: { builderPrompt: "빌더 지시" } }, "cli"), null);
    assert.equal(fixPromptFor(null, "cli"), null);
  });

  it("가능한 형식 목록: 둘 다 → [web_builder, cli] · 옛 런 → [cli] · 아무것도 없음 → []", () => {
    assert.deepEqual(availablePromptTargets(both), ["web_builder", "cli"]);
    assert.deepEqual(availablePromptTargets({ agentPrompt: "x", report: {} }), ["cli"]);
    assert.deepEqual(availablePromptTargets({ agentPrompt: "", report: { builderPrompt: "" } }), []);
    assert.deepEqual(availablePromptTargets(undefined), []);
  });
});

describe("C2b 사전 — KO/EN 둘 다, 초보자 금칙어 0, 점수 표기 0", () => {
  // PR #552 검증 P2: saveUnavailable 추가(옛 서버 404 = 영구 조건은 '잠시 뒤' 카피로 가리지 않는다) ·
  // targetBuilder/targetCli 삭제(어디서도 참조되지 않던 죽은 키 — 존재 고정 대신 참조 고정으로,
  // train-c-wiring.test.mjs "fixPrompt.* 모든 키가 화면에서 쓰인다").
  const KEYS_VERDICT = ["title", "hint", "saving", "saved", "saveError", "saveUnavailable"];
  const KEYS_FIX = ["builderBody", "copyBuilder", "showCli", "showBuilder"];

  for (const loc of ["ko", "en"]) {
    it(`${loc}: userVerdict.* / fixPrompt.* 키가 모두 있고 비어 있지 않다`, () => {
      const vc = DICTIONARIES[loc].visualChecks;
      for (const k of KEYS_VERDICT) assert.ok(vc.userVerdict?.[k]?.trim(), `${loc}.visualChecks.userVerdict.${k}`);
      for (const v of USER_VERDICT_OPTIONS) assert.ok(vc.userVerdict?.options?.[v]?.trim(), `${loc}.userVerdict.options.${v}`);
      for (const k of KEYS_FIX) assert.ok(vc.fixPrompt?.[k]?.trim(), `${loc}.visualChecks.fixPrompt.${k}`);
    });

    it(`${loc}: 새 카피에 개발 용어(GitHub·PR·Lovable·v0·Cursor …)와 숫자 점수가 없다`, () => {
      const vc = DICTIONARIES[loc].visualChecks;
      const strings = [
        ...KEYS_VERDICT.map((k) => vc.userVerdict[k]),
        ...USER_VERDICT_OPTIONS.map((v) => vc.userVerdict.options[v]),
        ...KEYS_FIX.map((k) => vc.fixPrompt[k]),
      ];
      for (const s of strings) {
        const hits = devTermHits(s, { terms: BEGINNER_TERMS });
        assert.deepEqual(hits, [], `"${s}" → ${JSON.stringify(hits)}`);
        assert.doesNotMatch(s, /\d+\s*(점|\/\s*\d+|%)/, `"${s}" looks like a score`);
      }
    });
  }

  it("복사 버튼 라벨은 계약 문구 그대로 (KO '빌더 채팅에 붙여넣기' / EN \"Paste into your builder's chat\")", () => {
    assert.equal(DICTIONARIES.ko.visualChecks.fixPrompt.copyBuilder, "빌더 채팅에 붙여넣기");
    assert.equal(DICTIONARIES.en.visualChecks.fixPrompt.copyBuilder, "Paste into your builder's chat");
  });

  // PR #552 검증 P2 (정직 카피 ⑥): user_verdict를 읽어 검수·고침 안내를 바꾸는 코드는 서버·대시보드
  // 어디에도 없다 — "더 정확해져요"는 지키지 못하는 약속이다. 옛 카피에서 실패한다.
  it("userVerdict.hint는 지키지 못할 약속(다음 검수·고침 안내가 더 정확해진다)을 하지 않는다", () => {
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.userVerdict.hint, /정확/);
    assert.doesNotMatch(DICTIONARIES.en.visualChecks.userVerdict.hint, /accurate|improve/i);
  });

  // PR #552 검증 P2: fixPrompt.builderBody가 '다시 확인' 버튼을 가리켰지만 repair 모드·none 모드
  // 화면에는 그 이름의 버튼이 없다(수리 카드 버튼은 '수리 확인 재검수'). 버튼 이름을 인용하지 않는다.
  it("fixPrompt.builderBody는 특정 버튼 이름을 인용하지 않는다 (같은 화면에 그 버튼이 없을 수 있다)", () => {
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.fixPrompt.builderBody, /['"‘“]다시 확인['"’”]/);
    assert.doesNotMatch(DICTIONARIES.en.visualChecks.fixPrompt.builderBody, /["“]Check again["”]/i);
  });
});

// PR #552 검증 P2: 판정 저장 실패의 원인 분리. 옛 서버(라우트 없음)는 central-plane notFound 핸들러의
// `{ error: "not found", path }`(JSON, ok 없음) 또는 본문 파싱 실패 시 "HTTP 404"로 돌아온다 — 영구
// 조건이다. '잠시 뒤 다시 눌러주세요'로 가리지 않고 saveUnavailable 카피를 쓴다.
// 이 describe는 고치기 전 코드에서 실패한다(userVerdictErrorKey 없음).
describe("userVerdictErrorKey — 옛 서버(라우트 없음)와 일시 장애를 구분한다", () => {
  it("라우트 없음(HTTP 404 · 'not found' · not_found) → unavailable", () => {
    for (const e of ["HTTP 404", "not found", "not_found", "  HTTP 404 "]) {
      assert.equal(uv.userVerdictErrorKey(e), "unavailable", JSON.stringify(e));
    }
  });
  it("그 밖(런 없음 run_not_found · 403 · 네트워크 · 없음) → generic (다시 시도 카피)", () => {
    for (const e of ["run_not_found", "project_not_found", "forbidden", "invalid_verdict", "HTTP 500", "TypeError: fetch failed", undefined, null, 404]) {
      assert.equal(uv.userVerdictErrorKey(e), "generic", JSON.stringify(e));
    }
  });
});
