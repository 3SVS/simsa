// Train W — W-9 방침 고지 (재정렬 D-8·D-21 amend: 비식별 운영 메타는 **고지 후** 기록 / 동의 계획 §4 층 ⓐ).
//
// 개인정보처리방침 §1 "운영 정보(비식별)" 문단의 내용. 페이지(app/legal/privacy/page.tsx)는 이
// 모듈을 그리기만 한다 — 문구와 "서버가 실제로 기록하는 것"의 대응을 테스트
// (test/privacy-ops-info.test.mjs)가 0069 **이상 모든** 마이그레이션·0055/0056 P1 캡처 컬럼·
// envelope.ts와 대조해 고정한다.
//
//  - `columns`  : 이 항목이 설명하는 D1 컬럼(0069 이상 마이그레이션 + 0055/0056 프로젝트 행 컬럼)
//  - `envelope` : 이 항목이 설명하는 봉투 필드(central-plane src/workspace/envelope.ts RunEnvelope)
//  서버에 컬럼·테이블·봉투 필드가 늘었는데 여기 항목이 없으면 테스트가 실패한다(고지 누락 = 버그).
//  운영 메타가 아닌 추가분은 테스트의 NOT_OPS_META에 이유와 함께 넣는다 — 고지 여부를 결정하게 강제.
//
// ★없는 기능을 약속하지 않는다: '기록 끄기' 토글은 아직 없다 → 문의 이메일로 요청 + "준비 중".
// ★법적 근거·문구는 Bae 검토 1회 대상(가격·동의 계획 결정 ⑥). KO가 정본(legal/layout.tsx).

/**
 * 방침 시행일(YYYY-MM-DD). ★배포 직전 이 값을 **배포일**로 갱신한다 — 게시 전 날짜를 시행일로
 * 적으면 안 된다(PR 체크리스트 항목). 변경 이력 마지막 줄의 날짜도 이 값을 쓴다.
 */
export const PRIVACY_EFFECTIVE_DATE = "2026-09-29";

/**
 * 변경 이력 — 이전 시행일과 바뀐 내용을 계속 공개한다(설계 §4 처리방침 변경 목록: "시행일 갱신 +
 * 변경 이력"). 방침을 바꿀 때마다 줄을 **더한다**(지우거나 고쳐 쓰지 않는다). 날짜 오름차순.
 * 2026-07-19 = G9 최초 게시(#393, 운영자 정보 #395).
 *
 * @type {ReadonlyArray<{ date: string, summary: string }>}
 */
export const PRIVACY_CHANGE_LOG = [
  { date: "2026-07-19", summary: "최초 시행." },
  {
    date: PRIVACY_EFFECTIVE_DATE,
    summary:
      "§1에 운영 정보(비식별) 항목(AI 사용량 포함)·목적·근거·보유 기간·요청 방법 추가 · §3에 학습 데이터 사본 예외 추가 · §7 직함을 '대표자'로 정정.",
  },
];

export const OPS_INFO_TITLE = "운영 정보(비식별)";

export const OPS_INFO_LEAD =
  "프로젝트를 만들거나 확인·고치기를 이용하시면 아래 운영 정보가 그 기록과 함께 저장됩니다. 이름·이메일 같은 식별 정보가 아니라, 나라·도구·유형별로 세기 위한 짧은 값들입니다. 다만 '만든 도구'의 기타 칸에 직접 적으신 내용은 적으신 그대로 저장됩니다.";

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
    // 서버가 저장하는 것은 클라이언트가 보낸 선택값뿐이다(routes/workspace.ts normalizeBuiltWith(b.builtWith)).
    // 주소로 빌더를 알아내는 source-evidence.ts는 응답으로만 돌려주고 저장하지 않는다 → '추정'은 적지 않는다.
    // 추정값을 실제로 저장하게 되면 그때 이 문장에 더한다.
    detail: "앱을 만든 도구 — 직접 고르신 도구, 그리고 기타 칸에 직접 적으신 도구 이름·모델 메모(적으신 그대로).",
    columns: ["built_with_json"],
    envelope: ["builtWith"],
  },
  {
    label: "앱 유형 태그",
    detail: "예약·쇼핑처럼 앱의 종류를 나타내는 짧은 태그.",
    columns: ["topic_tags_json"],
    envelope: ["topicTags"],
  },
  {
    label: "진입 경로",
    detail: "아이디어·만든 앱·기획서 중 어느 입구로 시작하셨는지.",
    columns: ["entry_path"],
    envelope: ["entryPath"],
  },
  {
    label: "유입 경로",
    // 0056 acquisition_json — 생성 시 1회(capture-once). 대시보드는 값을 보내지 않아 지금은 기본값
    // "direct"만 쌓이지만, 서버는 요청 본문의 짧은 출처 값(최대 40자)을 받는다.
    detail: "프로젝트를 처음 만드실 때 어디서 오셨는지를 나타내는 짧은 값(예: 직접 방문).",
    columns: ["acquisition_json"],
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
    // verify-sweep(고친 코드가 합쳐진 뒤의 자동 재검수)도 source_check_id를 찍는다.
    detail: "다시 확인할 때(직접 다시 하셨거나, 고친 뒤 자동으로 다시 한 경우) 어느 확인을 다시 한 것인지.",
    columns: ["source_check_id"],
  },
  {
    label: "해결 여부",
    detail: "고친 뒤 다시 확인해서 문제가 해결됐는지(해결됨·안 됨·판단 불가)와 그 다시 확인이 어느 것인지.",
    columns: ["resolved", "verify_check_id"],
  },
  {
    label: "AI 사용량",
    // 0070 llm_usage(Train L, #562) — 비용 계산용 원장. 내용(문장·화면·코드)은 담기지 않는다.
    // 이용자 키는 되돌릴 수 없는 해시(user_key_hash)로만 저장. 프로젝트를 삭제하면 db.ts deleteProject가
    // 같은 배치에서 project_id·user_key_hash·job_id를 비워 연결을 끊는다(비용 행은 남는다).
    detail:
      "기획서 만들기·확인·고치기 같은 작업마다 어느 AI 모델을 얼마나(처리한 글자 양·비용·걸린 시간) 썼는지. 문장·화면·코드 내용은 담기지 않고, 이용자를 가리키는 값은 되돌릴 수 없게 변환해 저장합니다. 프로젝트를 삭제하시면 이 기록에서 프로젝트와 이용자 연결이 지워지고 비용 숫자만 남습니다.",
    columns: ["table:llm_usage"],
  },
];

export const OPS_INFO_PURPOSE =
  "나라·만든 도구·앱 유형별 실패 통계를 만들어, 확인이 문제를 더 정확히 찾고 고치기가 더 잘 되게 하기 위해서입니다.";

export const OPS_INFO_BASIS = "정당한 이익(개인정보 보호법 제15조 제1항 제6호)";

/**
 * 학습 데이터 사본 예외 — §1 보유와 §3 보관·파기가 같은 문장을 쓴다.
 * 동의(opt-in) 사용자의 R2 사본(training-store `events/{region}/…`, journey-store `journey/…`)은
 * 국가 코드·만든 도구 같은 값을 담고, 프로젝트 삭제(db.ts deleteProject)는 `checks/`·`docs/`
 * 접두어만 지운다. 유저→R2 키 인덱스가 없어 지금은 지울 수 없다(동의 계획 §4, K-3에서 해소 →
 * 그때 이 문장을 "함께 삭제"로 바꾼다). 철회하면 새 캡처는 멈춘다(hasActiveTrainingConsent 게이트).
 */
export const TRAINING_COPY_NOTE =
  "다만 학습 데이터 제공에 동의하신 경우 그때 따로 저장된 학습 데이터 사본은 프로젝트를 삭제해도 지워지지 않습니다. 동의를 철회하시면 그 뒤로는 새로 저장되지 않습니다.";

export const OPS_INFO_RETENTION = `서비스 운영 기간 동안 보관합니다. 프로젝트를 삭제하시면 서버 데이터베이스에 있는 그 프로젝트의 확인 기록과 함께 삭제됩니다. ${TRAINING_COPY_NOTE}`;

/**
 * 요청이 **실제로 하는 일**만 적는다. 국가 코드는 생성·검수·수리 요청마다 조건 없이 기록되고
 * (regionFromRequest), 사용자별 제외 플래그는 아직 없다(K-1 `ops_meta_opt_out` + 0071에서 생김) →
 * 요청으로 "앞으로의 기록"을 멈출 수는 없다. 익명 사용자는 화면에서 자기 키를 볼 수 없으므로,
 * 어느 기록인지 찾을 수 있게 프로젝트 화면의 주소(/projects/{id})를 받는다.
 */
export const OPS_INFO_OPT_OUT =
  "아래 문의 이메일로 요청하시면 지금까지 기록된 운영 정보를 지워 드립니다. 어느 기록인지 찾을 수 있게 프로젝트 화면의 주소를 함께 알려 주세요. 앞으로의 기록을 끄는 설정은 준비 중이며, 그 전까지는 새로 하시는 확인·고치기에도 기록됩니다.";
