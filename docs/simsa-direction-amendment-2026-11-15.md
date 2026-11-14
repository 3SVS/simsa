# Simsa 방향 수정안 — 외부 동향 반영 (2026-11-15, D12·D13 LOCKED · D14 PILOT · D15 OPEN)

상태: **발효.** `design lock approved` (Bae 2026-11-15) — D12·D13 [LOCKED] · D14 [PILOT] · D15 [OPEN]. 방향 동의("이 방향으로 가는 게 맞아")는 그 앞에 받았다.
고치는 문서: `docs/simsa-strategy-2026-10-05.md` §7(데이터를 만드는 길)·로드맵 ②.5, `docs/simsa-index-design-2026-10-18.md` §1(결정 표에 D12~D15 추가).
고치지 않는 것: D1(중립 심판·현장 데이터 해자)·D9(집계 패턴 판매)·D10·D11. 이 수정안은 D1을 **재확인**하고, ②.5의 우선순위만 바꾼다.

## 0. 왜 지금 바꾸나 — 외부 사실 (2026-11-15 조사, 출처는 §4)

| 사실 | 확인 수준 | 의미 |
|---|---|---|
| AfterQuery(App-Bench)·Deccan·Mercor·SWE-WebDevBench(arXiv 2605.04637)가 **같은 프롬프트 × 여러 빌더** 실패 데이터를 이미 만든다. AfterQuery·Mercor·Deccan은 AI 회사에 학습·평가 데이터를 파는 회사다 | 논문·공식 페이지 | 전략 §7의 "통제 벤치마크 직접 생산(300셀)"은 **우리만의 데이터가 아니다.** 셀 수로 경쟁하면 데이터 회사에 진다 |
| 공개된 것은 프롬프트·채점 기준뿐. App-Bench는 앱·항목별 판정 미공개, 라이선스 표시 없음 | HF 페이지 확인 | 외부 기준을 **문서로는** 쓸 수 있지만, 정답지는 우리가 만들어야 한다. 공개 전엔 사용 허락 필요 |
| 빌더 내장 테스트(Lovable 브라우저 테스트·Base44 테스트 에이전트·Replit Agent)는 **미리보기·샌드박스·1인·빈 데이터**만 본다(공식 문서에 한계 명시) | 공식 문서 | Simsa 자리 = **게시된 주소 · 여러 사용자 · 저장 · 껍데기(Potemkin)**. 미용실 벤치의 must 실패(A3 다른 손님·A6 사장님 화면)가 정확히 이 영역 |
| SWE-WebDevBench: 화면은 되는데 백엔드 0%, 주장-실제 차이 35.7% | 논문 초록 | 껍데기 가설의 외부 확인 — 우리 분류를 맞춰 두면 인용·비교 가능 |
| 보안 업체들이 "바이브코딩 앱 98% 결함" 류 통계를 무료로 뿌린다 | 업체 블로그 | 보안 실패율을 대표 지표로 삼으면 차별성이 없다 |
| 한국 AI 기본법 체계(2026-01 시행, 07 시행령)·TTA·KSA 인증은 "AI 시스템" 평가다. **"AI가 만든 소프트웨어" 품질 평가 제도는 없다** | 보도·찾지 못함 | 국가 기준 자리는 비어 있다(D1의 장기 목표와 일치) |

## 1. 결정

| # | 결정 | 상태(제안) | 근거·영향 |
|---|---|---|---|
| D12 | **해자 데이터 = 실사용자가 실제로 배포한 앱에서 나온 현장 실패 데이터(한국어·지역 축).** 통제 벤치마크의 역할은 "데이터 생산 주력"에서 **"심판 정확도 교정 + 외부 비교 + 공개 지수 회차"** 로 내린다 | [LOCKED 2026-11-15] | D1 재확인. 전략 §7 "유저 없이 데이터를 만드는 길(우선)" 문장을 이것으로 대체. 통제 셀 대량 생산(300셀 $3~5K)은 보류 |
| D13 | **기본 판정 축 = 빌더 내장 테스트가 못 보는 것**: 게시된 실제 주소 · 여러 사용자(다른 브라우저) · 새로고침·다른 기기 저장 · 껍데기(입력 무관 고정 결과·클라이언트 전용 저장·백엔드 설정 누락). 대표 공개 지표는 보안이 아니라 **"실제로 작동하는가"** | [LOCKED 2026-11-15] | 원칙만 잠근다. 어느 축을 몇 개 기준으로 넣는지는 파라미터(잠그지 않음) |
| D14 | **외부 기준 정렬**: Simsa 결함 원인 분류를 SWE-WebDevBench 4유형 · App-Bench 4유형 · ISO/IEC 25059/25023 품질 특성에 **대응표**로 연결한다(우리 분류는 그대로, 대응만). 외부 프롬프트·기준은 내부 교정용으로만 쓰고, 공개 산출물에 넣기 전 사용 허락을 받는다 | [PILOT 2026-11-15] | 대응표 v1은 문서 작업(비용 0). 대응 규칙은 v1 뒤 조정 가능, 공개 뒤 변경 금지 |
| D15 | **국가 기준 경로**: ISO/IEC 25059 용어로 정렬한 평가 기준을 TTA 단체표준으로 제안하는 길을 로드맵 ④ 이후 후보로 둔다 | [OPEN 2026-11-15] | 재검토 트리거: G2 합격 + 외부 데이터 구매 의향 1곳 이상(③). D10(소유권 이전 조건 거부)은 그대로 적용 |

## 2. 로드맵 변경 (전략 §10)

| 단계 | 기존 | 수정안 |
|---|---|---|
| ② | G1 13앱 · G2 · G3 새 주제 · G4 | G1 **12앱 1회**(v0 파일럿 주소 소멸) → 원가 트레인(정확도 유지 확인) → G2 · G3 · G4. G3 주제 후보 = App-Bench 공개 프롬프트·기준(직접 생성, 정답지 직접 작성, 내부용) |
| ②.5 | 통제 벤치마크 자체 생산 + 공개(우선) | **②.5a** 외부 기준 대응표(D14) · **②.5b** 소규모 통제 벤치마크 = 공개 지수 회차·정확도 교정용 · **②.5c** 현장 데이터 유입 경로 설계(⑤ 무료 공개를 앞당길지 검토) |
| 빌더 목록 | Lovable·Bolt·v0·Replit·ChatGPT·Claude·Gemini | Firebase Studio 제외(2027-03 종료 발표), **Google AI Studio Build · ChatGPT Sites** 추가 검토 |

원가 트레인(별도 승인 `train cost start approved`): ① 프롬프트 캐시 구조 + 오래된 화면 지우기 ② 강한 모델 교체 후보(gpt-6.1-sol $2/$10) ③ 조작 단계 저가 모델 분리 ④ 라벨링 Batch. **단계마다 G1 기준선과 같은 12앱으로 재측정**, 짚음·반대 판정이 기준선보다 나빠지면 그 단계는 되돌린다.

## 3. 게이트 레지스트리

| 게이트 | 문구 | 상태 |
|---|---|---|
| 방향 동의 | "이 방향으로 가는 게 맞아" | 2026-11-15 수신 (발효 아님) |
| D12~D14 잠금 | `design lock approved` | **발효 2026-11-15** (Bae) |
| 원가 트레인 착수 | `train cost start approved` | 대기 (G1 기준선 뒤) |

## 4. 출처 (조사 2026-11-15, 일부는 2차 출처 — 표에 수준 표시)

- SWE-WebDevBench: https://arxiv.org/abs/2605.04637 · https://github.com/snowmountainAi/webdevbench
- App-Bench: https://appbench-ai.pages.dev/ · https://huggingface.co/datasets/AfterQuery/App-Bench (프롬프트 6·기준 151, 앱·판정 미공개, 라이선스 표시 없음)
- Deccan WebApp 연구: https://www.deccan.ai/research/webapp-study-evaluating-ai-native-web-application-builders
- Mercor SWE-Marathon-Ext: https://www.mercor.com/blog/swe-marathon-ext-can-ai-build-a-whole-saas-product/
- Lovable 브라우저 테스트 한계: https://docs.lovable.dev/features/browser-testing
- Base44 테스트 에이전트 한계: https://docs.base44.com/documentation/managing-app-data/testing-agent
- Replit 앱 테스트: https://docs.replit.com/replitai/app-testing
- AI 기본법 시행: https://www.ddaily.co.kr/page/view/2026012112024216108 · 확인제: https://www.ddaily.co.kr/page/view/2026071414510894297
- 모델 단가: https://developers.openai.com/api/docs/pricing · https://platform.claude.com/docs/en/about-claude/pricing (2026-11-15 조회)
