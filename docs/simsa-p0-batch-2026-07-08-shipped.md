# Simsa P0 배치 — 2026-07-08 (남은 P0 5건 작업 기록)

> 핸드오프 #301(`docs/simsa-p0-handoff-2026-07-08.md`)을 받은 fresh 세션의 결과.
> 내일 Langfuse 배선 세션은 이 문서를 컨텍스트로 시작.

## 상태 한 줄

남은 P0 5건 전부 **구현·검증 완료, PR 3개로 분리** — 머지·배포는 자기 승인 금지
룰에 따라 **사람 확인 대기** (#302 · #303 · #304).

## PR별 내용

| PR | 그룹 | P0 항목 | 상태 |
|---|---|---|---|
| **#302** | A | `conclave-*-pack` → `simsa-*-pack` rename (B0-6) + 빌더팩 README 정직화 (B0-3, "한 번에 알아서 끝냅니다" 폐기 + "보장하지 않는 것" 섹션) | 구현·검증 완료, **원격 CI green** |
| **#303** | B | verify-against-user-words 게이트 (`workspace/verify-spec.ts`, mock/LLM 공통, 60% coverage, 실패 시 누락 단어 명명 경고) + C2 답 → productSpec 병합 (`lib/spec-decisions.mjs`, decisions에 "질문 — 답" upsert·openQuestions 제거·서버 동기화) | 구현·검증 완료, CI 확인 후 머지 |
| **#304** | C | stage-*.md 180개 + HANDOFF 4개 상단 SUPERSEDED 승계 배너 (ARCHITECTURE/CLAUDE 배너는 #297 소유) | 구현·검증 완료, CI 확인 후 머지 |

앞서 이미 shipped: **#300** (시크릿 번들 누출, 머지·배포 라이브). 열림(배치 대기,
이 배치 밖): #295~299, #301.

## 실행한 검증 (각 PR description에 상세 체크리스트)

- **팩 아티팩트 실물 검증**: dist에서 실제 팩 생성 → 10개 파일 전부 `simsa-build-pack/`,
  path+content `grep -i conclave` 0건, README 정직 카피 육안 확인.
- **게이트 시나리오**: "리뷰를 요약해줘" → 회의록 앱 날조 차단(generic 초안으로 강등) ·
  "회의 내용을 요약해서 할 일을 linear로 보내는 앱" → 회의록 초안 정상 통과 ·
  "linear에 보내는 앱" → 통과(사용자가 linear 명시) · 실패 시 누락 단어 명명(침묵 금지).
  전부 테스트로 pin.
- **C2 실물 검증**: `applyResolvedDecision` → `generateBuilderPack` 체인으로 export 팩
  `product.md`의 "결정된 사항"에 답 등장 + 미결정 섹션 제거 확인.
- 테스트: central-plane **1652** pass · dashboard **514** pass · pre-push `pnpm verify` 통과 × 3회.

## 머지·배포 순서 (사람 실행)

1. 각 PR 원격 CI green 확인 → **#302 → #303 → #304** 순서로 머지 (#304는 #297과
   같은 배치 권장 — 배너 링크 대상인 감사 v2 문서가 #297에 있음).
2. central-plane 먼저: `gh workflow run deploy-central-plane.yml --ref main -f confirm=deploy`
   (또는 `apps/central-plane`에서 `pnpm ship`).
3. 5분 스모크: 프로덕션 generate에 "리뷰를 요약해줘" → 회의록 앱 안 나옴 확인(LLM 경로
   게이트) · export 팩 파일명 `simsa-build-pack.zip` 확인.
4. dashboard: main 머지분 Vercel 배포 (`npx vercel --prod --yes`).
5. 문제 시 PR 단위 revert.

## 남은 것 / 내일

- **Langfuse 배선 = 내일 첫 작업** (P0 fix 효과 측정. 감사 v2 §0.5 — 현재 관측 0건).
- P1 prompt caching (`anthropic-fetch.ts`, `cache_control`) — P0 배포 완료 후.
- LLM 경로(키 있는 프로덕션) 게이트 스모크 — 배포 후 확인 항목.
- 정체성 포크 재구현(축 B Worker-native)은 Q1 트랙, 네이밍·봇 이관 frozen — non-goal 유지.
