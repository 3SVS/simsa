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
// ★없는 기능을 약속하지 않는다. Train K(계약 2~4): '기록 끄기'(privacy_prefs, 0071)와 학습 사본 색인
//  삭제(training_records_index, 0071)는 **Train K 서버 PR**이 만든다 — 이 문구는 그 서버가 배포된 뒤에만
//  게시한다(배포 순서: central → dashboard, PR 체크리스트). 테스트가 0071·서버 소스와 묶는다.
// ★법적 근거·문구는 Bae 검토 1회 대상(가격·동의 계획 결정 ⑥). KO가 정본(legal/layout.tsx).

/**
 * 방침 시행일(YYYY-MM-DD). ★배포 직전 이 값을 **배포일**로 갱신한다 — 게시 전 날짜를 시행일로
 * 적으면 안 된다(PR 체크리스트 항목). 변경 이력 **마지막(아직 게시 안 된) 줄**의 날짜만 이 값을 쓴다.
 * Train K: 2026-10-03 = dashboard 배포일(Bae 2026-10-03 `deploy dashboard approved.`, 0071 적용·central 배포 뒤).
 * D-24 T-4: 2026-10-04 = dashboard 배포일(Bae 2026-10-04 `deploy dashboard approved.`) — 한 달 고치기 횟수 기록의 보유 예외(그 달이 끝나고 48시간)를 더했다.
 * 이 PR의 dashboard 배포일로 바꾼다(PR 체크리스트). central(월 기록을 쓰기 시작) 배포와 같은 날 게시.
 */
export const PRIVACY_EFFECTIVE_DATE = "2026-10-04";

/**
 * 변경 이력 — 이전 시행일과 바뀐 내용을 계속 공개한다(설계 §4 처리방침 변경 목록: "시행일 갱신 +
 * 변경 이력"). 방침을 바꿀 때마다 줄을 **더한다**(지우거나 고쳐 쓰지 않는다). 날짜 오름차순.
 * 2026-07-19 = G9 최초 게시(#393, 운영자 정보 #395).
 *
 * ★게시가 확인된 줄은 날짜를 **문자열로 고정**한다 — 상수를 쓰면 다음 배포에서 PRIVACY_EFFECTIVE_DATE를
 * 올리는 순간 이미 게시된 줄의 날짜까지 바뀐다(이력 고쳐 쓰기). 상수는 새로 더한 마지막 줄만 쓴다.
 * 2026-09-29 줄: #558·#562 — app.trysimsa.com/legal/privacy에 '시행일: 2026-09-29'로 게시된 것을
 * 2026-09-29에 라이브로 확인(값은 그대로, 상수 참조만 고정 문자열로 바꿨다).
 * 2026-09-30 줄: #566 — app.trysimsa.com/legal/privacy에 '시행일: 2026-09-30'과 이 줄이 게시된 것을
 * 2026-09-30에 라이브로 확인(Train K PR에서 고정 문자열로 바꿨다).
 * 2026-10-03 줄: #573 — dashboard 배포(conclave-dashboard-c642w6tr7, 2026-10-03)로 게시. 정책 페이지 문구의
 * 라이브 확인은 이 PR 시점 미측정 — D-24 T-4 PR에서 고정 문자열로 바꿨다.
 *
 * @type {ReadonlyArray<{ date: string, summary: string }>}
 */
export const PRIVACY_CHANGE_LOG = [
  { date: "2026-07-19", summary: "최초 시행." },
  {
    date: "2026-09-29",
    summary:
      "§1에 운영 정보(비식별) 항목(AI 사용량 포함)·목적·근거·보유 기간·요청 방법 추가 · §3에 학습 데이터 사본 예외 추가 · §7 직함을 '대표자'로 정정.",
  },
  {
    date: "2026-09-30",
    summary:
      "§1 운영 정보에 '요청 횟수 제한' 항목 추가(접속 IP와 사용자 키는 비밀 키로 되돌릴 수 없게 변환해 기록, 48시간이 지나면 삭제) · §1 보유 기간과 §3에 48시간 삭제를 명시 · 'AI 사용량' 항목에서 이용자를 가리키는 값의 설명을 사실대로 정정.",
  },
  {
    date: "2026-10-03",
    summary:
      "§1 운영 정보에 '기록 끄기' 설정 추가(설정·확인 결과 화면, 유럽연합·유럽경제지역·영국·스위스에서 접속하시거나 접속 나라를 알 수 없으면 켜시기 전까지 기록하지 않음)와 꺼도 기록되는 항목 명시 · §2에 학습 데이터 제공(선택)의 범위(사본에 함께 담기는 운영 정보 포함)·목적·근거·만 14세 기준 추가 · §1·§3 학습 데이터 사본: 동의 철회나 프로젝트 삭제 시 색인된 사본을 지우고, 삭제 기능 전에 저장된 일부 사본은 요청 시 처리 · §6 권리 문구 갱신(학습 데이터 동의는 확인 결과 화면에서도 한 번에 철회).",
  },
  {
    date: PRIVACY_EFFECTIVE_DATE,
    summary:
      "§1 '요청 횟수 제한' 항목·보유 기간과 §3: 플랜의 한 달 고치기(수리) 횟수를 세는 기록은 그 달 동안 필요해, 그 달이 끝나고 48시간이 지나면 지운다는 예외를 추가(나머지 요청 횟수 기록은 종전대로 48시간).",
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
    // 봉투 사본(envelope_json의 locale)은 '끔'이면 멈추지만, 확인 런 행(0065)·빌드 잡 행(0068)의 locale 칸은
    // 결과·재검수·빌드 안내를 그 언어로 보여 주는 기능 데이터라 계속 저장된다(OPS_META_OFF_KEEPS, 서버 #574 머리말).
    detail: "서비스를 어떤 언어(한국어·영어)로 보셨는지. 확인 결과를 그 언어로 보여 드리는 데도 씁니다.",
    columns: ["locale"],
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
    // user_key_hash = 비밀 키 없는 sha256(userKey)(llm-usage.ts). userKey는 무작위 UUID가 아니고
    // (dashboard workflow-store.ts getUserKey: uk_ + Date.now() 36진 + Math.random 5자) 같은 D1의 여러 테이블에
    // 평문으로 있다 → 우리는 이 값을 그 이용자의 다른 기록과 연결할 수 있다. 그래서 "되돌릴 수 없게"라고 쓰지 않고
    // 사실(원문 대신 변환한 값 · 서비스는 연결할 수 있음)을 쓴다(PR #566 리뷰 P2). 프로젝트를 삭제하면 db.ts
    // deleteProject가 같은 배치에서 project_id·user_key_hash·job_id를 비워 연결을 끊는다(비용 행은 남는다).
    detail:
      "기획서 만들기·확인·고치기 같은 작업마다 어느 AI 모델을 얼마나(처리한 글자 양·비용·걸린 시간) 썼는지. 문장·화면·코드 내용은 담기지 않습니다. 이용자를 가리키는 값은 사용자 키 원문 대신 변환한 값으로 저장하며, 서비스는 이 값을 그 이용자의 다른 기록과 연결할 수 있습니다. 프로젝트를 삭제하시면 이 기록에서 프로젝트와 이용자 연결이 지워지고 비용 숫자만 남습니다.",
    columns: ["table:llm_usage"],
  },
  {
    label: "요청 횟수 제한",
    // workspace_rate_limit(0026)·demo_rate_limit(0011) — 0069 이전 테이블이라 가드 테스트 대상은 아니고 참고용.
    // 저장 칸: ip_hash(아래 변환값) · 창(시간/일) · count · first_at · last_at(처음·마지막 요청 시각, 밀리초 ISO).
    // 서버 사실(central-plane src/workspace/rate-limit-key.ts): IP와 사용자 키 버킷은 둘 다 비밀 키 HMAC
    // (CONCLAVE_TOKEN_KEK에서 라벨별로 파생한 하위 키). 사용자 키도 비밀 키로 바꾼 이유: userKey는 무작위 UUID가
    // 아니고 같은 D1에 평문으로 있어서, 비밀 키 없는 sha256이면 DB를 읽는 쪽이 곧바로 이용자에 연결한다(#566 리뷰 P2).
    // 시작한 지 48시간 지난 창과 옛 형식("v1:" 표시 없는) 행은 6시간 크론이 지운다(src/rate-limit-retention.ts
    // RATE_LIMIT_RETENTION_HOURS — 테스트가 이 문장의 숫자와 묶는다).
    // 기록되는 요청: 기획서 만들기·문서로 기획서 만들기·확인·추천 답변·막힘 도우미·고침 제안·검수·수리·데모 —
    // 프로젝트를 만들기 전 요청과 랜딩 체험(/saas/demo/review)도 기록되므로 OPS_INFO_LEAD의 범위("프로젝트를
    // 만들거나 확인·고치기를 이용하시면")를 넘는다 → 이 항목 안에서 밝힌다(#566 리뷰 P2).
    // "그 키 없이는": 키를 가진 쪽은 IPv4 전체나 저장된 사용자 키를 다시 계산해 맞춰 볼 수 있다 — 조건 없이
    // "알아낼 수 없다"고 쓰지 않는다.
    detail:
      "같은 곳에서 너무 많은 요청이 한꺼번에 오는 것을 막기 위해, 요청 횟수와 처음·마지막 요청 시각, 그리고 접속 IP와 사용자 키를 되돌릴 수 없게 변환한 값을 기록합니다. 이 기록에 IP 주소와 사용자 키 자체는 저장하지 않습니다. 둘 다 서버만 가진 비밀 키로 변환하므로, 그 키 없이는 저장된 값으로 IP를 알아내거나 이용자의 다른 기록과 연결할 수 없습니다. 프로젝트를 만들기 전 요청과 체험(데모) 요청에도 기록되며, 48시간이 지나면 지웁니다. 다만 플랜의 한 달 고치기 횟수를 세는 기록은 그 달 동안 필요해서, 그 달이 끝나고 48시간이 지나면 지웁니다.",
    columns: ["table:workspace_rate_limit", "table:demo_rate_limit"],
  },
];

/**
 * 요청 횟수 제한 기록의 보유 예외 — §1 보유 기간과 §3 보관·파기가 같은 문장을 쓴다
 * (나머지 운영 정보의 "서비스 운영 기간 동안 보관"과 어긋나 보이지 않게).
 */
export const RATE_LIMIT_RETENTION_NOTE =
  "요청 횟수 제한 기록은 48시간이 지나면 지웁니다(한 달 단위로 세는 고치기 횟수 기록은 그 달이 끝나고 48시간이 지나면 지웁니다).";

export const OPS_INFO_PURPOSE =
  "나라·만든 도구·앱 유형별 실패 통계를 만들어, 확인이 문제를 더 정확히 찾고 고치기가 더 잘 되게 하기 위해서입니다.";

export const OPS_INFO_BASIS = "정당한 이익(개인정보 보호법 제15조 제1항 제6호)";

/**
 * 학습 데이터 사본 — §1 보유와 §3 보관·파기(와 §2 학습 데이터 문단)가 같은 문장을 쓴다.
 * 동의(opt-in) 사용자의 R2 사본(training-store `events/{region}/…`, journey-store `journey/…`)은
 * 국가 코드·만든 도구 같은 값을 담는다. Train K(계약 3·4, 서버 PR): 캡처할 때 training_records_index
 * (0071)에 사람·프로젝트별 행을 쓰고, ① 동의→철회 시 그 사람의 색인 행 ② 프로젝트 삭제 시 그 프로젝트의
 * 색인 행의 R2 사본을 지운다(바로 시도 + 크론 재시도). 색인 행을 못 쓰면 사본을 저장하지 않는다(fail-closed,
 * training-store captureTrainingRecord) → 0071 이후 사본은 모두 색인된다.
 * ③ 0071 **이전** 사본(서버 PR #574 검증 #574-2 정정): 검수·여정 사본 본문에는 처음부터 subject_hash=sha256(userKey)와
 *   project_id가 있어 사람·프로젝트를 찾을 **수는** 있다. 검수 사본은 런 행의 training_r2_key로 찾아 지우고, 여정 사본
 *   전부와 런 행이 없어진 검수 사본(0071 이전에 삭제된 프로젝트의 사본·0057 이전 캡처·키 기록 실패분)은 일회성 백필
 *   (central-plane scripts/backfill-training-index.mjs — 실행은 Bae 승인 대기)을 돌려야 자동 삭제 대상이 된다.
 *   그 전까지는 "자동으로 지우지 못할 수 있다(문의 시 처리)"가 사실이다 → '색인이 없어 못 지운다'고 단정하지 않는다.
 *   백필이 적용되면 이 예외 문장을 줄인다.
 * 철회하면 새 캡처는 멈춘다(hasActiveTrainingConsent 게이트).
 */
export const TRAINING_COPY_NOTE =
  "학습 데이터 제공에 동의하신 경우 따로 저장된 학습 데이터 사본은, 동의를 철회하시거나 그 프로젝트를 삭제하시면 색인된 사본을 지웁니다(바로 지우기 시작하고, 실패한 것은 다시 시도합니다). 다만 삭제 기능이 생기기 전에 저장된 일부 사본은 자동으로 지우지 못할 수 있습니다 — 아래 문의 이메일로 요청하시면 찾을 수 있는 범위에서 지워 드립니다. 동의를 철회하시면 그 뒤로는 새로 저장되지 않습니다.";

/** §2 학습 데이터 제공(선택) — 결과 화면 카드의 '자세히'(#training-data)가 가리키는 문단. */
export const TRAINING_DATA_TITLE = "학습 데이터 제공(선택)";

/**
 * 담기는 것 — 서버 사실(test/privacy-ops-info.test.mjs가 묶는다):
 *  - 캡처 호출은 routes/workspace-github.ts(연결한 코드의 변경 확인·고침 지시) 하나뿐 → 주소로 하는
 *    화면 확인(visual checks)은 담기지 않는다.
 *  - training-store TrainingRecord: product_spec·acceptance_items·pr_files(변경 내용)·results·
 *    repo_full_name(저장소 이름)·subject_hash(= sha256(userKey), 비밀 키 없음 → 서비스는 연결 가능).
 *  - 저장 전 redactSecrets(비밀 키 패턴). 계정 이메일 칸은 없다 — 직접 적은 문장·코드 안의 내용은 남을 수 있다.
 *  - 그때의 운영 정보(#573 검증 5): pr_number·head_sha·built_with·topic_tags·entry_path·acquisition·locale·
 *    content_lang·user_context(가진 프로젝트 수)·commercial(요금제)·cost_meta(토큰·모델)·region(운영 정보 기록이
 *    켜져 있을 때만 — 끄면 서버가 null). 칸 전부와 이 문장을 테스트가 서버 TrainingRecord·JourneyRecord와 대조한다.
 */
export const TRAINING_DATA_SCOPE =
  "허용하신 경우에만, 연결하신 코드의 변경 사항을 확인하실 때 쓰인 제품 설명·확인 항목·확인 결과·변경 내용·저장소 이름·변경 요청 번호·코드 버전 식별값과 진행 기록(단계와 결과 요약)의 사본을 따로 보관합니다. 사본에는 그때의 운영 정보도 함께 담깁니다: 만든 도구·앱 유형·진입 경로·유입 경로·화면 언어·입력 언어·가지고 계신 프로젝트 수·요금제·AI 사용량(처리한 글자 양과 모델)이며, 운영 정보 기록을 켜 두셨으면 접속 국가 코드도 담깁니다. 주소로 하는 화면 확인 결과는 담지 않습니다. 비밀 키처럼 보이는 값은 저장 전에 지우고 계정 이메일은 담지 않지만, 직접 적으신 문장이나 코드에 들어 있는 내용은 그대로 담길 수 있습니다. 이용자는 사용자 키 원문 대신 변환한 값으로 표시하며, 서비스는 이 값을 그 이용자의 다른 기록과 연결할 수 있습니다.";

export const TRAINING_DATA_PURPOSE =
  "Simsa의 확인·고치기 품질을 높이는 데 쓰며, 이 데이터로 Simsa의 AI 모델을 학습시킬 수 있습니다. 개인 데이터를 팔거나 다른 곳에 넘기지 않습니다.";

export const TRAINING_DATA_BASIS = "동의(개인정보 보호법 제15조 제1항 제1호). 정당한 이익으로 대신하지 않습니다.";

export const TRAINING_DATA_CHOICE =
  "허용 여부와 관계없이 모든 기능을 똑같이 쓰실 수 있습니다. 만 14세 이상만 허용하실 수 있습니다. 처음 완료된 확인 결과 화면에서 묻고, 각 프로젝트의 설정 화면에서 언제든 바꾸실 수 있습니다. 허용하신 뒤에는 확인 결과 화면에서도 한 번에 철회하실 수 있습니다.";

export const OPS_INFO_RETENTION = `서비스 운영 기간 동안 보관합니다. 프로젝트를 삭제하시면 서버 데이터베이스에 있는 그 프로젝트의 확인 기록과 함께 삭제됩니다. ${TRAINING_COPY_NOTE} ${RATE_LIMIT_RETENTION_NOTE}`;

/**
 * '기록 끄기'가 **실제로 멈추는 것**과 **끄셔도 남는 것** — 계약 3(서버 PR의 캡처 게이트)과 같은 표.
 * 끄기 대상은 0069 '통계용 운영 정보'뿐이다: region(검수·수리)·region_at_create(프로젝트)·envelope_json
 * (화면 언어·입력 언어·만든 도구·앱 유형·진입 경로 사본)·finding_codes_json(+ 학습 사본의 region).
 * 기능 데이터(user_verdict·source_check_id·resolved·verify_check_id·locale — 검수 런 0065·빌드 잡 0068의
 * 화면 언어 칸)와 0055/0056 프로젝트 행 컬럼, AI 사용량(llm_usage)·요청 횟수 제한 기록은 끄기 대상이
 * 아니다 → 방침이 그대로 적는다. test/train-k-consent.test.mjs가 두 목록을 고지 항목·서버
 * privacy-prefs.ts 머리말('무엇을 끄는가'·'끄지 않는 것')과 대조한다.
 */
export const OPS_META_OFF_STOPS = ["region", "region_at_create", "envelope_json", "finding_codes_json"];
export const OPS_META_OFF_KEEPS = [
  "locale",
  "built_with_json",
  "entry_path",
  "topic_tags_json",
  "acquisition_json",
  "user_verdict",
  "user_verdict_at",
  "source_check_id",
  "resolved",
  "verify_check_id",
  "table:llm_usage",
  "table:workspace_rate_limit",
  "table:demo_rate_limit",
];

/**
 * 요청이 **실제로 하는 일**만 적는다. Train K 서버(계약 2·3): 설정·확인 결과 화면의 '기록 끄기'가
 * privacy_prefs(0071)에 저장되고, 끈 사람(명시 off, 또는 EU/EEA·영국·스위스 기본 off이며 켠 적 없음)의
 * 새 기록에는 OPS_META_OFF_STOPS 칸에 NULL을 쓴다. 이미 쌓인 값을 지우는 자동 기능은 없다 → 문의로 받는다.
 * 익명 사용자는 화면에서 자기 키를 볼 수 없으므로, 어느 기록인지 찾을 수 있게 프로젝트 화면의
 * 주소(/projects/{id})를 받는다.
 */
export const OPS_INFO_OPT_OUT =
  "각 프로젝트의 설정 화면이나 확인 결과 화면에서 운영 정보 기록을 끄실 수 있습니다. 끄시면 그 뒤로 하시는 프로젝트 만들기·확인·고치기에 접속 국가 코드와 실패 유형 코드를 기록하지 않고, 확인 기록마다 함께 남기던 화면 언어·입력 언어·만든 도구·앱 유형·진입 경로 사본도 남기지 않습니다(학습 데이터 제공에 동의하셨다면 학습 사본에도 접속 국가 코드를 담지 않습니다). 유럽연합·유럽경제지역·영국·스위스에서 접속하신 경우와 접속하신 나라를 알 수 없는 경우에는 직접 켜시기 전까지 이 항목들을 기록하지 않습니다. 끄셔도 계속 기록되는 것은 확인 결과를 보여 줄 화면 언어, 프로젝트에 함께 저장되는 만든 도구·앱 유형·진입 경로·유입 경로, 결과 판정 선택·다시 확인 연결·해결 여부, AI 사용량, 요청 횟수 제한 기록입니다. 이미 기록된 운영 정보를 지우시려면 아래 문의 이메일로 요청해 주세요. 어느 기록인지 찾을 수 있게 프로젝트 화면의 주소를 함께 알려 주세요.";
