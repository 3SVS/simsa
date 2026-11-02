/**
 * v2-targets.mjs — 검사 엔진 v2 픽스처 F1~F14 대상·정답(eval-run.mjs TARGETS와 같은 대상·정답).
 * agent-v2-local.mjs(검수 엔진 실측)와 labeler-local.mjs(라벨링 에이전트 실측, train L2)가 같이 쓴다 — 바꾸면 둘 다 바뀐다.
 * expected는 런 전에 기록된 정답(사전 등록)이다. 고칠 때는 eval-run.mjs와 함께.
 */
export const FIXTURES = process.env.FIXTURES_BASE ?? "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
// eval-run.mjs TARGETS F1~F14와 같은 대상·정답(그 파일은 실행 스크립트라 가져올 수 없어 복사 — 바꾸면 둘 다).
export const V2_TARGETS = [
  { id: "F1", url: `${FIXTURES}/working-todo`, expected: "working", intent: "할 일을 입력하고 추가 버튼을 누르면 목록에 나타나야 한다" },
  { id: "F2", url: `${FIXTURES}/noisy-working`, expected: "working", intent: "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다" },
  { id: "F3", url: `${FIXTURES}/potemkin-crm`, expected: "broken", intent: "고객 메모를 입력하고 저장을 누르면 저장된 메모가 목록에 나타나야 한다" },
  { id: "F4", url: `${FIXTURES}/js-crash`, expected: "broken", intent: "원화 금액을 입력하고 계산하기를 누르면 달러 금액이 보여야 한다" },
  { id: "F5", url: `${FIXTURES}/blank`, expected: "broken", intent: "방문자가 이 서비스가 무엇인지 화면에서 알 수 있어야 한다" },
  { id: "F6", url: `${FIXTURES}/optimistic-ghost`, expected: "broken", intent: "기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F7", url: `${FIXTURES}/heavy-site`, expected: "working", nullOk: true, intent: "기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F8", url: `${FIXTURES}/geo-gated`, expected: "working", nullOk: true, intent: "산책 기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F9", url: `${FIXTURES}/http-404`, expected: "broken", intent: "방문자가 앱 화면을 열어 서비스를 쓸 수 있어야 한다" },
  { id: "F10", url: `${FIXTURES}/canned-result`, expected: "broken", intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F11", url: `${FIXTURES}/self-checklist`, expected: "broken", intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F12", url: `${FIXTURES}/real-echo-checker`, expected: "working", nullOk: true, intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F13", url: `${FIXTURES}/needs-api-key`, expected: "broken", nullOk: true, intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F14", url: `${FIXTURES}/static-site/`, expected: "broken", intent: "방문자가 앱 첫 화면을 열어 서비스를 쓸 수 있어야 한다" },
];
