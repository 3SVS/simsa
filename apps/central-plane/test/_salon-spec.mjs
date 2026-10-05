/**
 * _salon-spec.mjs — 벤치마크 #1(동네 1인 미용실 예약)과 같은 모양의 유효한 지시서 픽스처(글롭 밖 이름).
 * source·확인 목록은 문(門)마다 바꿔 쓴다: idea=generated, spec(기획서)=generated+entry spec, code=inferred+확인.
 */
export function salonSpec({ source = "generated", confirmed = undefined } = {}) {
  return {
    meta: {
      version: 1,
      source,
      locale: "ko",
      generatedAt: "2026-10-05T03:00:00.000Z",
      ...(confirmed ? { provenance: { userConfirmedAcIds: confirmed } } : {}),
    },
    brief: { productName: "동네 미용실 예약", oneLine: "손님이 시간을 골라 예약하고 사장님이 오늘 예약을 본다", targetUsers: [], problem: "p", included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [] },
    features: [
      { id: "FR-001", title: "예약하기", description: "날짜·시간·이름·휴대폰으로 예약", priority: "must" },
      { id: "FR-002", title: "중복 예약 막기", description: "이미 예약된 시간은 다른 손님이 못 고름", priority: "must" },
      { id: "FR-003", title: "사장님 오늘 예약", description: "관리 화면에서 오늘 예약을 시간순으로", priority: "must" },
      { id: "FR-004", title: "디자인 느낌", description: "따뜻한 느낌", priority: "should" },
    ],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "10:30·김서연·010-1234-5678로 예약", then: "예약 완료 화면에 예약 내용이 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-002", given: "10:30이 예약됨", when: "다른 손님이 같은 날 시간을 고름", then: "10:30은 고를 수 없다", verifiedBy: "browser" },
      { id: "AC-003", featureId: "FR-003", given: "오늘 예약 1건", when: "사장님이 관리 화면을 연다", then: "오늘 예약 목록에 10:30 김서연이 보인다", verifiedBy: "browser" },
      { id: "AC-004", featureId: "FR-004", given: "g", when: "w", then: "따뜻한 느낌이다", verifiedBy: "human" },
    ],
    screens: [
      { id: "SCR-001", route: "/", purpose: "p", components: ["예약"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001", "FR-002", "FR-004"] },
      { id: "SCR-002", route: "/admin", purpose: "사장님 관리", components: ["오늘 예약"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-003"] },
    ],
    dataModel: [],
    apis: [],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "전부", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002", "AC-003", "AC-004"] }],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "10:30 고르기", "예약하기 누름"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["예약 뒤 새 브라우저로 / 열기", "10:30 확인"] },
      { kind: "browser", acceptanceId: "AC-003", steps: ["/admin 열기"] },
    ],
    assumptions: [],
    openQuestions: [],
  };
}
