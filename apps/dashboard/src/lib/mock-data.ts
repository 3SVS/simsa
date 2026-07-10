import type { ItemStatus, ItemPriority } from "./labels";

export type RequirementItem = {
  id: string;
  title: string;
  status: ItemStatus;
  category: string;
  priority: ItemPriority;
  evidence?: string;
  suggestedAction?: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  spec: {
    completeness: number;
    goal: string;
    included: string[];
    excluded: string[];
    openDecisions: string[];
  };
  requirements: RequirementItem[];
};

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj_mjx1",
    name: "회의록 자동 요약 앱",
    description:
      "회의 녹음 파일을 올리면 자동으로 요약하고 할 일을 뽑아서 Linear로 보내주는 앱",
    createdAt: "2026-06-01",
    spec: {
      completeness: 72,
      goal: "사용자가 회의 녹음 파일을 올리면 자동으로 요약하고 할 일을 추출해서 Linear로 보낸다.",
      included: [
        "녹음 파일 업로드",
        "STT 변환",
        "요약 생성 (결정사항/할 일 분리)",
        "할 일 추출",
        "Linear 전송 (사용자 확인 후)",
      ],
      excluded: ["실시간 녹음", "화상 회의 녹화", "번역 기능"],
      openDecisions: [
        "녹음 파일 보관 기간을 정해야 합니다.",
        "Linear 전송 전 사용자 확인 단계를 넣을지 결정해야 합니다.",
      ],
    },
    requirements: [
      {
        id: "req_001",
        title: "사용자는 회의 녹음 파일을 올릴 수 있어야 함",
        status: "passed",
        category: "feature",
        priority: "must",
        evidence: "FileUpload 컴포넌트가 mp3, wav, m4a를 수락하는 것을 확인했습니다.",
      },
      {
        id: "req_002",
        title: "잘못된 파일 형식을 올리면 이유를 알려줘야 함",
        status: "passed",
        category: "validation",
        priority: "must",
        evidence: "오류 메시지 '지원하지 않는 파일 형식입니다'가 화면에 표시됩니다.",
      },
      {
        id: "req_003",
        title: "회의 요약은 결정사항과 할 일을 분리해서 보여줘야 함",
        status: "failed",
        category: "feature",
        priority: "must",
        evidence: "현재 요약이 단일 블록으로 출력됩니다. 분리 표시가 없습니다.",
        suggestedAction: "SummaryView 컴포넌트에서 decisions/todos를 별도 섹션으로 렌더링하도록 수정 필요",
      },
      {
        id: "req_004",
        title: "Linear로 보내기 전 사용자가 확인해야 함",
        status: "inconclusive",
        category: "user_flow",
        priority: "must",
        evidence: "확인 모달 코드가 존재하나 실제 전송 흐름에서 우회 경로가 있습니다.",
        suggestedAction: "전송 API 호출 전 확인 상태를 검증하는 guard를 추가하세요.",
      },
      {
        id: "req_005",
        title: "사용자는 본인 회의록만 볼 수 있어야 함",
        status: "needs_decision",
        category: "permission",
        priority: "must",
        suggestedAction: "접근 범위를 결정해야 합니다: 개인 계정 단위, 팀 단위, 조직 단위 중 선택",
      },
      {
        id: "req_006",
        title: "녹음 파일 처리 중 진행상황을 보여줘야 함",
        status: "not_started",
        category: "ui_state",
        priority: "should",
      },
    ],
  },
];

export function getProject(id: string): Project | undefined {
  return MOCK_PROJECTS.find((p) => p.id === id);
}

/**
 * Example projects are read-only demo fixtures shipped to EVERY user with a
 * FIXED shared id. They must never reach the server: the first user to write
 * `proj_mjx1` to D1 would own it globally (first-writer-owns guard), making
 * every other user's repo-link / save on the example 404 forever — the exact
 * "연결이 계속 풀려요" trap found in the 2026-07-10 live incident.
 */
export function isExampleProject(id: string): boolean {
  return MOCK_PROJECTS.some((p) => p.id === id);
}

export function getProjectStats(project: Project) {
  const total = project.requirements.length;
  const passed = project.requirements.filter((r) => r.status === "passed").length;
  const failed = project.requirements.filter((r) => r.status === "failed").length;
  const inconclusive = project.requirements.filter((r) => r.status === "inconclusive").length;
  const needsDecision = project.requirements.filter((r) => r.status === "needs_decision").length;
  const notStarted = project.requirements.filter((r) => r.status === "not_started").length;
  return { total, passed, failed, inconclusive, needsDecision, notStarted };
}
