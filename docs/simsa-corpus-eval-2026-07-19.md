# 실유저 코퍼스 검수 실측 — Bae 포트폴리오 4앱 (2026-07-19)

백로그 "실유저 코퍼스 검수 재실증" 1차 실행. 픽스처가 아닌, 실제로 만들어 배포된
앱 4종에 프로덕션 Simsa 검수를 익명 API로 직접 실행했다(`tools/simsa-inspection-
fixtures/corpus-run.mjs`). 채점 기준은 픽스처 이벨과 동일: 작동하는 실앱을
false(작동 안 함)로 오판하지 않으면 통과(자동 검수 상한=UAR).

## 결과

| # | 앱 | 결과 | 상세 |
|---|---|---|---|
| C1 | golf-now (개인 유틸) | ✅ not-false | Needs Clarification — "무엇을 눌러 시작해야 할지 못 찾음" = 알려진 위치권한 팝업 갭과 일치 |
| C2 | ssf2026.com (행사) | ⚠ run 실패 | **~247s에 컨테이너 월클록 킬** (판정 오염 없음 — Not Verified·works=null) |
| C3 | www.kisf.kr (행사) | ✅ not-false | Needs Clarification — 실사이트 콘솔 오류를 정보성으로 정확 보고 |
| C4 | www.3svs.com (회사) | ⚠ run 실패 | C2와 동일 패턴(~247s) — 무거운 마케팅 사이트 클래스 |
| — | C2 재시도 | ⚠ 디스패치 불가 | 직전 장기 실패 런들의 인스턴스 점유 → max_instances 포화(알려진 쿨다운 패턴) |

## 판정

- **오판(false) 0건** — 실패한 런조차 "작동 안 함"을 날조하지 않고 Not Verified로
  정직하게 남음. 신호/잡음 원칙 관점의 회귀 없음.
- **발견된 실전 한계 2건** (오탐이 아니라 용량/견고성):
  - **E-corpus-1 (P1)**: 무겁고 애니메이션 많은 마케팅 사이트에서 러너가 4분 월클록에
    걸림(2/4). 후보 대응: networkidle 대신 domcontentloaded+고정 대기, 스텝별 잔여
    시간 예산, **월클록 임박 시 부분 증거로 조기 종료·부분 리포트 반환**(빈손 실패
    금지). 실패 시 사용자 문구도 "사이트가 커서 이번엔 다 못 봤어요" 수준으로 정직화.
  - **E-corpus-2 (기존)**: 위치권한 팝업 처리(golf-now) — 권한 프롬프트 자동 거부/
    우회 후 플로우 지속.
- 다음 실행: E-corpus-1 처리 후 동일 4종 재실측(+ 대상 확대).

## E-corpus-1 강화 시도 결과 (2차, 2026-07-19)

- 1차(#412 소프트 예산): ssf2026/3svs 여전히 247s 빈손 실패.
- 2차(#414 goto/collect 가드 + setDefaultTimeout 예산화): **제 소유 무거운 픽스처
  F7(/heavy-site, 400셀+200 애니메이션, 실제 저장 todo=작동함)에서도 247s 실패.**
- **판정: 가드 방식으로는 근본 해결 불가.** 개별 Playwright 작업(innerText·$$eval·
  screenshot·waitForTimeout)이 예산 체크 지점 사이에서 오래 걸리고 일부는
  setDefaultTimeout이 안 먹는 계열이라 예산 가드를 우회 → hard 4분 레일 도달.

### E-corpus-1 → 러너 예산 아키텍처(별도 설계 트레인)로 승격

근본 해법 = 러너를 **AbortController 기반**으로 재작성: deadline에 signal.abort()로
진행 중 작업을 즉시 취소하고, try/catch로 지금까지 모은 evidence로 부분 리포트를
반환. 또는 server.mjs의 withTimeout이 reject할 때 runInspection이 노출한 부분
evidence로 리포트를 만들게 하는 구조. 이는 컨테이너 라이브 디버깅 + 러너 상당
리팩터라 설계 문서 선행이 맞다.

### 정확성은 회귀 없음 (핵심)

무거운 사이트 2/4 + F7은 **커버리지 한계**(다 못 봄)이지 **정확성 결함**(오판)이
아니다. 실패해도 works=null(Not Verified) — 작동하는 앱을 false로 오판한 사례 0건.
운영 실사이트는 검수 코퍼스에서 제외(Bae 2026-07-19, 문의 폼 등 데이터성 액션
가능성 때문). 코퍼스는 픽스처 F1~F7로만.
