/**
 * g1-sets.mjs — 검사 엔진 v2 G1(설계 §4: 미용실 6 + 파일럿 7 = 13앱)의 대상·사전 등록 기준·정답 칸 (2026-11-15).
 *
 * 두 묶음은 프롬프트가 달라 기준(AC)도 따로다:
 *   - bench1(미용실 6): agent-bench1-local.mjs의 APPS·A1~A10·의도 그대로(여기서 고치지 않는다).
 *   - pilot1(파일럿 7): docs/pilot-2026-10/intent-prompt-2026-10-04.md §3 I1~I7 + 앱별 정답지(answer-key-*.md)를
 *     칸으로 옮긴 것. 옮긴 근거는 docs/pilot-2026-10/g1-prereg-2026-11-15.md §2(정답지 원문 관찰 → 칸) — 정답지 내용은 바꾸지 않았다.
 *
 * 칸 종류:
 *   mustFailed    정답지에서 ❌인 must 칸 — 짚어야 할 칸(분모)
 *   mismatch      mustFailed 중 "만든 것 ≠ 원한 것"(의도 불일치) 칸 — G1 의도 불일치 지표의 분모
 *   unknown       정답지가 "미확인/미검증"으로 남긴 칸 — fail이어도 '없는 결함'으로 세지 않는다
 *   intermittent  간헐 결함 — 짚으면 보너스로 기록, 못 짚어도 놓침 아님(분모 밖)
 *   entryBroken   첫 화면부터 열리지 않는 앱 — 칸 1개(ENTRY)로 센다
 *   timeDependent KST 00~09시에만 드러나는 칸(bench1 v0·bolt) — 낮 실행에선 판정 대상 아님
 *
 * 이 파일의 칸을 고치는 것은 정답지를 고치는 것과 같다 — 첫 G1 실행 뒤에는 [정정 날짜]로만 덧붙인다.
 */
import { APPS as BENCH1_APPS, BENCH1_PREREG_ACS, BENCH1_INTENT } from "./agent-bench1-local.mjs";

/** 파일럿 검사 대상으로 넣을 입력 앱(2026-10-04 정답지 작성 때 쓴 것과 같은 픽스처). */
export const PILOT1_BROKEN_INPUT = "https://simsa-inspection-fixtures.seunghunbae.workers.dev/potemkin-crm";
export const PILOT1_WORKING_INPUT = "https://simsa-inspection-fixtures.seunghunbae.workers.dev/working-todo";

/** 사전 등록 프롬프트(intent-prompt-2026-10-04.md §1)를 사용자가 카드에 적었을 법한 한 문장으로(고정값). */
export const PILOT1_INTENT =
  "한국어만 쓰는 비개발자가 AI로 만든 자기 앱의 주소를 넣으면, 그 앱이 실제로 작동하는지 검토하고 고장 난 곳이 어디서 왜 고장 났는지 진단해, 고친 결과물이나 다른 AI에게 넘길 개발지시서를 한국어로 내놓는 서비스";

/**
 * I1~I7(intent-prompt-2026-10-04.md §3)을 agent AC 모양으로. id = 의도 항목 번호 그대로.
 * I5·I6은 사전 등록상 "must(둘 중 하나)"다. 주입 AC는 각각 판정되므로 둘 다 must로 두면 하나만 해도 Needs Fix가 된다
 * → should로 주입하고 칸 채점에 넣지 않는다(정답지도 6앱 모두 I5·I6 내용 미검증).
 */
export const PILOT1_PREREG_ACS = Object.freeze(
  [
    { id: "I1", title: "화면과 검토 결과가 한국어로 나온다", given: "앱 첫 화면", when: "안내·버튼·검토 결과의 글을 읽는다", then: "영어를 몰라도 쓸 수 있게 화면과 결과가 한국어로 나온다", priority: "must" },
    { id: "I2", title: "내가 만든 앱의 주소를 넣고 검토를 시작할 수 있다", given: "앱 첫 화면", when: `검토할 앱 주소 ${PILOT1_BROKEN_INPUT} 를 넣고(필요하면 짧은 설명도) 검토를 시작한다`, then: "입력을 받아 검토가 시작된다", priority: "must" },
    { id: "I3", title: "넣은 앱을 실제로 검토한 결과를 보여준다", given: `검토할 앱 주소 ${PILOT1_BROKEN_INPUT} 와 ${PILOT1_WORKING_INPUT} 를 각각 넣을 수 있다`, when: "두 주소를 각각 검토한다", then: "넣은 앱을 실제로 확인한 결과가 나온다 — 주소가 달라지면 결과도 그 앱에 맞게 달라진다(입력과 무관한 고정·예시 결과가 아니다)", priority: "must" },
    { id: "I4", title: "고장 난 곳이 어디서 왜 고장 났는지 진단한다", given: `고장 난 앱 ${PILOT1_BROKEN_INPUT} 를 넣고 검토했다`, when: "검토 결과를 본다", then: "그 앱에서 어디가 왜 고장 났는지 그 앱에 맞게 알려 준다", priority: "must" },
    { id: "I5", title: "고친 결과물을 내놓는다", given: `고장 난 앱 ${PILOT1_BROKEN_INPUT} 를 검토했다`, when: "고치기 결과를 찾는다", then: "고친 코드나 파일 같은 결과물을 받을 수 있다", priority: "should" },
    { id: "I6", title: "다른 AI에게 넘길 개발지시서를 내놓는다", given: `고장 난 앱 ${PILOT1_BROKEN_INPUT} 를 검토했다`, when: "개발지시서를 찾는다", then: "그 앱의 고장에 맞춘, 다른 AI에게 그대로 넘길 수 있는 개발지시서를 받을 수 있다", priority: "should" },
    { id: "I7", title: "개발 용어를 몰라도 따라갈 수 있다", given: "앱의 모든 화면", when: "처음부터 결과까지 따라간다", then: "API 키 발급이나 영문 로그 복사 같은 개발 지식 없이 끝까지 갈 수 있다", priority: "should" },
  ].map((a) => Object.freeze({ ...a, confirmed: true })),
);

/**
 * 파일럿 칸(정답지 → 칸 근거는 g1-prereg-2026-11-15.md §2). baeCheck = 정답지에 "Bae 확인 필요"로 남은 분류.
 * v0(https://verifiy-sigma.vercel.app/)는 뺐다: 2026-11-15 주소가 다른 사이트("일곱 나라 생일점", 11-13 배포)를 보여준다 — 앱이 없어졌다.
 */
export const PILOT1_APPS = [
  { id: "p-lovable", url: "https://agent-fix-korea.lovable.app/", expected: "works", mustFailed: [], intermittent: ["I1"] },
  { id: "p-bolt", url: "https://korean-ai-agent-revi-bg0l.bolt.host/", expected: "broken_or_hold", mustFailed: ["I3", "I4"], mismatch: ["I3", "I4"], baeCheck: "정답지 문 (c) — 핵심 흐름 부재로 (b)로 볼지" },
  { id: "p-gemini1", url: "https://stellar-mandazi-2a81dc.netlify.app/", expected: "broken", mustFailed: [], entryBroken: true },
  { id: "p-gemini2", url: "https://incandescent-sorbet-62ee76.netlify.app/", expected: "broken", mustFailed: ["I3", "I4"], unknown: ["I2"] },
  { id: "p-chatgpt", url: "https://roaring-bombolone-cb0580.netlify.app/", expected: "broken", mustFailed: ["I3", "I4"] },
  { id: "p-claude", url: "https://beamish-capybara-2bf1d8.netlify.app/", expected: "broken_or_hold", mustFailed: ["I3"], mismatch: ["I3"], unknown: ["I4"], baeCheck: "정답지 문 (c) — API 키 없이는 점검이 시작되지 않음을 (b)로 볼지" },
];

export const G1_SETS = Object.freeze([
  { id: "bench1", intent: BENCH1_INTENT, acs: BENCH1_PREREG_ACS, apps: BENCH1_APPS.map((a) => ({ ...a, id: `s-${a.id}` })) },
  { id: "pilot1", intent: PILOT1_INTENT, acs: PILOT1_PREREG_ACS, apps: PILOT1_APPS },
]);
