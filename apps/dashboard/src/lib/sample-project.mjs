/**
 * sample-project.mjs — G10 첫 5분 체험 (docs/simsa-gap-backlog-2026-07-18.md).
 *
 * 입력도 LLM 대기도 없이, 제품의 전체 루프가 이미 채워진 예시 프로젝트를
 * 로컬에 원클릭 생성한다: 제품 설명서 + 항목 + 검수 결과(2중 확인 배지 포함)
 * + 실패 항목의 고쳐보기 제안까지. 사용자는 여기서 재검수(회귀 비교),
 * 고쳐보기, 빌더팩 내보내기를 실제 기능 그대로 눌러볼 수 있다.
 *
 * 결정론(무작위는 id 접미사뿐) — 내용 정합성은 테스트로 고정:
 * 검수 결과가 항목과 일치하고, 실패 항목엔 고쳐보기가 있어 export 화면이
 * "수정 지시 담김"(fixes_ready) 상태로 보인다.
 */

export const SAMPLE_ID_PREFIX = "sample_";

/**
 * @returns {{ project: import("./mock-data").Project, ext: import("./workflow-store").ExtendedProjectData }}
 */
export function buildSampleProject() {
  const id = `${SAMPLE_ID_PREFIX}${Math.random().toString(36).slice(2, 10)}`;

  const project = {
    id,
    name: "동네 빵집 예약 앱 (예시)",
    description: "단골손님이 아침 빵을 미리 예약하고 찾아가는 웹앱",
    createdAt: new Date().toISOString().slice(0, 10),
    spec: {
      completeness: 82,
      goal: "빵이 나오는 시간에 맞춰 예약하고, 매진 실망을 없애기",
      included: ["빵 목록 보기", "픽업 예약", "예약 확인 화면", "사장님용 예약 목록"],
      excluded: ["온라인 결제", "배달"],
      openDecisions: ["예약 취소를 언제까지 허용할지"],
    },
    requirements: [
      { id: "req_list", title: "오늘 나온 빵 목록을 볼 수 있어야 함", status: "passed", category: "core", priority: "high" },
      { id: "req_reserve", title: "원하는 빵을 픽업 시간과 함께 예약할 수 있어야 함", status: "passed", category: "core", priority: "high" },
      { id: "req_pay", title: "예약할 때 카드로 미리 결제할 수 있어야 함", status: "failed", category: "core", priority: "medium" },
      { id: "req_owner", title: "사장님이 오늘 예약 목록을 한눈에 볼 수 있어야 함", status: "inconclusive", category: "core", priority: "medium" },
    ],
  };

  const ext = {
    isSample: true,
    entryPath: /** @type {const} */ ("idea"),
    productSpec: {
      productName: "동네 빵집 예약 앱",
      oneLine: "단골손님이 아침 빵을 미리 예약하고 찾아가는 웹앱",
      targetUsers: ["단골손님", "빵집 사장님"],
      problem: "인기 빵은 금방 매진되고, 손님은 헛걸음을 합니다.",
      included: ["빵 목록 보기", "픽업 예약", "예약 확인 화면", "사장님용 예약 목록"],
      excluded: ["온라인 결제", "배달"],
      userFlow: ["빵 목록 확인", "픽업 시간 선택", "예약 완료 화면", "매장에서 픽업"],
      decisions: ["결제는 매장에서 — 온라인 결제는 이번 버전 제외"],
      openQuestions: ["예약 취소를 언제까지 허용할지"],
    },
    itemCriteria: {
      req_list: ["오늘 날짜의 빵만 표시", "매진된 빵은 매진 표시"],
      req_reserve: ["픽업 시간 선택 필수", "예약 완료 화면에 예약 번호 표시"],
      req_pay: ["카드 결제 지원"],
      req_owner: ["시간순 정렬"],
    },
    checkResults: {
      ok: true,
      source: /** @type {const} */ ("llm"),
      summary: { passed: 2, failed: 1, inconclusive: 1, needsDecision: 0 },
      results: [
        { itemId: "req_list", status: "passed", title: "오늘 나온 빵 목록을 볼 수 있어야 함", userLabel: "통과", reason: "항목이 구체적이고 완성 기준이 충분합니다.", evidence: [], nextAction: "다음 단계에서 실제 구현 후 검증하세요." },
        { itemId: "req_reserve", status: "passed", title: "원하는 빵을 픽업 시간과 함께 예약할 수 있어야 함", userLabel: "통과", reason: "핵심 흐름과 일치하고 기준이 명확합니다.", evidence: ["픽업 예약"], nextAction: "다음 단계에서 실제 구현 후 검증하세요." },
        { itemId: "req_pay", status: "failed", title: "예약할 때 카드로 미리 결제할 수 있어야 함", userLabel: "안 맞음", reason: "이 항목은 이번 버전의 제외 범위(온라인 결제)와 충돌합니다.", evidence: ["온라인 결제"], nextAction: "이번 버전에서 빼거나, 제품 설명서의 제외 범위를 바꾸세요.", verification: "dual_confirmed" },
        { itemId: "req_owner", status: "inconclusive", title: "사장님이 오늘 예약 목록을 한눈에 볼 수 있어야 함", userLabel: "확인 부족", reason: "완성 기준이 1개뿐이라 확인 가능한 기준이 더 필요합니다.", evidence: [], nextAction: "완성 기준을 2개 이상으로 늘려주세요." },
      ],
    },
    fixSuggestions: {
      req_pay: {
        ok: true,
        source: /** @type {const} */ ("llm"),
        itemId: "req_pay",
        suggestion: {
          plainSummary: "이번 버전은 '매장에서 결제'로 정했으니, 이 항목을 빼는 것이 가장 깔끔합니다. 온라인 결제가 꼭 필요하면 제외 범위부터 바꿔야 해요.",
          productSpecPatch: { addDecisions: ["결제는 매장 픽업 시 진행"], addCriteria: [], addOpenQuestions: [] },
          builderBrief: {
            title: "결제 항목 정리",
            goal: "이번 버전 범위(매장 결제)와 항목을 일치시키기",
            tasks: ["예약 흐름에서 결제 단계 제거", "예약 완료 화면에 '매장에서 결제해주세요' 안내 추가"],
            doneWhen: ["예약 완료까지 카드 입력 없이 진행된다"],
            doNotDo: ["온라인 결제 모듈을 추가하지 않는다"],
            verifyBy: ["예약을 처음부터 끝까지 진행해 결제 요구가 없는지 확인"],
          },
        },
      },
    },
  };

  return { project, ext };
}
