/**
 * first-doors.test.mjs — C-N7 (Train C, 계획 2026-09-27 §5 · D-17 amend): 랜딩 첫 화면의 **세 문**
 * 1줄씩 + FAQ 1문항("어떤 도구로 만들었든 되나요?"). 전면 재작성(N7)은 보류 — 첫 문 1줄만.
 *
 * 세 문은 앱의 같은 문으로 곧장 이어진다(대시보드 /projects/new 의 갈래 주소).
 * 규칙: 이 파일의 테스트는 C-N7 전 코드에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { LANDING_DICT } = await import("../src/lib/dictionary.mjs");
const PAGE = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

const LABELS = {
  ko: ["아이디어가 있어요", "만든 앱이 안 돼요", "만들었는데 생각과 달라요"],
  en: ["I have an idea", "My app doesn't work", "Not exactly what I wanted"],
};

describe("hero — 세 문 1줄씩", () => {
  for (const lang of ["ko", "en"]) {
    it(`[${lang}] 세 문 라벨이 정확히 그 문장, 그 순서`, () => {
      const doors = LANDING_DICT[lang].hero.doors;
      assert.ok(doors, `${lang}.hero.doors 없음`);
      assert.deepEqual(doors.items, LABELS[lang]);
      assert.ok(typeof doors.lead === "string" && doors.lead.trim().length > 0, `${lang}.hero.doors.lead 비어 있음`);
    });
  }

  it("첫 화면이 세 문을 그리고, 각 문이 앱의 같은 문으로 간다(세 번째 = door=differs)", () => {
    assert.match(PAGE, /t\.hero\.doors\.items/);
    assert.match(PAGE, /\/projects\/new\?path=idea/);
    assert.match(PAGE, /\/projects\/new\?path=code"/);
    assert.match(PAGE, /\/projects\/new\?path=code&door=differs/);
  });
});

describe("랜딩 ↔ 앱 — 같은 세 문, 같은 질문 (PR #571 검증 결함 4·10)", () => {
  // 앱(대시보드)의 문 정의가 정본이다. 랜딩은 Next 빌드가 따로라 주소를 복제해 두므로,
  // 둘이 갈라지면(한쪽만 바뀌면) 여기서 깨진다.
  const DOORS_LIB = new URL("../../dashboard/src/lib/entry-doors.mjs", import.meta.url);
  const DASH_DICT = new URL("../../dashboard/src/i18n/dictionary.mjs", import.meta.url);

  /** page.tsx의 `const DOOR_PATHS = [ … ] as const;`에서 문자열만 꺼낸다. */
  function doorPathsFromPage() {
    const m = /const DOOR_PATHS = \[([\s\S]*?)\] as const;/.exec(PAGE);
    assert.ok(m, "DOOR_PATHS 배열을 찾지 못함");
    return [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }

  it("[행동 보존 가드] 랜딩 DOOR_PATHS[i] === 대시보드 doorHref(ENTRY_DOORS[i]) — 순서까지", async () => {
    const { ENTRY_DOORS, doorHref } = await import(DOORS_LIB.href);
    assert.deepEqual(doorPathsFromPage(), ENTRY_DOORS.map((d) => doorHref(d)));
  });

  it("EN: 앱 첫 화면 제목 = 랜딩 세 문의 질문 ('Where are you starting from?')", async () => {
    const { DICTIONARIES } = await import(DASH_DICT.href);
    assert.equal(DICTIONARIES.en.branch.title, LANDING_DICT.en.hero.doors.lead);
    // KO를 랜딩('지금 어디쯤이세요?')에 맞출지는 Bae 검토 대상 — 여기서 강제하지 않는다.
  });
});

describe("FAQ — 어떤 도구로 만들었든", () => {
  const find = (lang, re) => LANDING_DICT[lang].faq.items.find((it) => re.test(it.q));

  it("KO/EN 모두 그 질문이 있다", () => {
    assert.ok(find("ko", /^어떤 도구로 만들었든 되나요\?$/), "KO 질문 없음");
    assert.ok(find("en", /^Does it work whatever tool I built it with\?$/), "EN 질문 없음");
  });

  it("답은 정직하다: 앱 주소로 확인하고, 로그인 뒤 화면은 어디까지 봤는지 말한다", () => {
    const ko = find("ko", /어떤 도구로/)?.a ?? "";
    const en = find("en", /whatever tool/)?.a ?? "";
    assert.match(ko, /주소/);
    assert.match(ko, /로그인/);
    assert.match(en, /address/i);
    assert.match(en, /sign-in|log in|login/i);
  });
});
