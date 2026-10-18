# Simsa 공개 지수(바이브코딩 신뢰도 지수) 설계 — 2026-10-18

> 근거: Bae 2026-10-18 결정(Claude 문서 "Simsa 글로벌 지수 · YC W27 준비") + 리뷰 분석 236건(2026-10-18). 작성: Claude(클라우드 세션) · 수신: PC Claude Code · 승인자: Bae.
> 태그: [확정 Bae 2026-10-18] 오늘 원문 · [추정] 근거는 있으나 실측 없음 · [미검증] 데이터 없음 · [미확인] 저장소·배포 상태를 이 세션에서 못 봄 · [제안] 이 문서의 제안(Bae 결정 전).
> 상위 규칙: `CLAUDE.md`(회귀 전수검색·Vercel을 CI로 쓰지 않음) · `docs/EVIDENCE-RULE.md`(세 칸 보고 R2, 사전 등록 R8) · `docs/simsa-door-done-definitions-2026-09-30.md`(문 (b) 증거 ①~④)가 이 문서보다 우선한다.

## 0. 한 줄 · 이 문서가 바꾸는 것과 바꾸지 않는 것

**한 줄**: 같은 사양 10개를 빌더 4개에 한국어·영어로 시키고, Simsa가 `--repeat=3`으로 판정해, 매달 영어 리포트와 증거를 공개하는 "지수"를 — 이미 있는 벤치 #1 하네스를 확장해 — 만든다. 비공개 사양 세트·사람 정답 세트·증거 아카이브는 저장소 밖에 둔다.

| 바꾸는 것 | 바꾸지 않는 것 |
|---|---|
| 벤치 하네스(`tools/simsa-inspection-fixtures/agent-bench1*.mjs`)를 "사양 × 빌더 × 언어" 행렬·회차 단위로 확장 | 가격·과금·청구 주체 결정 — `docs/simsa-strategy-2026-10-05.md` §6·`docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §2·§3·§5.5 D-23 그대로 |
| 정답지·사양 세트의 **보관 위치**(저장소 밖) + 사전 등록 방식(해시) | current-task KV 스파이크(`.conclave/current-task.md`, 10-01 승인) — 손대지 않는다 |
| 집계에 "회차 간 판정 불일치"·"사양(연동) 축" 추가 | 검사 엔진 v2 설계 잠금 V-1~V-8(`docs/simsa-inspector-v2-design-2026-10-07.md` §1) — 재론하지 않는다 |
| 동의·가공 설계에 "개발자 제공" 단계 추가(변호사 검토 전 초안) | **순서**: `docs/HANDOFF-2026-10-18.md`의 문 (b) 재현성 수리가 먼저다. 이 문서는 그 다음에 읽는다 |

## 1. 결정 사항 (오늘 Bae 확정, 원문 요지)

| # | 결정 | 태그 | 저장소 문서와의 관계 |
|---|---|---|---|
| D1 | Simsa = 비개발자가 AI로 만든 앱이 어디서 왜 깨지는지 가장 많이 아는 **중립 심판**. 해자 = 코드가 아니라 시간·지역이 만든 실패 데이터 + 중립성 | [확정 Bae 2026-10-18] | strategy §8 X-5(독립성)·§9(데이터 해자)와 같다. "코드가 해자 아님"은 §8 "X-1~X-4는 빌더가 따라온다"의 연장 |
| D2 | 무대 = **매달 공개하는 "바이브코딩 신뢰도 지수"**(같은 사양 × 빌더 여러 개, 약속 대비 검수, 증거 공개), **영어** 발표 | [확정 Bae 2026-10-18] | strategy §2 "통제 벤치마크 정기 병행"·§10 ②.5 "통제 벤치마크 자체 생산 + 공개"·§8 X-8 "정확도 공개"의 구체화 |
| D3 | 확장 순서: 한국 비개발자 → **일본(2번째 확정)** → 프랑스(3번째 권고) → 영어권. 태국은 일본 직후 저비용 파일럿 | [확정 Bae 2026-10-18]; 프랑스·태국은 [추정] | strategy §1 "비영어권 → 영어권"과 같다. 나라 순서는 오늘 처음 적힘 |
| D4 | 개발자는 비개발자 실패 데이터 위에서 서비스를 만드는 쪽. **양면 구조**: Simsa = 판정 + 증거(심판)만, 수정은 개발자/에이전트가 개발지시서로, Simsa가 재판정해 "고쳐졌다" 증거를 남긴다 | [확정 Bae 2026-10-18] | strategy §3·§6 "고치기 유료(Simsa가 고침)"과 **방향이 다르다** — §6은 Simsa가 직접 고치는 수익 모델, 오늘은 고치는 주체를 밖에 둔다. 가격 결정은 그대로(§0)이므로 모순이 아니라 **열린 질문 Q4**로 남긴다 |
| D5 | 오픈소스: 판정 엔진 공개 의향. 조건 = 따라올 수 없는 head start | [확정 Bae 2026-10-18]; head start의 정의는 [미검증] | 저장소는 이미 **공개**(`https://github.com/3SVS/simsa`, `apps/central-plane/scripts/d1-readonly-queries.mjs:15`)이고 라이선스는 `LICENSE` FSL-1.1-Apache-2.0(`package.json:6`). 즉 소스는 이미 보이고, 바뀌는 것은 **사용 허가 범위**뿐 → Q4 |
| D6 | 1회차 빌더 = Lovable·Bolt·v0·**Replit**. 프롬프트 = 비개발자 말투 한국어 고정문 + 같은 문장 영어 → "한국어로 주문하면 더 깨지는가" 측정. 수정 요청 ≤3회, 과정 기록 | [확정 Bae 2026-10-18] | 기존 벤치 #1은 ChatGPT·Gemini·Claude·v0·Bolt·Lovable(`tools/simsa-inspection-fixtures/agent-bench1-local.mjs:52-59`), 파일럿 본 묶음은 Lovable·v0·Bolt(`docs/pilot-2026-10/RUNBOOK.md:144`). **Replit은 처음**(태그는 있음 — `apps/central-plane/src/workspace/built-with.ts:21`) |
| D7 | 비공개 시험 세트 분리는 공개 시점에 결정 | [확정 Bae 2026-10-18] | §3·Q1 |
| D8 | 15일 목표 = 지원서가 아니라 "빌더별 한국 연동 실패율" 숫자 하나(YC W27, 11/2 20:00 PT) | [확정 Bae 2026-10-18] | §7 순서의 1회차 비공개 실행이 이 숫자를 낸다 |
| D9 | **수익 방향**: 유저(검수받는 쪽)에게는 소액, 유저 데이터로 만든 집계·패턴을 에이전트/빌더 회사에 고가로 판다. 지수 순위 자체에는 돈이 닿지 않게 한다(심판 자격) | [확정 Bae 2026-10-18 22:30]; 가격·시점은 기존 문서대로 미정 | strategy §2 "무료로 규모 우선, BM은 규모 이후"와 순서가 같다. 판매 대상은 §5 가공 단계의 **집계 패턴**뿐(원본·개별 앱 불가). §5 변호사 확인 1번(가명정보 유료 제공 가능 여부)이 이 결정의 전제 |
| D10 | **정부 지원사업은 허용하되, 데이터셋·기준(평가 기준·택소노미·비공개 test 세트·사람 판정 정답 세트)의 소유권과 사용권을 넘기는 조건은 받지 않는다.** 판단 규칙: 공고·협약서에 ① 결과물 소유권 이전 ② 발주처 배타권 ③ 목적 외 사용 금지 ④ 비공개 분할까지 공개 의무 중 하나라도 있으면 그 과업 범위에 Simsa 자산을 넣지 않는다. 넣어도 되는 것: 과업용으로 새로 만든 공개 dev 분할, 운영비·인건비 지원, 크레딧·공간. 안 되는 것: 기존 사람 판정·비공개 사양·실사용자 데이터·평가 기준 정의 | [확정 Bae 2026-10-19 00:06, 같은 시각 '전부 제외'를 정정] | 2026 NIA 벤치마크 사업 공고의 AI허브 공개·2년 배타권·목적 외 사용 금지 조건은 ①~③에 해당 → 그 사업에는 공개 dev 분할만, 나머지는 과업 범위 밖. 협약 전 범위 분리 필수 |

## 2. 공개 지수 설계

### 2.1 회차 · 사양 · 빌더 · 프롬프트 · 반복

| 항목 | 정의 |
|---|---|
| 회차 | **월 1회**. 회차 id = `YYYY-MM`. 회차마다 엔진 커밋 SHA(central-plane)·컨테이너 이미지·모델 id를 고정해 기록한다(v2 설계 §4 "로컬 = 프로덕션 같은 모델·도구·상한" 규칙 그대로) |
| 사양 세트 | 아래 10개. 글로벌 연동 ↔ 한국 연동이 **쌍**(1↔2, 3↔4, 5↔6). 7·8은 공통, 9·10은 한국 전용. 공통 검수 기준(모든 사양): 비밀키 노출·모바일 화면·콘솔 에러·배포 URL에서 실제 동작 |
| 빌더 | Lovable · Bolt · v0 · Replit (1회차). 빌더 API는 [미검증](strategy §3) → 1회차는 **사람이 빌더 UI에서 직접 생성**한다 |
| 프롬프트 | 사양마다 KO 고정문 1개 + 같은 뜻의 EN 고정문 1개 = **쌍**. 사양 1건당 빌더 4 × 언어 2 = 앱 8개. 되묻는 빌더에는 사전에 정한 답만 준다(`docs/pilot-2026-10/intent-prompt-2026-10-04.md:9` 규칙 그대로, 답은 정답지 메모에) |
| 수정 요청 | 첫 판정 뒤 Simsa의 빌더 붙여넣기 지시(`RUNBOOK.md` §2-4a 경로)를 빌더 채팅에 넣고 재판정. **최대 3회**. 회차 지표에 "n회 수정 뒤 통과율"을 둔다. 사람이 지시를 고치면 개입=예(RUNBOOK §3 '개입' 칸 그대로) |
| 반복 | 각 앱을 `--repeat=3`(`agent-bench1.mjs:84-86`). 3회 판정 쪽(works/broken/hold)이 전부 같아야 "안정"; 하나라도 다르면 그 셀은 **판정 불안정**으로 공개(판정값을 내지 않는다). **지수에서는 AC 목록을 LLM이 런마다 추출하지 않는다** — 사양표의 "핵심 검수 기준"(+공통 기준)을 사전 등록된 AC로 **주입**해 3런이 같은 질문에 답하게 한다(HANDOFF §3-3 추가 항목: 질문 동일성 ①을 먼저 보장). AC 추출 LLM의 비결정성·10개 상한 절단은 제품 경로의 결함이지 지수 설계의 일부가 아니다 |
| 실행 시간대 | **회차 고정 조건: 모든 런은 KST 10:00~17:00에 돈다**(실행 시각 기록). 이유: "오늘 예약" 같은 given은 당일 남은 시간 슬롯이 있어야 만들 수 있고, 야간 런은 A6/A7류 기준이 `precondition_not_met`로 구조적으로 빠져 지표가 시각에 따라 달라진다(HANDOFF §3-3 PR4 Q2, Bae 2026-10-19). 시간대 밖 런은 회차 집계에 넣지 않는다 |

**사양 10개(오늘 원문 그대로)**

| # | 사양 | 구분 | 핵심 검수 기준 |
|---|---|---|---|
| 1 | 이메일 회원가입·로그인·비밀번호 재설정 | 글로벌 (2와 쌍) | 중복 가입 차단, 재설정 메일 링크 동작, 로그아웃 후 보호 페이지 차단 |
| 2 | 카카오 로그인 회원가입 | 한국 | 배포 도메인에서 콜백 동작, 재로그인 시 중복 계정 없음, 탈퇴 시 연결 해제 |
| 3 | 예약 + Stripe 결제 | 글로벌 (4와 쌍) | 같은 시간 이중 예약 불가, 결제 성공 시에만 확정, 실패·취소 시 슬롯 해제 |
| 4 | 예약 + 토스페이먼츠 결제 | 한국 | 3번과 동일 + 결제 승인 후 서버 검증(금액 위변조 차단) |
| 5 | 매장 찾기 + Google Maps | 글로벌 (6과 쌍) | 주소 검색 → 마커 표시, 모바일에서 지도 로드, API 키 제한 설정 |
| 6 | 매장 찾기 + 네이버 지도 | 한국 | 5번과 동일 + 도로명 주소 검색 |
| 7 | 할 일·메모 CRUD, 사용자별 데이터 분리 | 공통 | 남의 데이터 조회·수정 불가(RLS), 새로고침 후 유지, 빈 상태 화면 |
| 8 | 사진 업로드 갤러리 | 공통 | 용량·형식 제한, 비공개 파일 URL 직접 접근 차단, 썸네일 표시 |
| 9 | 가입 시 개인정보 동의 + 탈퇴 | 한국 (개인정보보호법) | 필수·선택 동의 분리, 미동의 시 진행 불가, 탈퇴 시 데이터 삭제 |
| 10 | 한글 검색·정렬 상품 목록 | 한국 | 부분·초성 검색, 가나다 정렬, 긴 한글 줄바꿈·깨짐 없음 |

사양 3·4(결제)와 2(카카오)는 **외부 계정·키**가 있어야 빌더가 배포까지 간다 — 1회차 전에 테스트 키(Stripe test mode·토스 테스트·카카오 개발자 앱)를 준비하고, 키 자체는 정답지에 적지 않는다(HANDOFF §4 "secrets를 파일·로그·커밋에 남기지 않음").

**사양 세트 파일 형식** (`specs.json`, 저장소 밖 — §3). 지금 `APPS` 원소(`agent-bench1-local.mjs:52-59`: `id·url·expected·mustFailed·timeDependent`)를 셀 단위로 넓힌 것이다. 하네스는 이 파일을 Zod로 읽는다(`CLAUDE.md` "Zod at every external boundary").

```jsonc
{
  "cycle": "2026-11",
  "specs": [
    {
      "id": "S04",                       // 사양 번호(위 표)
      "pair": "S03",                     // 쌍(없으면 null)
      "region": "kr",                    // kr | global | common
      "prompt": { "ko": "…고정문…", "en": "…same meaning…" },
      "followupAnswers": { "ko": ["…"], "en": ["…"] },   // 빌더가 되물을 때 줄 답(순서 고정)
      "must": [ { "id": "A1", "ko": "같은 시간 이중 예약 불가", "en": "…" }, … ],
      "common": ["secret_exposure", "mobile", "console_error", "deployed_url_works"]
    }
  ],
  "builders": ["lovable", "bolt", "v0", "replit"],      // built-with.ts 태그 그대로
  "repeat": 3,
  "maxFixRequests": 3
}
```

셀 = `(spec.id, builder, lang)`. 앱 주소는 사양 세트가 아니라 **정답 세트**(`answers.json`, 생성 뒤 기록)에 들어간다 — 사양 세트는 앱 생성 **전**에 해시를 등록해야 하기 때문이다.

### 2.2 지표 정의

| 지표 | 정의 | 셈 단위 | 지금 코드 |
|---|---|---|---|
| 반대 판정 | 정답지가 '작동'인데 엔진이 '고장', 또는 그 반대 | 셀(사양×빌더×언어) | 있음 — `agent-bench1-local.mjs:266` `opposite` |
| 앱 일치 | 정답지 기대 쪽과 엔진 판정 쪽이 같음(`broken_or_hold`는 보류도 일치) | 셀 | 있음 — `:267` `match` |
| must 짚음 | 정답지의 must 실패를 엔진 실패 문장이 짚은 비율 | must 항목 | 있음(키워드 대조) — `:268-269` · **키워드는 관대하다**(`docs/pilot-2026-10/bench1-agent-local-results-2026-10-05.md` §2: 키워드 69% vs 사람 대조 ≈ 6/13) → 사람 대조 열을 정답지에 둔다(§4) |
| 3회 불일치 | `--repeat=3`에서 셀의 판정 쪽이 전부 같지 않은 셀 수 / 전체 셀 수 | 셀 | **없음** — `agent-bench1.mjs:128-137` `aggregate()`는 런별 지표의 평균·최소·최대만 낸다. 셀 단위 쪽 비교가 필요 |
| 런 비용 | 런당 USD, 모델별 분해 | 런 | 있음 — `apps/central-plane/src/routes/workspace-visual-check-runs.ts:218-233` `costUsd`·`costByModel`·`callsByModel`; 하네스 `agent-bench1.mjs:74-75` |
| 빌더×연동 실패율 | 빌더 b가 사양 s(연동)를 n회 수정 안에 통과시키지 못한 비율; KO·EN 따로 | 빌더×사양×언어 | **없음** — `/admin/defect-stats`(`workspace-visual-check-runs.ts:863`)와 `inspection_defects`(`apps/central-plane/migrations/0075_inspection_agent.sql:28-42`)는 빌더×**결함 분류**(`DEFECT_CLASSES`, `apps/central-plane/src/agent-inspection.ts:1415-1430`)이고 **사양 축이 없다** |
| n회 수정 뒤 통과율 | 수정 요청 k회(0~3) 뒤 must 전부 통과 셀 비율 | 셀 | 없음 — 프로덕션 하네스는 앱당 1런(`agent-bench1.mjs:31-77`) |
| KO−EN 차 | 같은 사양·빌더에서 KO 프롬프트 앱과 EN 프롬프트 앱의 실패율 차 | 사양×빌더 | 없음 — 언어 축 자체가 하네스에 없음(`locale`은 **검수 언어**다 — `apps/central-plane/inspector-container/agent-run.mjs:48`) |

**셀 상태(공개 표의 값)** — 판정 쪽은 `side()`(`agent-bench1-local.mjs:265`)의 works/broken/hold 셋 그대로.

| 상태 | 조건 |
|---|---|
| `pass` | 3런 모두 works |
| `fail(<defect_class>)` | 3런 모두 broken. 분류는 3런에서 가장 많은 `DEFECT_CLASSES` 값; 동률이면 `other` |
| `hold` | 3런 모두 hold(로그인 뒤 등 "확인 못 함") — 통과로 세지 않는다 |
| `unstable` | 3런의 쪽이 전부 같지 않음. 공개 표에 값 대신 `unstable`, 집계에서는 분모에만 |
| `n/a — <이유>` | 빌더가 배포 주소를 못 냄·외부 키 실패 등 엔진 밖 사유. 분모에서 제외하고 이유를 적는다(`intent-prompt-2026-10-04.md:18` "측정 불가 — 이유" 규칙) |

빌더×연동 실패율 = 그 빌더·언어의 셀 중 `fail` / (`pass`+`fail`). `hold`·`unstable`·`n/a`는 비율에 넣지 않고 개수로 병기한다. 이 셈은 서버 변경 없이 하네스 집계에서 한다 — 셀 JSON에 `spec·builder·lang`이 있으면 된다.

### 2.3 공개 산출물

- **형식**: 영문 마크다운 리포트 1편/회차 + 셀별 증거 링크. 머리: 회차 id · 엔진 SHA · 모델 id · 사양 세트 해시(§3) · 정답 세트 해시 · 사람-엔진 일치율(§4) · 3회 불일치율 · 런당 비용. 본문: 사양 × 빌더 표(값 = 통과 / 실패(결함 분류) / 불안정 / 측정 불가), KO·EN 두 장. 부록: 방법론 링크(이 문서 §2·§4, `RUNBOOK.md` §4·§5).
- **증거 링크**: 셀마다 가림 판 리포트(판정 문구·발견 코드·스크린샷). 가림 규칙은 `RUNBOOK.md` §7 "공개 저장소 주의" 그대로 — 런 id·초 단위 시각·userKey를 내지 않는다. 비밀키·개인정보 가림은 §5.
- **공개 장소**: [미정] → Q3. 저장소 `docs/index/<YYYY-MM>/report.en.md` [제안]가 가장 싸다(이미 공개 저장소).
- **공개하지 않는 것**: 사양 프롬프트 전문 · 정답지 전문 · 증거 원본(가림 전) · 결과 JSON(앱 주소·id 포함).

**리포트 머리 틀**(영문, 생성기가 집계 JSON에서 채운다 — 손으로 쓰는 칸은 없다):

```markdown
# Vibe-Coding Reliability Index — 2026-11 (cycle 1)
Engine: central-plane <sha7> · container <tag> · judge model <id> · inspect locale ko/en
Spec set: 10 specs (5 KR ↔ 5 global pairs), sha256 <hash> registered <date, commit sha7>
Answer set (human): sha256 <hash> registered <date, commit sha7>
Cells: 80 (10 specs × 4 builders × ko/en) × 3 runs = 240 inspections
Judge vs human: agreement <n>% · opposite <n> · hold <n> · unstable cells <n>/<80>
Cost: $<mean>/run (by model: …) · wall time <min>/run
Method: docs/simsa-index-design-2026-10-18.md §2, §4 · docs/pilot-2026-10/RUNBOOK.md §4–5
```

본문 표는 사양(행) × 빌더(열), KO 한 장·EN 한 장, 셀 값은 §2.2 상태. 셀을 누르면 가림 판 리포트로 간다.

### 2.4 시계열 파일 보존 규칙 (기존 명명 규칙의 확장)

지금: `agent-bench1-prod-result-<ISO시각>-r<k>.json` + `agent-bench1-prod-aggregate-<ISO시각>.json`, 하네스 폴더에 씀(`agent-bench1.mjs:103,106`, `join(here, …)`). 로컬 결과 `agent-bench1-local-result-run1~4.json`은 **git에 추적 중**(앱 주소 포함). 프로덕션 결과는 추적되지 않았고 `.gitignore`에 패턴도 없다 → 다음 `git add -A`에서 올라갈 수 있다.

| 규칙 | 내용 |
|---|---|
| 파일명 | `index-<YYYY-MM>-<engineSha7>-<spec>-<builder>-<lang>-r<k>.json`(런) · `index-<YYYY-MM>-<engineSha7>-aggregate.json`(회차 집계) · `index-<YYYY-MM>-report.en.md`(공개 리포트) |
| 위치 | 런·집계 JSON = 저장소 **밖** 증거 아카이브(`--out=<dir>` 인자 신설, 기본값은 저장소 밖). 리포트 = 저장소 `docs/index/<YYYY-MM>/` |
| 덮어쓰기 | 금지(지금 규칙 그대로 — `agent-bench1.mjs:84` 주석). 재실행은 새 시각 |
| gitignore | `tools/simsa-inspection-fixtures/*-result-*.json`·`*-aggregate-*.json` 추가. 이미 추적 중인 local run1~4는 **지우지 않는다**(이력) — 유지 여부는 Q6 |
| 보존 | 회차 아카이브는 영구(시계열이 해자, HANDOFF §5). 원본 스크린샷은 §5 보관기한 규칙을 따르되 **지수용 앱은 Simsa가 만든 앱이라 개인정보가 없다** → 기한 없음 [제안] |

### 2.5 있음 / 확장 / 신규

| 항목 | 상태 | 근거(파일:줄) |
|---|---|---|
| `--repeat=N` + 런별 시각 파일 + 집계 | 있음 | `agent-bench1.mjs:84-107`, 테스트 `apps/central-plane/test/agent-bench-aggregate.test.mjs` |
| 반대 판정·앱 일치·must 짚음(키워드)·런 비용 | 있음 | `agent-bench1-local.mjs:264-270`, `agent-bench1.mjs:111-125` |
| 정답지 선기록(사전 등록)·실행 후 칸 분리 | 있음 | `docs/pilot-2026-10/answer-key-TEMPLATE.md:3`, `RUNBOOK.md` §1-2 |
| 판정 매핑·보류 처리·L1 쪽 관계 | 있음 | `RUNBOOK.md` §4.1·§4.3 |
| 빌더 태그(Replit 포함) | 있음 | `built-with.ts:16-21` |
| 결함 분류 닫힌 어휘 + 빌더×결함 집계 | 있음 | `agent-inspection.ts:1415-1430`, 0075:28-42, `workspace-visual-check-runs.ts:863` |
| 발견 코드 닫힌 어휘(`output_language_mismatch` 등) | 있음 | `apps/central-plane/src/nondev-report.ts:115-133` |
| 모바일 화면 확인 | 있음 | `apps/central-plane/inspector-container/agent-driver.mjs:326` `mobileCheck` |
| 콘솔 에러 발견 | 있음 | `nondev-report.ts:756` |
| 빌더 붙여넣기 지시 + 재검수 계보(sourceCheckId) | 있음 | `RUNBOOK.md` §2-4a·§4.4 |
| 공개 출력 가림 규칙 | 있음 | `RUNBOOK.md` §7, `d1-readonly-queries.mjs:15-19` |
| 런 예산 상한(env) | 있음 | `apps/central-plane/src/workspace/inspection-agent.ts:141,149-152`(기본 $3; "무료 상한 $0.6"의 출처는 [미확인]) |
| 사양 세트 외부 파일 로드(`--specs=`) | 확장 | 지금은 `APPS`·`REGISTERED_PROMPT` 하드코딩(`agent-bench1-local.mjs:46-59`) |
| 사양×빌더×언어 행렬 + 회차 id + 엔진 SHA 기록 | 확장 | `agent-bench1.mjs:79-108` `main()` |
| 셀 단위 3회 불일치 집계 | 확장 | `agent-bench1.mjs:128-137` `aggregate()` |
| 사양(연동) 축 실패율 | 확장 | `/admin/defect-stats`에 spec id 축 추가, 또는 하네스 집계에서만(서버 변경 없이) [제안: 후자 먼저] |
| 수정 요청 ≤3회 루프 + 과정 기록 | 확장 | 하네스에 "지시 붙여넣기 → 재배포 대기 → 재런" 단계 없음. 1회차는 사람이 RUNBOOK §2 절차로, 하네스는 재런만 |
| must 짚음 사람 대조 열 | 확장 | 정답지 '실행 후' 표에 열 추가(`answer-key-TEMPLATE.md:20-28`) |
| `--out=<dir>` + gitignore | 확장 | §2.4 |
| 영문 공개 리포트 생성기 | 신규 | 집계 JSON → `report.en.md`. 가림 규칙은 `pilot-metrics.mjs`의 가림 판 로직 재사용(`tools/simsa-completion-loop-spike/pilot-metrics.mjs`) |
| 사람 정답 세트 + 일치율 | 신규 | §4 |
| 비밀키 노출 검사(번들·응답 속 키 패턴) | 신규 | 지금 `redactSecrets`(`agent-inspection.ts:528-545`)는 **사용자가 준 비밀**을 출력에서 가리는 함수다. 앱이 **새는 키**를 찾는 검사는 없다. v2 설계 §2.2 정찰의 "설정 자리표시자" 추출이 가장 가깝다 |
| KO/EN 프롬프트 쌍 관리 | 신규 | 사양 세트 파일 형식에 포함 |
| 사전 등록 해시 | 신규 | §3 |

합계: 있음 12 · 확장 8 · 신규 5.

### 2.6 구현 메모 (PC Claude Code용 — 코드 위치만, 수정은 승인 뒤)

| 변경 | 위치 | 방법 |
|---|---|---|
| `--specs=`·`--answers=`·`--out=`·`--cycle=` 인자 | `agent-bench1.mjs:20` `arg()` 옆 | 하드코딩 `APPS` import(`:17`)를 파일 로드로 대체. Zod 스키마는 새 파일 `tools/simsa-inspection-fixtures/index-spec.schema.mjs` [제안]. `REGISTERED_PROMPT`는 셀의 `prompt[lang]`으로 |
| 셀 루프 | `agent-bench1.mjs:88-104` | `for k in repeat` 안의 `apps` 루프를 셀 배열(spec×builder×lang)로. `benchProd(app)`의 `app.url`·`app.expected`·`app.mustFailed`는 정답 세트 셀에서 |
| 셀 불일치 집계 | `agent-bench1.mjs:128-137` `aggregate()` | 런별 요약이 아니라 셀별 3런 `side`를 모아 §2.2 상태를 낸다. `summarize()`(`:111-125`)는 그대로 두고 **새 함수** `aggregateCells(runs)`로 — 옛 테스트를 깨지 않는다 |
| 테스트 | `apps/central-plane/test/agent-bench-aggregate.test.mjs` 옆 새 파일 | `unstable`·`n/a`·동률 `other` 케이스. 옛 코드(`aggregate()`만)에서 실패하는지 확인(R8) |
| 회차 메타 기록 | 결과 JSON 머리(`:103`) | `cycle·engineSha·specsSha256·answersSha256·budgetUsd` 추가. `engineSha`는 `GET /` 또는 배포 워크플로 이력에서 [미확인: 서버가 커밋 SHA를 노출하는 라우트가 있는지] |
| 리포트 생성기 | 새 파일 `tools/simsa-inspection-fixtures/index-report.mjs` | 집계 JSON → `report.en.md`. 가림은 `pilot-metrics.mjs`의 마스킹 판 규칙(런 id 금지·분 단위 시각)을 함수로 빼서 공유 |
| gitignore | `.gitignore:68` 근처 | `tools/simsa-inspection-fixtures/*-result-*.json`, `*-aggregate-*.json` |

`tools/`는 pnpm 워크스페이스 밖이라 CI가 돌리지 않는다(`RUNBOOK.md:224`) — 테스트는 `apps/central-plane/test/`에 두는 지금 방식(`agent-bench-aggregate.test.mjs:2-3`, playwright 없으면 건너뜀)을 따른다.

## 3. 공개·비공개 경계

| 공개 (확산·신뢰) | 비공개 (해자) |
|---|---|
| 검수 실행기와 채점 엔진 | 지수용 비공개 사양 세트 |
| 검수 기준 포맷 (약속 → 기준 변환 규격) | 사람 판정 정답 세트와 정확도 조정 기록 |
| 공개 사양 샘플 일부 | 회차별 전체 증거 기록 아카이브 |
| 채점 방법론 문서 | 실제 사용자 실패 데이터, 호스팅 서비스 |

**저장소는 이미 공개다.** 따라서 "공개"는 추가 조치가 없고, "비공개"는 **저장소 밖으로 옮기거나 처음부터 넣지 않는** 조치다.

| 구분 | 저장소 경로 | 조치 |
|---|---|---|
| 공개 — 실행기·엔진 | `apps/central-plane/src/agent-inspection.ts` · `inspector-container/agent-run.mjs`·`agent-driver.mjs` · `src/nondev-report.ts`(`decideFromEvidence`) · `src/workspace/inspection-agent.ts` | 이미 공개. 라이선스 변경은 Q4 |
| 공개 — 기준 변환 규격 | `src/acceptance-plan.ts`(`agentAcsFromDevSpec`) · `src/workspace/generate-dev-spec.ts` · `DEFECT_CLASSES`·`FINDING_CODES` | 이미 공개 |
| 공개 — 하네스·방법론 | `tools/simsa-inspection-fixtures/agent-bench1*.mjs` · `docs/pilot-2026-10/RUNBOOK.md` §4·§5 · `docs/EVIDENCE-RULE.md` · 이 문서 | 이미 공개 |
| 공개 — 사양 샘플 | [미정] 10개 중 공통 사양 7·8의 KO/EN 프롬프트 [제안] | Q3 |
| **비공개 — 사양 세트** | 지금은 벤치 #1 프롬프트가 코드에 하드코딩(`agent-bench1-local.mjs:46-47`) | **옮긴다**: 사양 세트 파일(`specs.json`: id·KO·EN·must 기준·되물음 답)을 저장소 밖(예: `~/simsa-index/<YYYY-MM>/specs.json`)에 두고 `--specs=`로 읽는다. 저장소에는 **sha256만** 커밋(`docs/index/<YYYY-MM>/registration.md`) = 사전 등록 증거. 방식은 `docs/federated-sync.md`의 "sha256만 떠난다"와 같은 원리 |
| **비공개 — 사람 정답 세트** | 파일럿 정답지 6건은 **이미 공개**(`docs/pilot-2026-10/answer-key-*.md`). 벤치 #1 정답지(`bench1-answer-key-*.md`)와 `benchmark-salon-2026-10-05.md`는 코드·문서가 인용하지만 **git에 없다**(`agent-bench1-local.mjs:45`, `bench1-agent-local-results-2026-10-05.md:5`) — 위치 [미확인], R1 위반 상태 | 지수 정답 세트는 사양 세트와 같은 폴더(`answers.json`), 해시만 커밋. 벤치 #1 정답지는 실제 위치를 확인해 `registration.md`에 해시로 기록한다 |
| **비공개 — 증거 아카이브** | 로컬 결과 run1~4 JSON은 추적 중(앱 주소 포함) | §2.4 `--out` + gitignore. 기존 4개는 Q6 |
| **비공개 — 실제 사용자 데이터** | D1·R2(`events/{region}/…`) | 저장소에 없음. 공개 출력은 `d1-readonly-queries.mjs` 화이트리스트와 `/admin/moat-stats` 닫힌 어휘(`nondev-report.ts:110-114`)로만 |

**사전 등록과 비공개의 충돌**: `RUNBOOK.md` §1-2는 정답지를 **첫 런 전 main에 머지**하라고 한다(공개 저장소). 비공개 정답 세트는 이 규칙과 양립하지 않는다 → 해시 등록으로 대체(정답 파일의 sha256 + 줄 수 + 작성 시각을 첫 런 전에 main에 커밋; 공개 리포트에 같은 해시를 싣고, 외부 검증 요청이 오면 파일을 제3자에게 열 수 있다). RUNBOOK §4·§5는 바꾸지 않는다 — 지수는 별 문서(이 문서 §4)로 사전 등록한다. 결정은 Q1.

**등록 파일 틀** (`docs/index/<YYYY-MM>/registration.md`, 첫 런 전 main 머지 — 머지 커밋 SHA가 증거. main은 스쿼시 머지라 브랜치 커밋 SHA는 이력에 남지 않는다 — `RUNBOOK.md:24`의 같은 주의):

```markdown
# 지수 사전 등록 — 2026-11
| 파일 | sha256 | 줄 수 | 작성 시각(UTC, 분) | 비고 |
|---|---|---|---|---|
| specs.json   | <64hex> | n | 2026-10-DD HH:MM | 앱 생성 전 |
| answers.json | <64hex> | n | 2026-10-DD HH:MM | 앱 생성 뒤·첫 런 전 |
엔진: central-plane <sha7> · 컨테이너 <tag> · 모델 <id> · INSPECT_AGENT_BUDGET_USD=<n>
정정 기록: (없음)
```

해시는 `shasum -a 256`으로 사람이 찍고, 하네스는 `--specs`·`--answers`로 읽은 파일의 해시를 결과 JSON·집계·리포트에 다시 적는다 — 세 값이 같아야 "등록된 세트로 돌렸다"다. 실행 뒤 파일을 고치면 해시가 어긋나 드러난다(정정은 정정 기록에 새 해시로).

## 4. 심판 정확도 체계

지수의 수치는 **엔진이 낸 값**이다. 외부가 "엔진을 왜 믿나"를 물으면 답은 하나다: **사람 정답 세트 대비 일치율을 매 회차 함께 공개한다**(strategy §8 X-8).

| 요소 | 정의 | 기존 근거 |
|---|---|---|
| 사람 정답 세트 | 셀(사양×빌더×언어)마다 사람이 must 기준별 통과/실패 + 증거(스크린샷·요청 기록)를 **엔진 런 전에** 기록. 작성 = Claude 수작업 검증 + Bae 확인(v2 설계 §4 G1 정답지 규칙 그대로). 해시 사전 등록(§3) | `answer-key-TEMPLATE.md`, v2 설계 §4 G1 |
| 일치율(공개 수치) | 셀 쪽 비교: 같은 쪽 / 반대 쪽 / 보류 차이(`RUNBOOK.md` §4.3 L1 세 가지 그대로). **공개는 셋 다**: 일치율 = 같은 쪽 / (같은 쪽 + 반대 쪽), 반대율, 보류율. 보류를 불일치로 세지 않는다(§4.3 ★) | `RUNBOOK.md` §4.1·§4.3 |
| must 짚음(사람 대조) | 키워드 대조(`agent-bench1-local.mjs:268`)와 사람 대조를 **나란히** 공개. 키워드 값만 내지 않는다 | `bench1-agent-local-results-2026-10-05.md` §2 교훈 |
| 재실행 결정론 | `--repeat=3` 셀 안정률(§2.2). 불안정 셀은 일치율 계산에서 빼고 따로 센다 | HANDOFF §3 1단계 "3회 간 판정 불일치 건수" |
| 거짓 통과 0 | 로그인 뒤·결제 뒤처럼 못 본 곳은 "확인 못 함"(보류). 통과로 내지 않는다 | 문 (b) 증거 ③(`door-done` 문 (b)) |
| 정답 세트 사후 수정 금지 | 틀린 정답도 결과. 정정은 정정 기록에만 | HANDOFF §4, `RUNBOOK.md` §4 머리 |
| 조정 기록(비공개) | 회차마다 "엔진이 틀린 셀 → 원인 분류(프롬프트 과해석 H1류 / 탐침 미사용 H2류 / 예산 잘림 H3류 / 기타)"를 적는다. HANDOFF §3 2단계 분류 그대로. 공개하지 않는다(§3 "정확도 조정 기록") | `docs/pilot-2026-10/bench1-prod3-diagnosis-2026-10-06.md` §2 H1~H4 |

**문 (b) 완료 증거와의 관계**(`docs/simsa-door-done-definitions-2026-09-30.md` 문 (b)): ② "첫 판정 vs 정답지 일치"는 지수의 일치율과 같은 측정이고, ③ "거짓 통과 0"은 보류 규칙이며, ④ journey-audit은 비개발자 리포트 문구 검사로 그대로 쓴다. ①(`user_verdict=as_intended`로 닫힘)은 **실유저**가 필요하므로 지수가 대신하지 못한다 — 지수는 문 (b)를 통과시키는 수단이 아니라, 문 (b)가 통과된 엔진을 **매달 다시 재는 장치**다. 1회차 공개 전 최소 조건 = HANDOFF §3 3단계 통과 기준(3회 판정 동일 + must 짚음 > 31% + 런당 ≤ $0.30).

**정답 세트 한 셀의 칸**(`answers.json` 원소 — `answer-key-TEMPLATE.md:5-16`의 기대 칸을 셀 단위로 줄인 것):

| 칸 | 값 | 비고 |
|---|---|---|
| `cell` | `{spec, builder, lang}` | 사양 세트의 id 그대로 |
| `url` | 배포 주소 | 빌더가 낸 주소 그대로(`RUNBOOK.md:28` 규칙) |
| `followupsGiven` | 되물음에 준 답(사양 세트 `followupAnswers`에서 실제 쓴 것) | 의도를 바꿨으면 메모 |
| `expected` | `works` / `broken` / `broken_or_hold` | `APPS.expected`와 같은 셋(`agent-bench1-local.mjs:49`) |
| `mustFailed` | 실패한 must id 목록 + 증거(스크린샷 파일명·요청 기록 요약) | **엔진 런 전** 사람이 직접 시도해 적는다 |
| `timeDependent` | KST 자정 전후에만 보이는 결함 여부 | `APPS.timeDependent` 그대로 |
| `recordedAt`, `by` | UTC 분, 작성자 | Claude 작성 + Bae 확인 시 둘 다 |
| `after` | **실행 뒤만**: 런별 쪽·셀 상태·must 짚음 사람 대조·수정 요청 횟수·개입 여부 | 기대 칸은 건드리지 않는다 |

**조정 기록 양식**(비공개, 회차마다 1파일 — 엔진이 틀린 셀만):

| 셀 | 사람 | 엔진(3런) | 원인 분류 | 근거(증거물 id·발견 코드) | 조치 후보(일반 규칙만, 사양별 땜질 금지) |
|---|---|---|---|---|---|

원인 분류는 HANDOFF §3 2단계의 넷(H1 프롬프트 과해석 / H2 탐침 미사용 / H3 예산 잘림 / 기타). "조치 후보"가 특정 사양에만 맞는 규칙이면 적지 않는다 — `bench1-agent-local-results-2026-10-05.md:5` "수정은 전부 일반 규칙(주제별 조정 없음)" 원칙.

**발표 문턱** [제안, Q2와 묶음]: 일치율 ≥ 80%(v2 설계 §4 G1 "알려진 결함 80% 이상"과 같은 수) · 반대율 0 · 불안정 셀 ≤ 10%. 미달이면 리포트에 그 수치를 그대로 싣고 "판정 불안정" 셀을 비운 채 공개하거나(정직), 공개를 미룬다(안전). 어느 쪽인지는 1회차 비공개 실행 뒤 Bae가 정한다.

## 5. 데이터 동의·가공 (변호사 검토 전 초안)

오늘 표를 `docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §4(동의 정책 의견)에 대응시킨다. **지수용 앱(Simsa가 만든 앱)은 동의 대상이 아니다** — 이 절은 실유저 제출 앱에만 해당한다.

| 단계 | 오늘 설계 | 기존 계획(§4) | 새로 더하는 것 |
|---|---|---|---|
| 제출 | 필수 동의(검수 수행)와 선택 동의(패턴 데이터 활용) 분리. 선택 미동의여도 검수 제공 | 있음 — ⓐ 비식별 운영 메타(고지+끄기) · ⓑ 내용 데이터 대칭 opt-in, "무차별 보장 1줄"(`:172-173`). 코드: `apps/central-plane/src/workspace/training-consent-db.ts`, `training-store.ts:44,290`. ⓐ는 **고지 없이 기록 중**[확정, `:172`] → K-1·K-2 | 없음(계획대로 집행) |
| 저장 | 비밀키·환경변수 자동 마스킹, 증거 스크린샷 속 개인정보 가림, 원본 보관기한 후 자동 삭제 | 부분 — `redactSecrets`는 **사용자가 준 비밀**만(`agent-inspection.ts:528`). 철회 시 삭제 스윕은 K-3(`:176,211`). **기한 기반 자동 삭제는 없다** | ① 키 패턴 마스킹(`sk_live_`·`eyJ…`·`AKIA…` 등) ② 스크린샷 개인정보 가림(방법 [미검증]) ③ 원본 TTL(기간은 변호사 확인 뒤) |
| 가공 | "도구 × 연동 × 실패 유형" 단위로만 집계. 앱 수가 적은 칸은 비공개 | 있음 — moat-stats 닫힌 어휘(`nondev-report.ts:110-114`, `routes/admin-moat-stats.ts`), 가명정보 특례 구체 목적 문구(`:177`) | ① **연동(사양) 축** 추가 ② 소수 칸 억제 임계(예: n < 5 비공개 [제안]) — 지금 `d1-readonly-queries.mjs`는 값을 빼지만 임계는 없다 |
| 제공 | 개발자에게 집계 패턴만. 원본은 사용자가 수정을 맡길 개발자를 고를 때 그 건에 한해 공유 | **없음** — §4는 Simsa 내부 학습·통계만 다룬다 | 양면 구조(D4) 전체: 개발자 측 접근 범위·건별 공유 동의(별도 체크) · 공유 범위(리포트+증거, 원본 코드는 사용자 저장소 권한으로) · 공유 로그 |
| 국외 이전 | Cloudflare·Vercel 등 해외 인프라와 이전 국가를 처리방침에 고지 | 있음(계획) — 처리방침 변경 목록 §4 국외 이전 5항목, 리전 실측 뒤(`:178,180`) | 없음 |
| 철회 | 언제든 철회, 원본 삭제, 이미 집계된 통계는 유지됨을 고지 | 있음(계획) — 같은 화면·같은 클릭 수, K-3 삭제 스윕(`:176`). "집계 통계는 익명정보"(`:177`) | "집계는 유지" **고지 문구** 1줄(처리방침 §3) |

**변호사 확인 목록** = 기존 "반드시 확인"(`:180`, 8건) + 오늘 3건:
1. 가명정보로 통계·연구 활용 및 **유료 제공**(개발자·연구소) 가능 여부 — 기존 §4 가명정보 특례 항목의 연장(유료 제공은 새 논점).
2. 제출 앱 속 **제3자 개인정보**(앱 사용자 데이터) 처리 — 새 논점. 검수 중 노출된 제3자 데이터의 보관·삭제·수탁 여부.
3. APPI(일본)·GDPR과 충돌 없는 동의 문구 — 기존은 KR·GDPR·CCPA만(`:172,180`). **APPI는 D3 일본 확장에 따라 새로 추가**.

## 6. 포지셔닝 (리뷰 분석 236건, 2026-10-18)

- 차별점은 "고쳐 준다"가 아니라 **"원래 기획 대비 고쳐졌다는 증거 + 정해진 가격"**. "고쳐 주기" 자체는 Fiverr·크몽에 이미 저가로 있다(판매자 게시가).
- 상위 불만: 크레딧 소각 39건 · 의도 미이해 24건 · 시끄러운 리뷰 25건(개발자 집단) · 보안·RLS 19건 · 수정 루프 18건 · 결과물 없음 15건 · "다 고쳤다"에 증거 없음 8건.
- 아무도 안 주는 것 세 가지: ① 원래 약속 대비 항목별 합격/불합격 ② 스크린샷·트레이스 증거 ③ AI 재시도 비용을 고객에게 넘기지 않는 고정가.
- 반대 증거 1 — **느림**: "느려도 괜찮다"는 [미검증]. 매니지드 QA에서도 느림 불만 13건/4출처 → 처리 시간 SLA·진행 상태 공개가 필요(개선 계획 #7).
- 반대 증거 2 — **AI가 AI를 고치는 것에 대한 불신**(HN). 자동 수정을 전면에 세우지 않는다. D4(수정 주체는 밖, Simsa는 심판)와 지수(증거 공개)가 이 불신에 대한 답이다. 사람의 최종 확인을 상품에 명시한다.
- 지수와의 연결: 지수는 ①②를 공개 무대에서 매달 증명하는 장치다. ③(가격)은 이 문서 범위 밖(§0).
- 한국어 근거는 8건으로 얇다 — 한국 비개발자 인터뷰 5~10건으로 따로 검증한다(HANDOFF §5·D8 "인터뷰·파일럿").

## 7. 실행 순서 (HANDOFF 수리 다음)

각 단계는 세 칸(라이브확인/테스트만/미측정)으로 보고하고 멈춘다(`EVIDENCE-RULE.md` R2). 착수는 Bae 승인 문구로만(`index cycle 1 start approved.` 등 — RUNBOOK §5 공통 규칙).

| 단계 | 내용 | 라이브확인 | 테스트만 | 미측정 |
|---|---|---|---|---|
| 0 | HANDOFF-2026-10-18 수리 완료(3회 판정 동일 · must 짚음 > 31% · ≤ $0.30) | 프로덕션 `--repeat=3` 재측정 문서 `docs/pilot-2026-10/bench1-prod4-*.md` | H1~H3 회귀 테스트 green | — |
| 1 | 하네스 확장(§2.5 확장 8건) + 사양 세트·정답 세트 저장소 밖 작성 + 해시 등록 커밋 | `registration.md`의 해시가 첫 런 전 main에 있음(커밋 SHA) | `aggregate()` 셀 불일치 테스트(옛 코드에서 실패, R8) · `--specs`·`--out` 테스트 | 빌더 4개 × 사양 10 × KO/EN 앱 생성 시간·크레딧 |
| 2 | **1회차 비공개 실행**: 앱 생성 → 정답 세트 기록 → `--repeat=3` → 수정 요청 ≤3회 루프 | 셀별 결과 JSON 80셀(10×4×2) × 3런 = 240런, 회차 집계 1개 | — | 엔진 외 변수(빌더 쪽 장애·배포 지연)는 "측정 불가 — 이유"로 기록 |
| 3 | **정확도 측정**: 일치율·반대율·보류율·불안정률·must 짚음(키워드/사람) | 회차 집계에서 산출, 조정 기록(비공개) 작성 | — | 발표 문턱 미달 시 Q2 결정 |
| 4 | YC 숫자: "빌더별 한국 연동 실패율"(사양 2·4·6·9·10, KO) 한 표 | 3단계 산출물에서 발췌 | — | 11/2 20:00 PT 전까지. 1회차가 늦으면 **부분 셀**로 내고 셀 수를 적는다 |
| 5 | 2·3회차(월 1회, 같은 사양 세트·같은 엔진 SHA 원칙; 엔진이 바뀌면 회차 머리에 SHA 변경 명시) | 회차 집계 2개 추가 | — | 사양 세트 교체 시점 |
| 6 | **공개 발표**(3개월 시계열): 영문 리포트 생성기 → `docs/index/<YYYY-MM>/report.en.md` 3편 + 공개 사양 샘플 | 공개 URL에서 리포트 내용 확인(상태코드 아님, R3) | 리포트 생성기 가림 테스트 | 반응(유입·인용) |
| 7 | **일본 사양 세트 추가**: 한국 연동 쌍(2·4·6·9·10)의 일본 대응(LINE 로그인·일본 결제·일본 지도·APPI 동의·일본어 검색/정렬 [추정]) + JA 프롬프트 + `locale` ja [미확인: 엔진 언어 지원] | 일본 사양 5개 정답 세트 해시 등록 | H1 사후 검사가 한국어·영어 문장 규칙(`bench1-prod3-diagnosis-2026-10-06.md` §4) → 일본어 규칙 테스트 | 일본 빌더 사용 환경·결제 테스트 키 |

비용 어림 [추정]: 2단계 240런 × $0.30(H3 목표) ≈ $72/회차(검수만). 빌더 생성·수정 크레딧과 사람 시간(앱 80개 생성 + 정답지 80셀)은 미측정이며 **이쪽이 병목**이다 → Q5. 하루 한도(검수 10회/userKey/UTC일, `apps/central-plane/src/workspace/beta-limits.ts:15,79` — RUNBOOK §1-4가 인용한 `:66,68`은 줄이 밀렸다)가 장비 키(`SIMSA_STAFF_USER_KEY`, `agent-bench1.mjs:10`)에도 적용되는지 [미확인] — staff 티어는 agent 일일 예산 차단은 건너뛰지만(`workspace-visual-check-runs.ts:657-669`) userKey 횟수 한도의 예외는 이 세션에서 못 봤다. 적용되면 240런은 24일이 걸리므로 1단계에서 확인한다(10-06 프로덕션 3차는 6앱 × 1런이라 걸리지 않았다).

**단계 보고 양식** — HANDOFF §6 양식에 지수 숫자를 더한다:

```
[지수 단계 n] 결과 한 줄
- 라이브확인: …
- 테스트만: …
- 미측정: …
숫자: 셀 n/80 · pass n · fail n · hold n · unstable n · n/a n · 일치율 n% · 반대 n · 런 비용 $n(costByModel)
해시: specs <sha7…> · answers <sha7…> · engine <sha7>
다음 단계 전 Bae 결정 필요: … (없으면 "없음")
```

## 8. 열린 질문 (Bae 결정 필요, 6개)

| # | 질문 | 선택지 | 이 문서의 제안 |
|---|---|---|---|
| Q1 | 사전 등록을 **main 머지**(RUNBOOK §1-2, 공개) 대신 **해시 커밋**(§3)으로 바꿔도 되는가 | 해시 / 머지(=정답 공개) / 외부 공증 | 해시. RUNBOOK §4·§5는 그대로, 지수는 이 문서로 등록 |
| Q2 | 1회차 엔진 = HANDOFF 수리 뒤 **v1(agent)** 인가, **v2**(설계 LOCKED, 구현 상태 [미확인])인가. 회차 중 엔진이 바뀌면 시계열 비교가 깨진다 | v1 고정 3회차 / v2 완성 뒤 시작 / v1 시작 + v2 전환 시 과거 회차 재채점 | v1으로 시작, 전환 시 재채점(엔진 SHA 공개 + 두 값 병기) |
| Q3 | 공개 사양 샘플 = 어느 것, 공개 장소 = 어디 | 공통 7·8 / 글로벌 1·3·5 / 없음 · 저장소 `docs/index/` / 랜딩 / 외부 | 공통 7·8 두 개, 장소는 `docs/index/`(이미 공개 저장소) |
| Q4 | 오픈소스 범위·시점: FSL-1.1 유지(소스 공개, 상용 제한) vs 엔진 폴더 Apache/MIT 즉시 vs 회차 N 뒤. "head start"의 측정 가능한 정의. 그리고 D4(수정 주체 밖)와 strategy §6(Simsa가 고쳐서 유료)의 관계 | — | FSL 유지 + 3회차 공개 뒤 재검토. §6과의 관계는 가격 결정 시점(엔진 실측 통과 후, strategy 머리)에 함께 |
| Q5 | 1회차 규모: 10사양 × 4빌더 × KO/EN = 앱 80개를 사람이 생성한다. 11/2 전 가능한가 | 전량 / KO만 40개 먼저(EN은 2회차) / 사양 5개(한국 쌍)만 | YC 숫자가 "한국 연동 실패율"이므로 **한국 사양(2·4·6·9·10) × 4빌더 × KO/EN = 40개** 먼저, 나머지는 2회차 |
| Q6 | 이미 공개된 파일럿 정답지 6건(`docs/pilot-2026-10/answer-key-*.md`)과 로컬 결과 run1~4 JSON(앱 주소 포함)을 그대로 두는가 | 유지(이력) / 이동(이력 삭제는 불가 — git) | 유지. 이미 공개된 것은 비공개로 돌릴 수 없다. 지수 세트부터 §3 규칙 적용 |
