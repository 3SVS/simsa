# 외부 기준 대응표 v1 — Simsa 실패 라벨 ↔ ISO/IEC 25010 · SWE-WebDevBench · App-Bench (2026-11-15)

결정: `docs/simsa-direction-amendment-2026-11-15.md` **D14 [PILOT]** — 우리 분류는 그대로 두고 **대응만** 한다. 대응 규칙은 v1 뒤 조정 가능하지만, 공개 산출물에 쓴 뒤에는 바꾸지 않는다.
우리 쪽 어휘 정본: `apps/central-plane/src/dataset/labels.ts`(C 원인 층 · Y 증상 · H2 확인 불가 사유), 엔진 결함 분류 → 원인 층 매핑은 `dataset/machine-candidates.ts` `CAUSE_LAYER`.

**[정정 2026-11-15]** 수정안 D14·D15에는 "ISO/IEC 25059"라고 적었다. 그런데 25059는 **AI 시스템 자체**의 품질 모델(25010 확장)이다. Simsa가 평가하는 것은 **AI가 만든 일반 웹앱**이므로 기준 축은 **ISO/IEC 25010:2023**(제품 품질 모델)이 맞다. 25059는 앱 안에 AI 기능이 들어 있을 때만 보조로 쓴다(SWE-WebDevBench의 AIA 지표와 같은 자리). 측정 방법 용어는 ISO/IEC 25023을 따른다.

외부 원문 확인 수준:
- SWE-WebDevBench: `benchmark/rubrics/primary-metrics.yaml`(6그룹 25지표)과 `benchmark/canaries/canary-taxonomy.md`를 원문으로 읽었다. 저장소에는 **라이선스 파일이 없다**(GitHub API 404, 2026-11-15).
- App-Bench: 블로그의 실패 유형 4개 제목만 확인했다(정의 표 없음).
- ISO 25010:2023: 특성과 하위 특성 이름만 쓴다. 규격 본문은 유료라 인용하지 않는다.

## 1. 원인 층(C) ↔ 외부 분류

| Simsa C (원인 층) | 엔진 결함 분류(예) | ISO/IEC 25010:2023 | SWE-WebDevBench | App-Bench 실패 유형 |
|---|---|---|---|---|
| `backend_missing` | missing_backend_config · not_shared_across_users | 기능 적합성 › 기능 정확성 / 신뢰성 › 가용성 | G3 Core Integration(CIS) · 발견 "frontend-backend decoupling" | Runtime Errors and API Misuse |
| `browser_only_storage` | client_only_storage | 기능 적합성 › 기능 완전성(공유·저장 요구 미충족) · 신뢰성 › 무결함성 | G2 Schema Design(SDS) · G4 Concurrency(CLS) · 발견 "frontend-backend decoupling" | **Multi-Role Flow Breakdowns** |
| `client_state` | data_not_persisted · runtime_error | 신뢰성 › 무결함성 | G2 Frontend Engineering(FES) | Runtime Errors and API Misuse |
| `ui` | broken_action | 상호작용 능력 › 조작성 | G2 FES | UI/UX Glitches |
| `auth` | auth_gate | 보안 › 기밀성·진정성 | G3 CIS(auth) · G4 Security(SS) | Multi-Role Flow Breakdowns |
| `external_integration` | needs_api_key | 호환성 › 상호운용성 | G3 External Service Reliability(ESR) | Runtime Errors and API Misuse |
| `timezone` | timezone_date | 기능 적합성 › 기능 정확성 | 카나리 O형(날짜 형식·지역 규칙) | Missing or Misimplemented Features |
| `encoding_locale` | wrong_language | 상호작용 능력 › 포용성 | 카나리 O형(통화·날짜 표기) | UI/UX Glitches |
| `routing_deploy` | route_404_missing_index | 신뢰성 › 가용성 | G6 SEO & Web Standards(SWS) 일부 · 발견 "production-readiness cliff" | Runtime Errors and API Misuse |
| `spec_not_implemented` | canned_result · intent_mismatch | 기능 적합성 › 기능 완전성 · 기능 적절성 | G1 Business Intent Fidelity(BIF) · Feature Completeness(FCS) · 발견 "specification bottleneck" | **Missing or Misimplemented Features** |
| `unknown` | — | — | — | — |

## 2. 증상(Y) 가운데 외부와 이름이 겹치는 것

| Simsa Y | 외부 대응 |
|---|---|
| `fake_result` (껍데기 — 입력과 무관한 고정 결과) | 외부에 전용 범주가 없다. SWE-WebDevBench는 "silent failures invisible to non-technical users"를 카나리로 잡는다고 적었다 → **D13 대표 지표의 차별점**이다 |
| `not_visible_to_others` | App-Bench "Multi-Role Flow Breakdowns" |
| `secret_exposed` | 25010 보안 › 기밀성 · SWE-WebDevBench G4 SS |
| `wrong_date_time` · `broken_text` | 카나리 O형(지역·문화 규칙) |

## 3. 우리 기준(AC) ↔ 카나리 개념

SWE-WebDevBench 카나리는 4종이다: O(프롬프트에 명시) · N(수정 단계에서 새로 추가) · S(수정 뒤에도 유지돼야 함) · X(일부러 넣은 모순).
- 미용실 벤치 A8 "15,000원" 형식과 A10 "모든 글 한국어"는 **O형 카나리**와 같은 성격이다(지역 규칙). 한국어·지역 카나리는 외부 벤치마크에 없는 축이다(D12 현장 데이터 축과 일치).
- G4 고리(재검사)의 "고친 뒤에도 기존 기준 유지"는 **S형**에 대응한다.
- **X형(모순 요구 감지)은 우리에게 대응 항목이 없다** → v2 대응표의 빈칸이다. 이건 기획 단계(prep)의 일이지 검사 엔진의 일은 아니다.

## 4. 대응하지 않는 것 (범위 밖)

- SWE-WebDevBench G2(코드 품질 — 정규화·명명·구조), G5(수정 비용 시간), G6 일부(Lead & Growth)는 다루지 않는다. Simsa는 **배포된 앱의 동작**만 판정하고 코드 품질은 채점하지 않는다(D13).
- 보안 점수(OWASP)는 `secret_exposed` 같은 증상으로만 기록한다. 대표 지표에는 넣지 않는다(D13).

## 5. 다음 (v2 후보)

- 25023 측정 방법 이름(예: 기능 정확성 측정)을 지표 정의(index-design §2.2)에 대응시킨다.
- App-Bench 프롬프트를 G3 주제로 쓰게 되면, 그 기준 151항목을 우리 C/Y에 대응시킨 표를 사전 등록한다. 외부 기준 원문 재배포는 허락을 받기 전엔 하지 않는다.
