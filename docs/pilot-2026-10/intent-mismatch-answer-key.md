# 정답지 — 의도 불일치 픽스처 10변형 (문 (c) "만들었는데 생각과 달라요", C-A7)

> 규율: **실행 전에 커밋**한다(이 파일의 커밋이 러너 결과 커밋보다 앞선 SHA가 증거다). 실행 뒤에는 맨 아래 "실행 후" 표만 채운다 — 기대 칸은 고치지 않는다. 틀린 예측도 결과다.
>
> 기계가 읽는 같은 내용: `tools/simsa-inspection-fixtures/intent-mismatch-answer-key.json` (두 파일의 변형 id·AC id가 같다는 것은 테스트가 고정한다).
> 근거: 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §3 W2~W3 문 (c) — "의도 불일치 픽스처 10변형 정답지(참양성 최초 1건 목표)". §1 끊김 #10: "생각과 다르다"의 기계 판정은 then 내용어 절반 일치 휴리스틱, **라이브 참양성 0건**.

## 무엇을 재는가

앱이 **작동은 하지만 의도와 다를 때**, 유저가 확인한 must 수용 기준(AC)이 다음 검수에 들어가 그 다름을 실제로 잡아내는가. 변형마다 AC 두 개를 둔다.

- **mismatch AC** — 의도를 말하는 기준. 앱이 이 기준을 어긴다. 잡으면 참양성(TP), 놓치면 거짓음성(FN).
- **control AC** — 같은 앱이 **지키는** 기준. 문제 없음이면 참음성(TN), 문제라고 하면 거짓양성(FP). 오탐을 재는 대조군이다.

두 AC 모두 역추론 지시서(`source: "inferred"`)의 must이고 `provenance.userConfirmedAcIds`에 들어 있다(D-2 amend — 확인된 것만 must). 러너가 그 지시서를 PUT으로 저장한 뒤 검수를 돌린다 — 검수 API에는 acceptancePlan을 직접 넣는 입구가 없고, 서버가 저장된 지시서에서 만든다.

## 판정 규칙 (러너 `compareToAnswerKey`와 같다)

| 대상 | 실제 상태 | 분류 |
|---|---|---|
| AC | `no_problem` | missed |
| AC | `broken` | detected |
| AC | `not_confirmed` + note `then_not_observed:` | detected |
| AC | 그 밖의 `not_confirmed` · `not_run` · 결과 없음 | no_call(판정 없음) |
| 변형(detectBy = acceptance) | mismatch AC의 분류 | detected → TP · missed → FN · no_call |
| 변형(detectBy = core_flow) | 검수 `works` | false → TP · true → FN · null → no_call |
| 변형(blindSpot = safety_rail) | 무엇이든 | no_call — 동작을 누르지 않았으므로 증거가 아니다 |
| control AC | 분류 | no_problem → TN · detected → FP · 나머지 no_call |

검수가 입력칸에 치는 값은 `서울`(한국어 런의 기본 표본 값), 브라우저는 1280×800 데스크톱 하나다. 기대 화면 글("afterText")은 이 조건에서 각 AC의 단계를 밟은 뒤 보일 글이고, 판정 휴리스틱(`inspector-container/acceptance-observe.mjs` observeThen, RUNNER_REV `a5-acceptance-4`)으로 미리 계산한 예측이다 — 라이브 결과가 아니다.

## 변형별 정답지

| id | 경로 | 원래 의도 | 지금 다른 점 | 기대 판정 | 기대 finding | 예상 실패 지점 |
|---|---|---|---|---|---|---|
| IM01 | `/intent-mismatch/booking-no-date` | 손님이 원하는 날짜를 골라 미용실 예약을 잡을 수 있어야 한다 | 날짜를 고르는 칸이 없고, 예약은 항상 '오늘'로 접수된다 | **TP** · 작동해요 아님 | `ac_not_confirmed` (then_not_observed: 고른·날짜·내역·함께) | 예약하기 뒤 확인 문구에 날짜가 없다 |
| IM02 | `/intent-mismatch/price-in-dollars` | 꽃다발 가격과 합계가 원화(원)로 보여야 한다 | 가격과 합계가 달러($)로 나온다 | **TP** · 작동해요 아님 | `ac_not_confirmed` (금액·원화·단위) | 담기 뒤 합계가 `$12.00`, 화면에 '원'이 없다 |
| IM03 | `/intent-mismatch/sort-reversed` | 가장 최근 공지가 맨 위에 보여야 한다 | 오래된 공지부터 나와 최신이 맨 아래 | **FN(예상 미탐)** · 작동해요/문제 못 찾음 | 없음 | 휴리스틱은 내용어 **존재**만 본다 — 순서를 못 본다 |
| IM04 | `/intent-mismatch/required-field-missing` | 체험 신청을 받을 때 전화번호를 꼭 함께 받아야 한다 | 이름만 받고 전화번호 칸이 없다 | **TP** · 작동해요 아님 | `ac_not_confirmed` (내역·전화번호·함께) | 완료 문구에 전화번호가 없다(칸 자체가 없다) |
| IM05 | `/intent-mismatch/button-wrong-page` | '장바구니 보기'를 누르면 담은 상품이 보이는 장바구니 화면이 나와야 한다 | 고객센터 화면으로 간다 | **TP** · 작동해요 아님 | `ac_not_confirmed` (장바구니·담·무선·이어폰) | 도착한 고객센터 화면에 장바구니·상품이 없다 |
| IM06 | `/intent-mismatch/english-copy` | 화면의 안내 문구가 모두 한국어로 보여야 한다 | 저장 안내가 영어(`Saved! Your place was added.`) | **TP** · 작동해요 아님 | `ac_not_confirmed` (맛집·저장했어요·문구) | 한국어 완료 문구가 없다(저장은 새로고침 뒤에도 남는다) |
| IM07 | `/intent-mismatch/not-persisted` | 기록한 책 목록이 새로고침한 뒤에도 남아 있어야 한다 | 새로고침하면 전부 사라진다 | **TP(핵심 흐름으로)** · 안 돼요 | `step_failed` — 새로고침하니 사라짐. AC-001 자체는 no_problem 예상 | AC 시나리오는 새로고침을 안 한다 — 잡는 것은 핵심 흐름의 지속성 확인(F6 경로) |
| IM08 | `/intent-mismatch/search-exact-only` | 카페 이름 일부만 입력해도 검색되어야 한다 | 이름을 정확히 다 적어야만 검색된다 | **TP** · 작동해요 아님 | `ac_not_confirmed` (서울숲·로스터리·목록·뜬) | '서울'로 검색하면 '검색 결과가 없어요' |
| IM09 | `/intent-mismatch/delete-no-confirm` | 메모를 지울 때는 정말 지울지 한 번 더 물어봐야 한다 | 묻지 않고 바로 지운다 | **no_call** · 무엇이든 | 판정 없음 — AC-001이 not_confirmed여도 우연 | 안전 레일이 '삭제'를 절대 누르지 않는다 → 사람 확인(user_verdict) 몫 |
| IM10 | `/intent-mismatch/mobile-button-hidden` | 휴대폰에서도 예약 요청 버튼을 누를 수 있어야 한다 | 좁은 화면에서는 '예약 요청' 버튼이 사라진다 | **FN(예상 미탐)** · 작동해요/문제 못 찾음 | 없음 | 검수 브라우저가 1280×800 데스크톱뿐 |

control AC 10개는 전부 **TN** 예상(FP 0).

**예상 집계: TP 7 · FN 2 · no_call 1 · FP 0 · TN 10.** 목표는 "참양성 최초 1건" — 예측대로면 7건.

## 수용 기준 (Given / When / Then)

각 변형의 AC-001 = mismatch, AC-002 = control. 단계(steps)는 JSON에 있다.

| id | AC | Given | When | Then |
|---|---|---|---|---|
| IM01 | AC-001 | 미용실 예약 화면 | 예약자 이름을 적고 '예약하기'를 누르면 | 고른 날짜가 예약 내역에 함께 표시된다 |
| IM01 | AC-002 | 미용실 예약 화면 | 예약자 이름을 적고 '예약하기'를 누르면 | '예약이 접수되었어요' 안내가 보인다 |
| IM02 | AC-001 | 꽃다발 목록 | 받는 분 이름을 적고 '담기'를 누르면 | 금액이 원화 단위로 보인다 |
| IM02 | AC-002 | 꽃다발 목록 | 받는 분 이름을 적고 '담기'를 누르면 | 장바구니에 장미 꽃다발이 담긴다 |
| IM03 | AC-001 | 공지 3건 | '공지 목록 보기'를 누르면 | 맨 위에 9월 30일 추석 연휴 공지가 보인다 |
| IM03 | AC-002 | 공지 3건 | '공지 목록 보기'를 누르면 | 공지 3건이 목록에 보인다 |
| IM04 | AC-001 | 체험 신청 화면 | 이름을 적고 '신청하기'를 누르면 | 신청 내역에 전화번호가 함께 보인다 |
| IM04 | AC-002 | 체험 신청 화면 | 이름을 적고 '신청하기'를 누르면 | '신청이 완료되었어요' 문구가 보인다 |
| IM05 | AC-001 | 상품 화면 | '장바구니 보기'를 누르면 | 장바구니에 담은 무선 이어폰이 보인다 |
| IM05 | AC-002 | 상품 화면 | '찜하기'를 누르면 | 찜 목록에 무선 이어폰이 담겼다고 나온다 |
| IM06 | AC-001 | 가게 메모 화면 | 가게 이름을 적고 '저장'을 누르면 | '맛집을 저장했어요' 완료 문구가 보인다 |
| IM06 | AC-002 | 가게 메모 화면 | 가게 이름을 적고 '저장'을 누르면 | 저장한 가게가 내 가게 목록에 보인다 |
| IM07 | AC-001 | 독서 기록 화면 | 책 제목을 적고 '기록 추가'를 누른 뒤 새로고침하면 | 새로고침한 뒤에도 추가한 책이 목록에 남아 있다 |
| IM07 | AC-002 | 독서 기록 화면 | 책 제목을 적고 '기록 추가'를 누르면 | 추가한 책이 목록에 바로 보인다 |
| IM08 | AC-001 | 카페 3곳 | 검색창에 '서울'을 넣고 '검색'을 누르면 | 서울숲 로스터리가 목록에 뜬다 |
| IM08 | AC-002 | 카페 3곳 | '전체 보기'를 누르면 | 전체 목록에 서울숲 로스터리와 망원 베이커리가 보인다 |
| IM09 | AC-001 | 메모 2개 | 첫 메모의 '삭제'를 누르면 | '정말 삭제할까요?' 확인 문구가 먼저 나온다 |
| IM09 | AC-002 | 메모 2개 | 메모 내용을 적고 '추가'를 누르면 | 추가한 메모가 보드에 보인다 |
| IM10 | AC-001 | 휴대폰 화면 | 원하는 시간을 적고 '예약 요청'을 누르면 | 휴대폰 화면에서도 '예약 요청을 보냈어요' 문구가 보인다 |
| IM10 | AC-002 | 예약 화면 | 원하는 시간을 적고 '예약 요청'을 누르면 | '예약 요청을 보냈어요' 문구가 보인다 |

## 설계상 주의 (픽스처가 지켜야 할 것)

- 핵심 흐름의 지속성 확인은 **목록(li)이 자란 흐름에서만** 새로고침한다. IM07만 저장하지 않는다. 목록이 자라는 IM06·IM09는 저장(localStorage)해서 "사라짐"으로 잘못 걸리지 않게 한다. 나머지는 결과를 목록이 아닌 칸에 쓴다.
- 판정 휴리스틱은 부분 문자열 일치다. mismatch AC의 내용어가 화면 어디에도(버튼 글·제목 포함) 절반 이상 나오지 않게 픽스처 문구를 골랐다 — 예: IM02 화면에는 '원'이라는 글자가 한 번도 없다.
- 이 정적 조건은 `apps/central-plane/test/train-c-a7-intent-mismatch.test.mjs`가 픽스처 HTML과 이 정답지를 대조해 고정한다(라이브 실행 아님).

## 실행 (승인 뒤)

1. `deploy simsa-inspection-fixtures approved.` — 픽스처 워커 배포(이 PR은 배포하지 않는다).
2. central-plane에 이 PR이 배포돼 있어야 한다(역추론 지시서 PUT에 provenance가 들어간다) — `PR #N merge approved.` → `deploy central-plane approved.`
3. `node tools/simsa-inspection-fixtures/intent-mismatch-run.mjs` (부분: `… IM01 IM05`) → `intent-mismatch-results-<date>.json` 커밋. 이 파일의 커밋보다 **뒤**여야 한다.

## 실행 후 (빈칸으로 커밋)

| 필드 | 실제 |
|---|---|
| 실행 일시 · 러너 결과 파일 | |
| 실제 집계 (TP · FN · FP · TN · no_call) | |
| 예측 적중 (변형 10 · control 10) | |
| 첫 참양성 변형 id · 검수 런 id | |
| 예측과 다른 변형 · 이유 | |
| 메모 | |
