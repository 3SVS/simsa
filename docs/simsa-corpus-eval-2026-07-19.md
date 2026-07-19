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

## E-corpus-1 4차까지 실패 — 라이브 디버깅 트레인으로 확정 (2026-07-20)

| 시도 | 방법 | F7 결과 |
|---|---|---|
| #412 | 소프트 예산 + 스텝 가드 | 247s 실패 |
| #414 | goto/collect 가드 + setDefaultTimeout 예산화 | 247s 실패 |
| #416 | killTimer + context.close() 강제종료 + always-return catch | 247s 실패 |
| #418 | killTimer + **browser.close()** 프로세스 강제종료 | 247s 실패 |

**판정**: 브라우저 프로세스 강제 종료로도 hang이 안 깨진다. 추측 기반 수정의
한계 — **hang 지점을 컨테이너 로그(`wrangler tail` 중 F7 검수)로 직접 봐야** 확정.
미확정 변수: (a) 컨테이너 롤아웃이 실제로 반영 안 됐을 가능성(오늘 central 다회
배포로 롤아웃 밀림 의심) (b) hang 지점이 예상과 다른 곳. **계속 재실측은 크레딧
낭비 → 다음 세션에 tail 켠 채 hang 지점 특정 후 수정.**

정확성 회귀 없음(오판 0, works=null 유지) — 커버리지 한계일 뿐. 다음 스텝:
①wrangler tail로 F7 검수의 마지막 로그 라인 = hang 직전 작업 특정 ②롤아웃 반영
여부부터 확인(내 강화 로그가 찍히는지).

## 근본 원인 확정 — 5·6차 라이브 계측 (2026-07-20)

관측 경로부터 실측으로 바로잡았다:

1. **`wrangler tail`은 컨테이너 stdout을 포함하지 않는다** (Worker/DO 로그만).
   "tail로 hang 지점 특정" 계획은 CF Containers에선 성립 불가 → 위상 로그를
   실패 콜백 error에 실어 report_json으로 회수하는 **in-band 트레이스**(#423)로
   전환. RUNNER_REV 마커가 롤아웃 반영도 in-band로 검증한다.
2. 로컬 대조 실험(`heavy-hang-repro.mjs`): 로컬에선 동일 조건(heavy-site+
   recordVideo+$$eval 부하)에서 browser.close()가 0.1s에 resolve — killTimer
   설계 자체는 유효, hang은 컨테이너 환경 특이(0.25 vCPU).

6차 실행의 트레이스 (`ec1-dbg2`):

```
+0.0s runner-rev=ec1-dbg2 budgetMs=200000 | ... | +50.4s step:3/3 observe done
| +50.4s finally:context.close start   ← 마지막 라인, 이후 190s 침묵 → 240s rail
```

**진범 = finally의 `context.close()`** — 검수 자체는 +50s에 정상 완료됐고,
recordVideo 파이널라이즈가 0.25 vCPU + 무거운 애니메이션 페이지에서 영영 안
풀린다. 결정적으로 이전 코드는 close 전에 `clearTimeout(killTimer)`를 먼저
실행해 유일한 구조 수단까지 해제했다. #412~#418 4차 트레인이 전부 빗나간
이유 = "검수 중 hang" 가정(실제는 "종료 중 hang").

**수정(ec1-fix1)**: finally의 context.close/browser.close와 video path 대기를
전부 타임아웃 레이스(`raceOrNull` 15s/10s/5s)로 감싸 리포트 반환을 어떤 정리
작업의 볼모로도 잡지 않는다. killTimer 해제는 close 시도 이후로 이동. 못 죽인
Chromium은 per-run 컨테이너 sleepAfter와 함께 죽는다(원래 계약).

## E-corpus-1 종결 — ec1-fix1 배포 후 실증 (2026-07-20, #424)

| 대상 | 이전(1~6차) | ec1-fix1 후 |
|---|---|---|
| F7 /heavy-site | **failed 247s 빈손** ×6 | **done** — UAR 정상 리포트 반환 |
| F1 /working-todo | done·works=null·UAR (7/18 기준선) | 완전 동일 — **무회귀** |

- 빈손 4분 타임아웃 클래스 소멸. 오판 0 원칙 그대로(works=null·UAR).
- 운영 실사이트(ssf2026/3svs)는 코퍼스 제외 유지(Bae 2026-07-19) — 검증은
  제 소유 픽스처 F7로 종결.
- 잔여 형제 이슈: **E-corpus-2**(위치권한 팝업, golf-now류)는 별도 트레인.
