# Simsa 아이디어 단계 질문 UX 개선 (설계 노트)

> 상태: 설계 확정, 구현 착수. Bae 지시(2026-07-16 세션 — "세 개 다 이번에" + 질문 교정은
> "질문별 버튼"). 진실의 소스: `docs/simsa-prd.md` §6.1. 이 노트는 그 절의 구현 상세.
> 배경: Bae 실사용 지적 — "나 혼자 쓰는 웹앱을 만들고 싶은데 심사는 자꾸 '누구한테까지
> 권한을 열거냐'고만 묻는다."

## 근본 문제 (코드로 확인된 3건)

1. **엇나간 질문** — ① mock fallback(LLM 키 없을 때)이 아이디어와 무관하게 고정 질문을
   내는데 q3="여러 사용자냐 개인용이냐"이고 **기본 추천이 "여러 사용자"**, 게다가 모든
   generic draft에 req_005="다른 사용자 데이터 안 보여야 함"을 박아넣음. ② LLM 프롬프트도
   `로그인/권한`을 질문 축으로 명시하면서 **solo-use면 빼라는 가드가 없음**. 혼자 쓰는 앱엔
   둘 다 무의미. (`generate.ts:188/212` 프롬프트, `:501-509/563-571` mock q3, `:527/589` req_005)
2. **추가 컨텍스트 입력 부재** — 아이디어 textarea 하나뿐(`projects/new/page.tsx` idea step).
   "심사가 알아야 할 추가 내용"을 넣을 곳이 없음. request 타입에도 필드 없음(`generate.ts:11`).
3. **질문 교정 부재** — 답/추천수락/직접입력/나중에만 가능. "이 질문 자체가 안 맞아"라고
   말할 수 없음. 아이디어 통째로 재작성 후 전체 재생성만 가능(`ApiQuestionCard`).

## 결정

- **D1 [LOCKED]** solo-use 신호는 **결정론적으로 감지**한다(LLM 판단 아님). 아이디어+추가
  컨텍스트+답변 텍스트에서 solo 마커(혼자/개인/나만/로그인 필요 없/solo/personal/just for
  me/only me 등)를 매칭. 감지되면 (a) 프롬프트에 "권한·멀티유저·역할 질문 및 사용자 격리
  항목 금지" 규칙 주입, (b) mock에서 멀티유저 q3 + req_005 제거. **원칙 잠금, 마커 목록은
  파라미터(조정 가능).**
- **D2 [LOCKED]** 추가 컨텍스트는 `IdeaToSpecDraftRequest.context?: string`(≤4000자)로 받아
  아이디어와 함께 프롬프트에 주입하고 `userWordsOf`(검증 게이트)에도 포함. 별도 채널이며
  아이디어 필드를 오염시키지 않음.
- **D3 [LOCKED]** 질문 교정 = **질문별 "이 질문 안 맞아요" 버튼**(Bae 확정). 누르면 사유
  입력 → `rejectedQuestions?: Array<{question, reason}>`에 실어 재생성 요청. 프롬프트가 그
  방향을 회피하고 대체 질문 제시. 서버는 여전히 4~6개 반환, 클라이언트는 **이미 답한 질문의
  답을 보존**(answers)하고 미답변 슬롯만 갱신.
- **D4 [LOCKED]** 하위호환: 세 필드 모두 optional. 구버전 클라이언트/서버가 섞여도 동작
  (필드 없으면 기존 행동). 백엔드 먼저 배포 → 프론트.

## 스테이지

- **S1 (central-plane)** — `detectSoloUse()` 결정론 함수 + 프롬프트 solo 가드(KO/EN) +
  mock solo 분기(q3/req_005 제거) + context·rejectedQuestions 프롬프트 주입 + 타입 3필드 추가
  + `userWordsOf` context 포함 + 라우트 파싱(길이 제한) + 테스트. **백엔드 전체.**
- **S2 (dashboard)** — 아이디어 입력 단계에 "심사에게 더 알려줄 내용" textarea(D2) +
  `handleGenerateUnderstanding` 전송. i18n KO/EN.
- **S3 (dashboard)** — `ApiQuestionCard`에 "이 질문 안 맞아요" 버튼 + 사유 입력(D3) →
  재생성 시 rejectedQuestions 전송, 답 보존. i18n KO/EN.

배포: central 1회(S1) → dashboard 1회(S2+S3). 각 PR CI green 후 머지.

## 게이트 레지스트리

| 게이트 | 문구 | 발효 |
|---|---|---|
| 설계 잠금 | (이 세션 Bae "세 개 다 이번에"로 착수 승인) | D1~D4 LOCKED, 구현 착수 |
| 배포 | `deploy <target> approved.` 건별 | 미발효 — S1/S2 완료 후 요청 |

## 비목표 (이번 범위 아님)

- 질문 개수·순서 재설계(현행 4~6, UIUX 최소 1 유지)
- 아이디어 외 갈래(PRD/코드/URL)의 질문 흐름 — PRD는 질문 건너뜀이 의도된 설계
- 단일 질문 재생성 전용 엔드포인트(D3는 기존 전체 재생성 재사용으로 충분)
