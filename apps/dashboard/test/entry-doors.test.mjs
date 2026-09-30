/**
 * entry-doors.test.mjs — C-N7 (Train C, 계획 2026-09-27 §5 · D-17 amend): 첫 화면의 **세 문**.
 *
 *   아이디어가 있어요 / 만든 앱이 안 돼요 / 만들었는데 생각과 달라요
 *   I have an idea / My app doesn't work / It works, but not how I meant
 *
 * 진입 구조는 크게 바꾸지 않는다: 세 문은 기존 갈래에 얹힌다 — (a) → idea,
 * (b)(c) → code. 세 번째 문은 기존 앱 갈래로 들어가되 `?door=differs`를 달고,
 * 프로젝트 화면의 의도 확인 카드(IntentConfirmCard, AF-4)가 "원래 만들려던 것"을
 * 묻는 말로 바뀐다. 기획서 붙여넣기(spec)는 문이 아니라 첫 문 아래 보조 링크로 남는다.
 *
 * 규칙: 이 파일의 테스트는 C-N7 전 코드에서 실패한다(행동 보존 가드로 표시한 것 제외).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");

const LIB = path.join(SRC, "lib/entry-doors.mjs");
// 없으면 빈 객체 — 파일 전체가 로드 실패로 뭉개지지 않고 테스트마다 실패한다.
const doors = existsSync(LIB) ? await import(pathToFileURL(LIB).href) : {};
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const fn = (name) => {
  const f = doors[name];
  assert.equal(typeof f, "function", `${name} is not exported from src/lib/entry-doors.mjs`);
  return f;
};

/** "/projects/new?path=code&door=differs" → { path, door } as the page reads them. */
function searchOf(href) {
  const u = new URL(href, "https://app.example");
  return { path: u.searchParams.get("path"), door: u.searchParams.get("door") };
}

describe("세 문 ↔ 기존 갈래 매핑 (순수 함수)", () => {
  test("문은 세 개, 이 순서: 아이디어 → 안 돼요 → 생각과 달라요", () => {
    assert.deepEqual(doors.ENTRY_DOORS, ["idea", "broken", "differs"]);
  });

  test("문 → 갈래: (a) idea, (b)(c) 둘 다 기존 앱 갈래(code)", () => {
    const doorBranch = fn("doorBranch");
    assert.equal(doorBranch("idea"), "idea");
    assert.equal(doorBranch("broken"), "code");
    assert.equal(doorBranch("differs"), "code");
  });

  test("문 → 주소: 세 번째 문만 door=differs를 단다 (기존 ?path=code 링크는 그대로 (b))", () => {
    const doorHref = fn("doorHref");
    assert.equal(doorHref("idea"), "/projects/new?path=idea");
    assert.equal(doorHref("broken"), "/projects/new?path=code");
    assert.equal(doorHref("differs"), "/projects/new?path=code&door=differs");
  });

  test("주소 → 문: 왕복이 맞고, 모르는 door 값은 (b)로, 기획서는 문 (a)의 변형", () => {
    const doorFromSearch = fn("doorFromSearch");
    const doorHref = fn("doorHref");
    for (const d of ["idea", "broken", "differs"]) {
      assert.equal(doorFromSearch(searchOf(doorHref(d)))?.door, d, `round trip ${d}`);
    }
    assert.deepEqual(doorFromSearch({ path: "code", door: "whatever" }), { branch: "code", door: "broken" });
    assert.deepEqual(doorFromSearch({ path: "spec", door: null }), { branch: "spec", door: "idea" });
    assert.equal(doorFromSearch({ path: null, door: null }), null, "갈래 없음 = 갈래 선택 화면");
    assert.equal(doorFromSearch({ path: "nope", door: "differs" }), null);
    assert.equal(doorFromSearch(undefined), null);
  });

  test("의도 확인 카드 문구: 세 번째 문만 '원래 만들려던 것'을 묻는 말로", () => {
    const intentCardCopyKeys = fn("intentCardCopyKeys");
    const differs = intentCardCopyKeys("differs");
    const plain = intentCardCopyKeys("broken");
    assert.notEqual(differs.title, plain.title);
    assert.deepEqual(intentCardCopyKeys(undefined), plain, "문 표시가 없는 옛 프로젝트 = 종전 문구");
    for (const loc of ["ko", "en"]) {
      const c = DICTIONARIES[loc].intentConfirm;
      for (const keys of [differs, plain]) {
        for (const k of Object.values(keys)) {
          assert.equal(typeof c[k], "string", `${loc}.intentConfirm.${k} 없음`);
          assert.ok(c[k].trim().length > 0, `${loc}.intentConfirm.${k} 비어 있음`);
        }
      }
    }
  });
});

describe("사전 — 세 문 카피 KO/EN (Bae 검토 대상)", () => {
  const LABELS = {
    ko: ["아이디어가 있어요", "만든 앱이 안 돼요", "만들었는데 생각과 달라요"],
    en: ["I have an idea", "My app doesn't work", "It works, but not how I meant"],
  };

  for (const loc of ["ko", "en"]) {
    test(`[${loc}] 세 문의 라벨이 정확히 그 문장이다`, () => {
      const b = DICTIONARIES[loc].branch;
      assert.deepEqual([b.ideaTitle, b.codeTitle, b.differsTitle], LABELS[loc]);
    });

    test(`[${loc}] 첫 화면·세 번째 문 문구에 개발 용어 0 · 숫자 점수 0`, () => {
      const b = DICTIONARIES[loc].branch;
      const c = DICTIONARIES[loc].intentConfirm;
      const strings = [
        b.title, b.subtitle, b.ideaTitle, b.ideaDesc, b.codeTitle, b.codeDesc, b.differsTitle, b.differsDesc,
        b.specLink, b.codeStepSubDiffers, c.differsTitle, c.differsSubtitle, c.differsOneLineLabel, c.differsConfirm,
      ];
      for (const s of strings) {
        assert.equal(typeof s, "string", `${loc}: 문구 없음`);
        assert.ok(s.trim().length > 0, `${loc}: 빈 문구`);
        assert.deepEqual(devTermHits(s), [], `${loc}: "${s}" → ${JSON.stringify(devTermHits(s))}`);
        assert.ok(!/\d+\s*\/\s*100|점수|\bscore\b/i.test(s), `${loc}: 숫자 점수 — "${s}"`);
      }
    });
  }

  test("세 번째 문의 확인 카드는 '지금 앱'이 아니라 '원래 의도'를 묻고, 그게 기준이 된다고 말한다", () => {
    const ko = DICTIONARIES.ko.intentConfirm;
    const en = DICTIONARIES.en.intentConfirm;
    assert.match(ko.differsTitle, /원래/);
    assert.match(ko.differsSubtitle, /고쳐|바꿔/);
    assert.match(ko.differsSubtitle, /기준/);
    assert.match(en.differsTitle, /\bmean|\bintend/i);
    assert.match(en.differsSubtitle, /change|correct|edit/i);
    assert.match(en.differsSubtitle, /check against/i);
  });

  test("기획서 갈래는 사라지지 않는다 — 보조 링크 문구가 KO/EN 모두 있다", () => {
    assert.match(DICTIONARIES.ko.branch.specLink, /기획서/);
    assert.match(DICTIONARIES.en.branch.specLink, /plan|spec/i);
  });
});

describe("배선 — 첫 화면·코드 갈래·확인 카드", () => {
  const page = read("app/projects/new/page.tsx");
  const card = read("components/IntentConfirmCard.tsx");
  const store = read("lib/workflow-store.ts");

  /** The chooser block: `{entryPath === null && (` … up to the next top-level step block. */
  function chooserBlock() {
    const i = page.indexOf("{entryPath === null && (");
    assert.ok(i !== -1, "chooser block not found");
    const j = page.indexOf("{entryPath === \"code\" && step === 1", i);
    return page.slice(i, j === -1 ? undefined : j);
  }

  test("첫 화면은 ENTRY_DOORS로 세 문을 그리고, 세 번째 문 라벨을 쓴다", () => {
    assert.match(page, /from "@\/lib\/entry-doors\.mjs"/);
    const block = chooserBlock();
    assert.match(block, /ENTRY_DOORS/);
    assert.match(block, /t\.branch\.differsTitle/);
  });

  test("기획서 갈래는 첫 화면의 보조 링크로 남는다(주 버튼 아님)", () => {
    const block = chooserBlock();
    assert.match(block, /t\.branch\.specLink/);
    assert.match(block, /chooseBranch\("spec"\)/);
  });

  test("[행동 보존 가드] 첫 화면에는 주 버튼이 없다 — 세 문은 동급 카드", () => {
    assert.ok(!/btn-primary/.test(chooserBlock()), "chooser must not carry a primary button");
  });

  test("기존 앱 갈래로 만든 프로젝트는 어느 문으로 왔는지(entryDoor)를 남긴다", () => {
    assert.match(store, /entryDoor\?:\s*"idea"\s*\|\s*"broken"\s*\|\s*"differs"/);
    const i = page.indexOf("async function handleSubmitArtifact");
    const j = page.indexOf("async function handleSave", i);
    assert.ok(i !== -1 && j !== -1);
    assert.match(page.slice(i, j), /entryDoor/);
  });

  test("세 번째 문 첫 화면은 다음 화면에서 원래 의도를 묻는다고 미리 말한다", () => {
    assert.match(page, /t\.branch\.codeStepSubDiffers/);
  });

  test("의도 확인 카드는 entryDoor로 문구 세트를 고른다(흐름·저장은 그대로)", () => {
    assert.match(card, /intentCardCopyKeys/);
    assert.match(card, /entryDoor/);
    // 확정 → D1 미러(C0)는 그대로 — 문구만 바뀐다.
    assert.match(card, /mirrorLocalProjectToDb\(projectId\)/);
  });
});
