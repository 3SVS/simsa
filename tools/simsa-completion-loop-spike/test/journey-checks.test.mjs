/**
 * journey-checks.test.mjs — C-J1 (Train C, 계획 2026-09-27 §5): 여정 감사의
 * **화면 구조** 검사 두 가지.
 *
 *   ① 막다른 길 (P0) — 앞으로 가는 버튼·링크가 0개, 또는 빈 상태(0건) 문구만 있고
 *      다음 행동(주 버튼)이 없는 화면. 2026-09-28 Bae 라이브 신고: 저장소 연결 +
 *      주소 없는 프로젝트에서 "첫 검수 실행하기" → /github → "0개 열려 있는 코드
 *      변경(PR)" + "새로고침해주세요" 한 줄 → 다음 버튼 0, 여정 정지.
 *      종전 장비의 `deadEnd`는 "버튼 0개"(사이드바 포함)였다 — 사이드바가 있는 한
 *      절대 참이 되지 않았고, findings 규칙에도 연결돼 있지 않았다.
 *   ② 같은 라벨·다른 목적지 (P1) — 한 화면에서 같은 글자의 링크가 서로 다른 곳으로.
 *
 * 규칙: 이 파일의 테스트는 C-J1 전 코드(lib/journey-checks.mjs 없음, 감사 스크립트
 * 미배선)에서 실패한다. 픽스처는 실제 화면 문구(사전·소스)에서 재구성했다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const LIB = new URL("../lib/journey-checks.mjs", import.meta.url);
// 없으면 빈 객체 — 파일 전체가 로드 실패로 뭉개지지 않고 테스트마다 실패한다.
const mod = existsSync(LIB) ? await import(LIB.href) : {};

const ORIGIN = "https://app.trysimsa.com";
const P = `${ORIGIN}/projects/wsp_demo01`;
/** 루트 레이아웃의 언어 토글은 main 안에 있다 — 앞으로 가는 길이 아니다. */
const LANG = [{ text: "EN", href: null }, { text: "KO", href: null }];

/**
 * 2026-09-28 Bae 신고 화면 — #559 직전 /github (저장소 연결됨 · 열린 PR 0개).
 * 문구는 당시 사전(github.openPulls·noPulls·loadPulls·viewHistory)에서, 요소는
 * 당시 page.tsx(이력 링크·저장소 외부 링크·목록 불러오기 버튼)에서 재구성.
 */
const BAE_PR_ZERO = {
  mainText:
    "코드 변경(PR) 이력 보기 → 연결된 저장소 3SVS/simsa → main 코드 변경(PR) 목록 불러오기 " +
    "0 개 열려 있는 코드 변경(PR) 확인할 코드 변경(PR)이 없어요. PR(pull request)은 새 코드를 검토용으로 " +
    "제안하는 방식이에요 — 사용 중인 AI 도구에서 \"PR 만들기\" 또는 \"GitHub에 푸시\" 기능을 실행한 뒤 여기서 새로고침해주세요.",
  hasEditableField: false,
  mainActions: [
    ...LANG,
    { text: "이력 보기 →", href: `${P}/github/history` },
    { text: "3SVS/simsa", href: "https://github.com/3SVS/simsa", external: true },
    { text: "코드 변경(PR) 목록 불러오기", href: null },
  ],
};

/** #559 D8 이후 같은 화면: "PR이 없는 게 보통" + 주 버튼 "실제 앱 확인하기". */
const PR_ZERO_FIXED = {
  mainText:
    "코드 변경(PR) — 개발자용 확인할 코드 변경(PR)이 없어요. 코드를 직접 다루지 않으면 PR이 없는 게 보통이에요. " +
    "앱이 제대로 작동하는지는 실제 앱을 열어 확인해요. 실제 앱 확인하기",
  hasEditableField: false,
  mainActions: [
    ...LANG,
    { text: "이력 보기 →", href: `${P}/github/history` },
    { text: "실제 앱 확인하기", href: `${P}/visual-checks`, primary: true },
  ],
};

describe("① 막다른 길 — deadEndCheck (C-J1)", () => {
  it("★Bae 신고 화면(PR 0개 + 새로고침 안내만)은 막다른 길이다 — 빈 상태 + 주 버튼 없음", () => {
    const r = mod.deadEndCheck(BAE_PR_ZERO);
    assert.equal(r.deadEnd, true);
    assert.equal(r.kind, "empty_state_without_action");
    assert.match(r.emptyState, /0 개 열려 있는/, "빈 상태 문구를 그대로 남긴다(개수만 세지 않는다)");
  });

  it("같은 빈 상태라도 주 버튼(실제 앱 확인하기)이 있으면 막다른 길이 아니다 — #559 D8 이후", () => {
    const r = mod.deadEndCheck(PR_ZERO_FIXED);
    assert.equal(r.deadEnd, false);
    assert.deepEqual(r.primaryForward, ["실제 앱 확인하기"]);
  });

  it("앞으로 가는 것이 0개면(뒤로·언어·복사·외부 링크뿐) 빈 상태 문구가 없어도 막다른 길", () => {
    const r = mod.deadEndCheck({
      mainText: "고칠 내용을 쓰시는 도구에 붙여넣어 주세요.",
      hasEditableField: false,
      mainActions: [
        ...LANG,
        { text: "← 개요로 돌아가기", href: P },
        { text: "복사하기", href: null },
        { text: "Lovable 열기", href: "https://lovable.dev/", external: true },
        { text: "나중에", href: null },
      ],
    });
    assert.equal(r.deadEnd, true);
    assert.equal(r.kind, "no_forward_action");
    assert.deepEqual(r.forward, []);
  });

  it("입력칸이 있으면 비활성 주 버튼도 앞으로 가는 길이다(칸을 채우면 켜진다) — 코드 갈래 첫 화면", () => {
    const r = mod.deadEndCheck({
      mainText: "만드신 앱을 보여주세요 앱 주소 또는 GitHub 저장소",
      hasEditableField: true,
      mainActions: [...LANG, { text: "← 처음 선택으로 돌아가기", href: null }, { text: "검수 시작하기 →", href: null, primary: true, disabled: true }],
    });
    assert.equal(r.deadEnd, false);
  });

  it("입력칸이 없는데 주 버튼이 비활성뿐이면 막다른 길", () => {
    const r = mod.deadEndCheck({
      mainText: "확인 결과",
      hasEditableField: false,
      mainActions: [...LANG, { text: "다시 확인하기", href: null, primary: true, disabled: true }],
    });
    assert.equal(r.deadEnd, true);
    assert.equal(r.kind, "no_forward_action");
  });

  it("빈 상태 화면의 하단 '다음 한 걸음' 바(주 버튼 링크)는 다음 행동으로 센다", () => {
    const r = mod.deadEndCheck({
      mainText: "아직 확인 결과가 없어요. 앱이 제대로 작동하는지는 실제 앱을 열어 확인해요.",
      hasEditableField: false,
      mainActions: [...LANG, { text: "앱 확인하기 →", href: `${P}/visual-checks`, primary: true }],
    });
    assert.equal(r.deadEnd, false);
  });

  it("빈 상태 + 보조 링크만(주 버튼 없음) = 막다른 길 — 다음 행동이 버튼으로 안 보인다", () => {
    const r = mod.deadEndCheck({
      mainText: "No checks yet.",
      hasEditableField: false,
      mainActions: [...LANG, { text: "View history →", href: `${P}/visual-checks/history` }],
    });
    assert.equal(r.deadEnd, true);
    assert.equal(r.kind, "empty_state_without_action");
  });
});

describe("① 빈 상태 문구 감지 — emptyStateSnippet", () => {
  it("0개·0건·'아직 … 없어요'·No … yet·Nothing here 를 잡는다", () => {
    assert.match(mod.emptyStateSnippet("0 개 열려 있는 코드 변경"), /0 개/);
    assert.match(mod.emptyStateSnippet("검수 0건"), /0건/);
    assert.match(mod.emptyStateSnippet("아직 확인 결과가 없어요."), /아직 확인 결과가 없어요/);
    assert.match(mod.emptyStateSnippet("No open code changes found."), /No open code changes found/);
    assert.match(mod.emptyStateSnippet("No checks yet."), /No checks yet/);
    assert.match(mod.emptyStateSnippet("Nothing here yet — this project started from code"), /Nothing here yet/);
  });

  it("0이 들어간 다른 수(10개·2.0건)나 일상어('걱정 없어요')는 빈 상태가 아니다", () => {
    assert.equal(mod.emptyStateSnippet("항목 10개를 확인했어요"), "");
    assert.equal(mod.emptyStateSnippet("버전 2.0건 기록"), "");
    assert.equal(mod.emptyStateSnippet("걱정 없어요, 다 됐어요"), "");
    assert.equal(mod.emptyStateSnippet(""), "");
    assert.equal(mod.emptyStateSnippet(undefined), "");
  });
});

describe("② 같은 라벨·다른 목적지 — sameLabelDifferentHref (C-J1)", () => {
  it("사이드바 '앱 확인하기'와 본문 '앱 확인하기 →'가 서로 다른 곳이면 잡는다", () => {
    const groups = mod.sameLabelDifferentHref([
      { text: "앱 확인하기", href: `${P}/visual-checks` },
      { text: "앱 확인하기 →", href: `${P}/settings` },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "앱 확인하기");
    assert.deepEqual(groups[0].hrefs.sort(), ["/projects/wsp_demo01/settings", "/projects/wsp_demo01/visual-checks"]);
  });

  it("같은 목적지로 읽어야 하는 것: 일회성 파라미터(fresh)·해시·끝 슬래시·파라미터 순서", () => {
    assert.deepEqual(
      mod.sameLabelDifferentHref([
        { text: "새 프로젝트", href: `${ORIGIN}/projects/new?fresh=k1` },
        { text: "새 프로젝트", href: `${ORIGIN}/projects/new` },
        { text: "개요", href: `${P}#app-address` },
        { text: "개요", href: `${P}/` },
        { text: "설정", href: `${P}/settings?a=1&b=2` },
        { text: "설정", href: `${P}/settings?b=2&a=1` },
      ]),
      [],
    );
  });

  it("쿼리가 목적지를 바꾸면(?path=idea vs ?path=code) 다른 목적지다", () => {
    const groups = mod.sameLabelDifferentHref([
      { text: "시작하기", href: `${ORIGIN}/projects/new?path=idea` },
      { text: "시작하기", href: `${ORIGIN}/projects/new?path=code` },
    ]);
    assert.equal(groups.length, 1);
  });

  it("라벨 없는 링크·mailto 는 비교하지 않는다", () => {
    assert.deepEqual(
      mod.sameLabelDifferentHref([
        { text: "", href: `${P}/a` },
        { text: "", href: `${P}/b` },
        { text: "문의", href: "mailto:a@example.com" },
        { text: "문의", href: `${ORIGIN}/contact` },
      ]),
      [],
    );
  });
});

describe("findings — structureFindings (C-J1)", () => {
  it("★Bae 신고 화면 → P0 막다른 길, 빈 상태 문구 동반", () => {
    const structure = mod.stepStructure({ ...BAE_PR_ZERO, links: [] });
    const out = mod.structureFindings({ label: "개요 — 지금 할 일이 이 갈래에 맞는가", structure });
    assert.equal(out.length, 1);
    assert.equal(out[0].sev, "P0");
    assert.match(out[0].what, /막다른 길/);
    assert.match(out[0].what, /0 개 열려 있는/);
  });

  it("같은 라벨·다른 목적지 → P1, 두 목적지를 경로로 적는다", () => {
    const structure = mod.stepStructure({
      ...PR_ZERO_FIXED,
      links: [
        { text: "앱 확인하기", href: `${P}/visual-checks` },
        { text: "앱 확인하기", href: `${P}/settings` },
      ],
    });
    const out = mod.structureFindings({ label: "개요", structure });
    assert.equal(out.length, 1);
    assert.equal(out[0].sev, "P1");
    assert.match(out[0].what, /"앱 확인하기"/);
    assert.match(out[0].what, /\/visual-checks/);
    assert.match(out[0].what, /\/settings/);
  });

  it("계획된 진행 중 스냅샷('변환 중')은 막다른 길로 세지 않는다 — 기존 primary-0 규칙과 같은 예외", () => {
    const structure = mod.stepStructure({ mainText: "", hasEditableField: false, mainActions: LANG, links: [] });
    assert.equal(structure.deadEnd.deadEnd, true);
    assert.deepEqual(mod.structureFindings({ label: "변환 중/직후", structure }), []);
  });

  it("구조 정보가 없는 옛 행(structure 없음)은 조용히 넘어간다", () => {
    assert.deepEqual(mod.structureFindings({ label: "x" }), []);
  });
});

describe("배선 — journey-audit.mjs가 이 규칙들을 실제로 쓴다", () => {
  const src = readFileSync(new URL("../journey-audit.mjs", import.meta.url), "utf8");
  // 소스 전체를 실패 메시지에 쏟지 않게 불리언으로 단언한다.
  const has = (re) => re.test(src);

  it("구조 검사(stepStructure·structureFindings)를 불러 findings에 넣는다", () => {
    assert.ok(has(/from "\.\/lib\/journey-checks\.mjs"/), "journey-checks.mjs import 없음");
    assert.ok(has(/stepStructure\(/), "stepStructure 호출 없음");
    assert.ok(has(/structureFindings\(/), "structureFindings 호출 없음");
  });

  it("초보자 심각도는 lib의 beginnerFindings가 정한다(스크립트 인라인 삼항 제거)", () => {
    assert.ok(has(/beginnerFindings\(/), "beginnerFindings 호출 없음");
    assert.ok(!has(/isDefaultFlowJourney\(j\.name\)\s*\?\s*"P0"\s*:\s*"P2"/), "인라인 심각도 삼항이 남아 있음");
  });

  it("옛 deadEnd(버튼 0개 — 사이드바 포함이라 항상 거짓)를 더 쓰지 않는다", () => {
    assert.ok(!has(/deadEnd:\s*buttons\.length\s*===\s*0/), "옛 deadEnd 계산이 남아 있음");
  });
});
