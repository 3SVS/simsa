/**
 * intent-confirm-copy.test.mjs — AF-4 확인 카드의 **문구 계약** (설계 D-3).
 *
 * 컴포넌트 렌더링은 이 스위트의 범위가 아니다(node --test, DOM 없음). 대신
 * **정직성이 문구에 실제로 박혀 있는지**를 고정한다 — 이 카드에서 가장 쉽게
 * 무너지는 것이 코드가 아니라 말투이기 때문이다.
 *
 * 고정하는 것:
 *   ① 초안을 "사실"처럼 말하지 않는다 — 고칠 수 있음을 알린다
 *   ② 추론이 빈 네 가지 이유가 **각각 다른 말**을 한다(뭉뜽그리면 거짓말이 된다)
 *   ③ 근거 없이 지어내지 않았다는 것이 사용자에게 보인다
 *   ④ KO/EN 모두 갖춰져 있다 — 한쪽만 있으면 다른 언어 사용자는 빈 화면을 본다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");

const KEYS = [
  "loading", "title", "subtitle", "nameLabel", "oneLineLabel", "oneLinePlaceholder",
  "itemsLabel", "itemsHint", "readFrom", "confirm", "later", "errorLead", "retry",
  "emptyTitle", "emptyNoSource", "emptyUnreadable", "emptyNoEvidence", "emptyLlm", "saveMine",
];

describe("④ KO/EN 모두 갖춰져 있다", () => {
  for (const locale of ["ko", "en"]) {
    it(`${locale}: 모든 키가 비어 있지 않다`, () => {
      const c = DICTIONARIES[locale].intentConfirm;
      for (const k of KEYS) {
        assert.equal(typeof c[k], "string", `${locale}.${k} 없음`);
        assert.ok(c[k].trim().length > 0, `${locale}.${k} 비어 있음`);
      }
    });
  }
});

describe("① 초안을 사실처럼 말하지 않는다", () => {
  it("★'저희가 읽은' / 'looks like to us' — 단정하지 않는 주어", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.title, /읽은|보입|같/);
    assert.match(DICTIONARIES.en.intentConfirm.title, /looks like|we read|seems/i);
  });

  it("★고칠 수 있다고 명시하고, 이게 검수 기준이 된다고 알린다", () => {
    // 사용자가 그냥 넘기더라도 그것이 자기 판단이었음을 알아야 한다.
    const ko = DICTIONARIES.ko.intentConfirm.subtitle;
    assert.match(ko, /고쳐|수정/);
    assert.match(ko, /기준/);
    const en = DICTIONARIES.en.intentConfirm.subtitle;
    assert.match(en, /correct|edit|change/i);
    assert.match(en, /check against|criteria|what we check/i);
  });
});

describe("② 빈 이유 네 가지가 서로 다른 말을 한다", () => {
  const EMPTY = ["emptyNoSource", "emptyUnreadable", "emptyNoEvidence", "emptyLlm"];

  for (const locale of ["ko", "en"]) {
    it(`${locale}: 네 문구가 전부 다르다 — 뭉뜽그리면 거짓말이 된다`, () => {
      const c = DICTIONARIES[locale].intentConfirm;
      const texts = EMPTY.map((k) => c[k]);
      assert.equal(new Set(texts).size, EMPTY.length, "같은 문구를 돌려쓰면 원인을 숨기는 것");
    });
  }

  it("★'설명이 없었다'는 짐작하지 않았음을 분명히 한다 (③)", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.emptyNoEvidence, /짐작|추측/);
    assert.match(DICTIONARIES.en.intentConfirm.emptyNoEvidence, /guess/i);
  });

  it("연결된 것이 없을 땐 그 사실을 말한다", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.emptyNoSource, /연결/);
    assert.match(DICTIONARIES.en.intentConfirm.emptyNoSource, /connected|nothing/i);
  });
});

describe("③ 근거를 밝힌다", () => {
  it("무엇을 읽고 쓴 초안인지 보여주는 문구가 있다", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.readFrom, /읽은/);
    assert.match(DICTIONARIES.en.intentConfirm.readFrom, /drafted from|read from/i);
  });

  it("항목을 지울 수 있다고 안내한다 — 지어낸 항목에 갇히지 않도록", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.itemsHint, /체크를 풀|상관없/);
    assert.match(DICTIONARIES.en.intentConfirm.itemsHint, /uncheck|not really/i);
  });
});

describe("비개발자 언어 — 전문용어가 새어 나오지 않는다", () => {
  const JARGON = [/\bAPI\b/, /\brepo\b/i, /\bcommit\b/i, /\bendpoint\b/i, /스펙/, /커밋/, /엔드포인트/];
  for (const locale of ["ko", "en"]) {
    it(`${locale}: 개발자 용어 없음`, () => {
      const c = DICTIONARIES[locale].intentConfirm;
      for (const k of KEYS) {
        for (const re of JARGON) {
          assert.ok(!re.test(c[k]), `${locale}.${k}에 전문용어: ${c[k]}`);
        }
      }
    });
  }
});
