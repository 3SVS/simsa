/**
 * entry-doors.test.mjs — C-N7 (Train C, 계획 2026-09-27 §5 · D-17 amend): 첫 화면의 **세 문**.
 *
 *   아이디어가 있어요 / 만든 앱이 안 돼요 / 만들었는데 생각과 달라요
 *   I have an idea / My app doesn't work / Not exactly what I wanted
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
    en: ["I have an idea", "My app doesn't work", "Not exactly what I wanted"],
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
    // PR #571 검증 결함 1·9: 칸은 비어 있고(지금 앱 문장은 읽기 전용 참고) 사용자가 **직접 적는다** —
    // "고쳐 주세요"는 미리 채워진 칸을 전제한 말이라 더는 맞지 않는다.
    assert.match(ko.differsSubtitle, /적어/);
    assert.match(ko.differsSubtitle, /기준/);
    assert.match(en.differsTitle, /\bmean|\bintend/i);
    assert.match(en.differsSubtitle, /\bwrite\b|\btell us\b/i);
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
    // 확정 → D1 미러(C0)는 그대로 — 문구만 바뀐다. #577(C-A7) 이후 미러는
    // mirrorThenBuildIntentRuler 안에서 먼저 돈다(미러 → 역추론 지시서).
    assert.match(card, /mirrorThenBuildIntentRuler\(projectId/);
    assert.match(read("lib/intent-ruler.ts"), /await mirrorLocalProjectToDb\(projectId\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR #571 검증 결함 수정 (2026-10-01). 아래 테스트는 수정 전 head(8e30219)에서 실패한다.
// ─────────────────────────────────────────────────────────────────────────────

const cardSrc = read("components/IntentConfirmCard.tsx");
const recheckLib = await import("../src/lib/visual-check-recheck.mjs");

/** A `{phase === "<p>" && (` … `)}` block of IntentConfirmCard (up to the next phase block or the card's end). */
function phaseBlock(src, phase) {
  const i = src.indexOf(`{phase === "${phase}" && (`);
  assert.ok(i !== -1, `phase "${phase}" block not found`);
  const rest = src.slice(i + 1);
  const next = rest.search(/\{phase === "[a-z]+" && \(/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("결함 10 — 저장할 문 값은 순수 함수가 정한다 (entryDoorForSave)", () => {
  test("differs → differs, 그 밖(없음·broken·모르는 값) → broken", () => {
    const entryDoorForSave = fn("entryDoorForSave");
    assert.equal(entryDoorForSave("differs"), "differs");
    for (const v of ["broken", null, undefined, "idea", "whatever"]) {
      assert.equal(entryDoorForSave(v), "broken", `entryDoorForSave(${String(v)})`);
    }
  });

  test("handleSubmitArtifact가 entryDoorForSave(entryDoor)로 저장한다 — 'broken' 고정 회귀가 초록으로 남지 않게", () => {
    const page = read("app/projects/new/page.tsx");
    const i = page.indexOf("async function handleSubmitArtifact");
    const j = page.indexOf("async function handleSave", i);
    const body = page.slice(i, j);
    assert.match(body, /entryDoor: entryDoorForSave\(entryDoor\)/);
    assert.doesNotMatch(body, /entryDoor: "broken"/);
  });
});

describe("결함 1·9 — 문 (c) 카드: 지금 앱 문장은 참고일 뿐, '원래 만들려던 것' 칸은 비워 둔다", () => {
  const NOW = "사진을 올리면 자동으로 보정해 주는 앱";

  test("intentCardDraft: 문 (c)는 칸을 비우고 추론 문장을 읽기 전용 참고로 돌려준다", () => {
    const intentCardDraft = fn("intentCardDraft");
    assert.deepEqual(intentCardDraft("differs", `  ${NOW} `), { initialOneLine: "", readNow: NOW });
    assert.deepEqual(intentCardDraft("differs", ""), { initialOneLine: "", readNow: null }, "읽은 게 없으면 참고 줄도 없다");
    assert.deepEqual(intentCardDraft("differs", undefined), { initialOneLine: "", readNow: null });
  });

  test("[행동 보존 가드 성격] intentCardDraft: 문 (b)·옛 프로젝트는 종전처럼 칸을 추론 문장으로 채운다", () => {
    const intentCardDraft = fn("intentCardDraft");
    assert.deepEqual(intentCardDraft("broken", ` ${NOW}`), { initialOneLine: NOW, readNow: null });
    assert.deepEqual(intentCardDraft(null, NOW), { initialOneLine: NOW, readNow: null });
  });

  test("intentCardCanConfirm: 문 (c)는 칸이 비었거나 지금 앱 문장과 같으면 확정할 수 없다", () => {
    const can = fn("intentCardCanConfirm");
    assert.equal(can({ entryDoor: "differs", oneLine: "", inferredOneLine: NOW }), false);
    assert.equal(can({ entryDoor: "differs", oneLine: "   ", inferredOneLine: NOW }), false);
    assert.equal(can({ entryDoor: "differs", oneLine: NOW, inferredOneLine: NOW }), false, "한 번 누르기로 지금 앱이 기준이 되면 안 된다");
    assert.equal(can({ entryDoor: "differs", oneLine: `  사진을 올리면  자동으로 보정해 주는 앱 `, inferredOneLine: NOW }), false, "공백만 다른 건 같은 문장");
    assert.equal(can({ entryDoor: "differs", oneLine: "사진 보정 전에 원본과 나란히 비교해서 고르게 해 주는 앱", inferredOneLine: NOW }), true);
    assert.equal(can({ entryDoor: "differs", oneLine: "원래 의도", inferredOneLine: "" }), true, "읽은 게 없으면 적은 게 있기만 하면 된다");
  });

  test("[행동 보존 가드] intentCardCanConfirm: 문 (b)의 '네, 맞아요'는 종전처럼 항상 누를 수 있다", () => {
    const can = fn("intentCardCanConfirm");
    assert.equal(can({ entryDoor: "broken", oneLine: NOW, inferredOneLine: NOW }), true);
    assert.equal(can({ entryDoor: null, oneLine: "", inferredOneLine: NOW }), true);
  });

  test("문 (c)의 항목 안내는 문 (b)와 다른 키 — '지금 앱에서 읽은 항목'이라고 말한다", () => {
    const keys = fn("intentCardCopyKeys");
    assert.equal(keys("differs").itemsHint, "differsItemsHint");
    assert.equal(keys("broken").itemsHint, "itemsHint");
    assert.equal(keys(undefined).itemsHint, "itemsHint");
    assert.match(DICTIONARIES.ko.intentConfirm.differsItemsHint, /지금 앱/);
    assert.match(DICTIONARIES.ko.intentConfirm.differsItemsHint, /체크를 풀/);
    assert.match(DICTIONARIES.en.intentConfirm.differsItemsHint, /\bnow\b/i);
    assert.match(DICTIONARIES.en.intentConfirm.differsItemsHint, /uncheck/i);
  });

  test("지금 앱 참고 줄 라벨이 KO/EN 모두 있다", () => {
    assert.match(DICTIONARIES.ko.intentConfirm.differsReadNowLabel, /지금 앱/);
    assert.match(DICTIONARIES.en.intentConfirm.differsReadNowLabel, /your app now|as it is now/i);
  });

  test("카드 배선: 초안·확정 가능 여부는 순수 함수로, 참고 줄은 읽기 전용, 항목 안내는 문별 키", () => {
    assert.match(cardSrc, /intentCardDraft\(/);
    assert.match(cardSrc, /intentCardCanConfirm\(/);
    // 옛 코드: 문 구분 없이 추론 문장을 칸에 채웠다.
    assert.doesNotMatch(cardSrc, /setOneLine\(\(spec\.oneLine \?\? ""\)\.trim\(\)\)/);
    const ready = phaseBlock(cardSrc, "ready");
    assert.match(ready, /c\.differsReadNowLabel/);
    assert.match(ready, /c\[k\.itemsHint\]/);
    assert.doesNotMatch(ready, /\{c\.itemsHint\}/);
    // 확정 버튼은 canConfirm이 거짓이면 꺼진다.
    assert.match(ready, /onClick=\{confirm\}\s+disabled=\{!canConfirm\}/);
  });
});

describe("결함 2 — 앱을 읽지 못해도(error) 원래 의도를 적을 칸이 있다", () => {
  test("error 단계에 입력 칸·저장하기·다시 시도가 함께 있다 (empty 단계와 같은 입력)", () => {
    const err = phaseBlock(cardSrc, "error");
    assert.match(err, /c\.errorLead/);
    assert.match(err, /c\.retry/);
    assert.match(err, /<ManualIntentInput/, "error 단계에 직접 적는 칸이 없다");
    const empty = phaseBlock(cardSrc, "empty");
    assert.match(empty, /<ManualIntentInput/, "empty 단계와 같은 입력을 쓴다");
    // 입력 컴포넌트가 라벨·저장 버튼을 갖는다.
    const m = cardSrc.indexOf("function ManualIntentInput");
    assert.ok(m !== -1, "ManualIntentInput 없음");
    const comp = cardSrc.slice(m);
    assert.match(comp, /oneLineLabel/);
    assert.match(comp, /saveMine/);
  });
});

describe("결함 3 — 문 (c)에서 확정한 뒤 '이 기준으로 다시 확인'을 권한다 (자동 재실행 없음)", () => {
  test("intentCardAfterConfirm: 문 (c)만 재확인 안내, 나머지는 종전처럼 카드가 사라진다", () => {
    const after = fn("intentCardAfterConfirm");
    assert.equal(after("differs"), "recheck");
    assert.equal(after("broken"), "hide");
    assert.equal(after(null), "hide");
    assert.equal(after(undefined), "hide");
  });

  test("안내 문구·버튼·진행 중 문구가 KO/EN 모두 있고, 개발 용어·숫자 점수가 없다", () => {
    for (const loc of ["ko", "en"]) {
      const c = DICTIONARIES[loc].intentConfirm;
      for (const k of ["differsRecheckLead", "differsRecheckButton", "differsRecheckBusy", "differsReadNowLabel", "differsItemsHint"]) {
        assert.equal(typeof c[k], "string", `${loc}.intentConfirm.${k} 없음`);
        assert.ok(c[k].trim().length > 0, `${loc}.intentConfirm.${k} 비어 있음`);
        assert.deepEqual(devTermHits(c[k]), [], `${loc}.${k}: ${JSON.stringify(devTermHits(c[k]))}`);
        assert.ok(!/\d+\s*\/\s*100|점수|\bscore\b/i.test(c[k]), `${loc}.${k}: 숫자 점수`);
      }
    }
    assert.match(DICTIONARIES.ko.intentConfirm.differsRecheckLead, /다시 확인/);
    assert.match(DICTIONARIES.en.intentConfirm.differsRecheckLead, /check again/i);
  });

  test("intentRecheckBody: 확정한 문장을 명시 intent로 싣는다 (앞뒤 공백 정리 · 서버 상한 1000자에서 자름 · 빈 문장이면 intent 없음)", () => {
    const intentRecheckBody = recheckLib.intentRecheckBody;
    assert.equal(typeof intentRecheckBody, "function", "intentRecheckBody is not exported from visual-check-recheck.mjs");
    assert.deepEqual(intentRecheckBody("  사진 보정 전에 원본과 나란히 비교해서 고르게 해 주는 앱 ", "uk_1", "ko"), {
      userKey: "uk_1",
      locale: "ko",
      intent: "사진 보정 전에 원본과 나란히 비교해서 고르게 해 주는 앱",
    });
    const long = "가".repeat(1200);
    assert.equal(intentRecheckBody(long, "uk_1", "en").intent.length, 1000, "서버는 1000자 초과를 invalid_intent로 거절한다");
    assert.deepEqual(intentRecheckBody("   ", "uk_1", "en"), { userKey: "uk_1", locale: "en" });
    assert.deepEqual(intentRecheckBody(undefined, "uk_1", "ko"), { userKey: "uk_1", locale: "ko" });
  });

  test("카드 배선: 확정 뒤 문 (c)는 'confirmed' 단계로, 재확인은 버튼을 눌렀을 때만(보조 버튼), 확정한 문장을 의도로 보낸다", () => {
    const body = cardSrc.slice(cardSrc.indexOf("  function confirm()"));
    const confirmFn = body.slice(0, body.indexOf("\n  }\n"));
    assert.match(confirmFn, /intentCardAfterConfirm\(entryDoor\) === "recheck" \? "confirmed" : "done"/);
    const confirmed = phaseBlock(cardSrc, "confirmed");
    assert.match(confirmed, /c\.differsRecheckLead/);
    assert.match(confirmed, /onClick=\{\(\) => void recheckWithIntent\(\)\}/);
    assert.match(confirmed, /btn-secondary/);
    assert.doesNotMatch(confirmed, /btn-primary/, "화면의 주 버튼은 지휘 센터 하나 — 카드는 보조");
    // 요청 본문은 확정한 문장을 intent로 싣는 순수 함수가 만든다.
    assert.match(cardSrc, /runVisualCheck\(projectId, intentRecheckBody\(/);
    // 자동 재실행 금지(일일 상한): runVisualCheck는 recheckWithIntent 안에서만 부른다.
    assert.equal(cardSrc.split("runVisualCheck(").length - 1, 1, "runVisualCheck 호출은 한 곳뿐");
    const fnStart = cardSrc.indexOf("async function recheckWithIntent");
    assert.ok(fnStart !== -1, "recheckWithIntent 없음");
    assert.ok(cardSrc.indexOf("runVisualCheck(") > fnStart, "runVisualCheck가 recheckWithIntent 밖에 있다");
  });
});

describe("결함 4 — EN 첫 화면 제목이 세 문의 답과 이어진다", () => {
  test("EN branch.title = 'Where are you starting from?' (랜딩 lead와 같은 질문)", () => {
    assert.equal(DICTIONARIES.en.branch.title, "Where are you starting from?");
  });
});
