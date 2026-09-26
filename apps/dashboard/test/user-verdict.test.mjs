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
import { DICTIONARIES, getDictionary } from "../src/i18n/dictionary.mjs";
import { devTermHits } from "../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs";

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
  const KEYS_VERDICT = ["title", "hint", "saving", "saved", "saveError"];
  const KEYS_FIX = ["builderBody", "copyBuilder", "showCli", "showBuilder", "targetBuilder", "targetCli"];

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
        const hits = devTermHits(s);
        assert.deepEqual(hits, [], `"${s}" → ${JSON.stringify(hits)}`);
        assert.doesNotMatch(s, /\d+\s*(점|\/\s*\d+|%)/, `"${s}" looks like a score`);
      }
    });
  }

  it("복사 버튼 라벨은 계약 문구 그대로 (KO '빌더 채팅에 붙여넣기' / EN \"Paste into your builder's chat\")", () => {
    assert.equal(DICTIONARIES.ko.visualChecks.fixPrompt.copyBuilder, "빌더 채팅에 붙여넣기");
    assert.equal(DICTIONARIES.en.visualChecks.fixPrompt.copyBuilder, "Paste into your builder's chat");
  });
});
