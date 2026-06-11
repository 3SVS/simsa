/**
 * 사용자 화면에 표시되는 용어 매핑.
 * 내부 코드는 영어 enum을 사용하되, UI에는 이 파일의 값을 사용한다.
 */

export type ItemStatus =
  | "passed"
  | "failed"
  | "inconclusive"
  | "needs_decision"
  | "not_started"
  | "building";

export type ItemPriority = "must" | "should" | "could";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
  not_started: "시작 전",
  building: "만드는 중",
};

export const STATUS_COLOR: Record<ItemStatus, { bg: string; text: string; border: string }> = {
  passed: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  failed: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  inconclusive: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  needs_decision: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  not_started: { bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-200" },
  building: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
};

export const PRIORITY_LABEL: Record<ItemPriority, string> = {
  must: "필수",
  should: "권장",
  could: "선택",
};

export const NAV_LABELS = {
  idea: "아이디어",
  spec: "제품 설명서",
  items: "꼭 들어가야 할 것",
  checks: "확인 결과",
  fixes: "고쳐야 할 것",
  export: "만들기 패키지",
  settings: "저장소 연결",
} as const;

/** 개발자 용어 → 사용자 표현 매핑 (문서/주석용) */
export const TERM_MAP = {
  PRD: "제품 설명서",
  Requirement: "꼭 들어가야 할 항목",
  "Acceptance Criteria": "완성 기준",
  "Acceptance Matrix": "확인 결과",
  PASS: "통과",
  FAIL: "안 맞음",
  INCONCLUSIVE: "확인 부족",
  NEEDS_DECISION: "결정 필요",
  Autofix: "고쳐보기",
  Evidence: "확인 근거",
  "Agent / Builder": "만드는 도구",
} as const;
