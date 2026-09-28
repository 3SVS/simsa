// Train W — W-9 방침 고지 (재정렬 D-8·D-21 amend: 비식별 운영 메타는 **고지 후** 기록 / 동의 계획 §4 층 ⓐ).
//
// 개인정보처리방침 §1 "운영 정보(비식별)" 문단의 내용. 페이지(app/legal/privacy/page.tsx)는 이
// 모듈을 그리기만 한다 — 문구와 "서버가 실제로 기록하는 것"의 대응을 테스트
// (test/privacy-ops-info.test.mjs)가 0069 마이그레이션·envelope.ts와 대조해 고정한다.
//
//  - `columns`  : 이 항목이 설명하는 D1 컬럼(0069_moat_envelope.sql)
//  - `envelope` : 이 항목이 설명하는 봉투 필드(central-plane src/workspace/envelope.ts RunEnvelope)
//  서버에 컬럼·봉투 필드가 늘었는데 여기 항목이 없으면 테스트가 실패한다(고지 누락 = 버그).
//
// ★없는 기능을 약속하지 않는다: '기록 끄기' 토글은 아직 없다 → 문의 이메일로 요청 + "준비 중".
// ★법적 근거·문구는 Bae 검토 1회 대상(가격·동의 계획 결정 ⑥). KO가 정본(legal/layout.tsx).

/** 방침 시행일. 배포일에 맞춰 이 값만 바꾼다(YYYY-MM-DD). */
export const PRIVACY_EFFECTIVE_DATE = "2026-09-28";

export const OPS_INFO_TITLE = "운영 정보(비식별)";

export const OPS_INFO_LEAD =
  "프로젝트를 만들거나 확인·고치기를 이용하시면 아래 운영 정보가 그 기록과 함께 저장됩니다. 이름·이메일·입력하신 내용 같은 식별 정보가 아니라, 나라·도구·유형별로 세기 위한 짧은 값들입니다.";

/**
 * @type {ReadonlyArray<{ label: string, detail: string, columns?: readonly string[], envelope?: readonly string[] }>}
 */
export const OPS_INFO_ITEMS = [
  {
    label: "접속 국가 코드",
    detail:
      "접속하신 IP로 나라만 판별해 국가 코드(예: KR)만 남깁니다. 이 기록에 IP 주소 자체는 저장하지 않습니다. 프로젝트를 만든 시점과 확인·고치기를 요청한 시점에 기록됩니다.",
    columns: ["region", "region_at_create"],
  },
  {
    label: "화면 언어",
    detail: "서비스를 어떤 언어(한국어·영어)로 보셨는지.",
    envelope: ["locale"],
  },
  {
    label: "입력 언어",
    detail: "확인해 달라고 적으신 문장이 어떤 언어로 쓰였는지. 문장 내용은 이 항목에 담기지 않습니다.",
    envelope: ["contentLang"],
  },
  {
    label: "만든 도구",
    detail: "앱을 만든 도구 — 직접 고르신 도구, 또는 앱 주소로 추정한 도구(예: Lovable·Bolt).",
    envelope: ["builtWith"],
  },
  {
    label: "앱 유형 태그",
    detail: "예약·쇼핑처럼 앱의 종류를 나타내는 짧은 태그.",
    envelope: ["topicTags"],
  },
  {
    label: "진입 경로",
    detail: "아이디어·만든 앱·기획서 중 어느 입구로 시작하셨는지.",
    envelope: ["entryPath"],
  },
  {
    label: "실패 유형 코드",
    detail: "확인에서 나온 문제의 종류를 나타내는 짧은 코드. 화면 내용이나 문장이 아닙니다.",
    columns: ["finding_codes_json"],
  },
  {
    label: "결과 판정 선택",
    detail: "확인 결과를 보고 고르신 답(예: \"생각대로 됐어요\")과 고르신 시각.",
    columns: ["user_verdict", "user_verdict_at"],
  },
  {
    label: "다시 확인 연결",
    detail: "다시 확인하셨을 때, 어느 확인을 다시 한 것인지.",
    columns: ["source_check_id"],
  },
  {
    label: "해결 여부",
    detail: "고친 뒤 다시 확인해서 문제가 해결됐는지(해결됨·안 됨·판단 불가)와 그 다시 확인이 어느 것인지.",
    columns: ["resolved", "verify_check_id"],
  },
];

export const OPS_INFO_PURPOSE =
  "나라·만든 도구·앱 유형별 실패 통계를 만들어, 확인이 문제를 더 정확히 찾고 고치기가 더 잘 되게 하기 위해서입니다.";

export const OPS_INFO_BASIS = "정당한 이익(개인정보 보호법 제15조 제1항 제6호)";

export const OPS_INFO_RETENTION =
  "서비스 운영 기간 동안 보관합니다. 프로젝트를 삭제하시면 그 프로젝트의 확인 기록과 함께 삭제됩니다.";

export const OPS_INFO_OPT_OUT =
  "기록을 원하지 않으시면 아래 문의 이메일로 요청해 주세요. 설정 화면의 끄기 기능은 준비 중입니다.";
