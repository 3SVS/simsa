> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 52 — 베타 피드백 수집 템플릿

베타 테스터 1명당 1부 작성. 일관된 비교를 위해 항목/척도를 고정.

> 사용법: 이 파일을 복사해 테스터별로 채우거나, 동일 항목으로 폼(Google Form 등)을 만든다.

---

## 1. Tester profile (테스터 정보)
- 이름/식별자:
- 역할: (개발자 / PM / 디자이너 / 기타)
- AI로 PR/코드 만든 경험: (많음 / 보통 / 적음)
- GitHub PR 리뷰 경험: (많음 / 보통 / 적음)

## 2. Test environment (테스트 환경)
- 일시:
- dashboard URL:
- 브라우저 / OS:
- 사용한 repo / PR:
- central-plane healthz 200 확인: (예 / 아니오)

## 3. Task completion (과제 완료) — 시나리오 6과제
각 과제: 완료(O) / 도움받아 완료(△) / 실패(X) + 체감 난이도(1쉬움~5어려움)

| 과제 | 완료 | 난이도 | 비고 |
|------|------|--------|------|
| 1. 확인 결과 이해 | | | |
| 2. 남은 문제 찾기 | | | |
| 3. Fix Pack 생성 | | | |
| 4. 다시 확인 | | | |
| 5. 이전과 비교 | | | |
| 6. PR comment 공유 | | | |

## 4. Confusing moments (헷갈린 지점)
- 어디서 / 무엇을 / 왜 헷갈렸나:
- 잘못 이해한 버튼/문구:

## 5. Trust / confidence (신뢰)
- 확인 결과(통과/안 맞음/확인 부족/결정 필요)를 믿을 수 있었나? (1불신~5신뢰):
- 근거(왜 그 상태인지)가 충분했나?:
- 비교(이전→현재)가 정확하다고 느꼈나?:

## 6. Missing information (빠진 정보)
- 기대했는데 없던 정보/화면:

## 7. UX friction (마찰)
- 클릭이 많거나 느리거나 막힌 곳:
- 로딩/에러 경험:

## 8. Would you use this again? (재사용 의향)
- 다시 쓸 의향 (1~5):
- 어떤 상황에서 쓰겠는가:
- 한 줄 추천평 / 비추천 이유:

## 9. Severity rating (테스터가 느낀 심각도)
발견 이슈를 등급으로 (기준: `stage-52-issue-triage-criteria.md`)
- P0(진행 불가):
- P1(핵심 작업 실패):
- P2(혼란/마찰):
- P3(문구/제안):

## 10. Raw notes (자유 메모)
-

---

### (Optional English mirror — short)
- Profile / Env / Task completion (O/△/X + difficulty 1-5)
- Confusing moments · Trust (1-5) · Missing info · Friction
- Reuse intent (1-5) · Severity (P0-P3) · Raw notes
