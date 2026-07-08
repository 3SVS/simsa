# Simsa P0 핸드오프 — 2026-07-08 (새 세션 첫 프롬프트용)

> 이 문서를 **새 세션의 첫 프롬프트에 그대로 붙여넣으세요.** 이전 세션이 감사·rename·
> P0로 컨텍스트가 축적돼(Stage 84 파일명 miss와 같은 조건) 여기서 끊고 fresh 판단으로
> 남은 P0를 처리하기 위한 핸드오프입니다. **먼저 감사 v2를 fresh 눈으로 읽고 각 P0를
> 처음부터 재검토**하세요(이전 세션 편향 없이).

## 0. 새 세션이 가장 먼저 할 일
1. `docs/simsa-research-audit-2026-07.md` 읽기 — **v2**(상단 "변경 이력" + §0.5 필독).
2. 이 핸드오프의 P0 목록·그룹·검증 체크리스트 확인.
3. 그룹 A부터 착수(파일 스코프가 다른 P0와 겹쳐 순서 중요).

## 1. 현재 상태 (2026-07-08)
- **main HEAD:** `e033314` (= #300 머지 후). 브랜치: 각 작업은 **base=main 독립 PR**.
- **PR 현황:**
  | PR | 내용 | 상태 |
  |---|---|---|
  | **#300** | P0-security: `.env.local` 시크릿이 복사/MD번들에 (회귀테스트 동봉) | **MERGED + 배포 라이브** |
  | #299 | P0-honesty: 로그인 벽 → "확인 못 함"(실패 아님) | OPEN (central-plane) |
  | #298 | P0-honesty: "요약/linear" 날조 트리거 좁힘 | OPEN (central-plane) |
  | #297 | 종합 연구·전수조사 **v2** + 승계 배너(ARCHITECTURE/CLAUDE) + v1→v2 changelog | OPEN (docs) |
  | #296 | 온보딩·실현가능성 설계 | OPEN (docs) |
  | #295 | 플로우: 사이드바에 새 프로젝트 표시 + dead-end 출구 | OPEN (dashboard) |
- **배포:** #300만 dashboard 배포됨. **#298/#299는 central-plane이라 미배포**(머지 후
  `deploy-central-plane.yml` 또는 `pnpm ship` 필요). #295는 dashboard(머지→Vercel).
- **내일~48h 배치:** #295~299 묶어서 머지·배포(이 핸드오프 범위 밖, 배님 판단).

## 2. 남은 P0 5건 (우선순위 · 파일 스코프)
> **파일명 rename을 가장 먼저** — 다른 P0가 같은 파일(export.ts 등)을 만짐. 순서 지킬 것.

1. **[P0-clarity] `conclave-build-pack` → Simsa 브랜드 rename** *(가장 먼저)*
   - `apps/central-plane/src/workspace/export.ts` — 폴더 prefix `conclave-build-pack/`(885~918행 다수), README 타이틀 "만들기 패키지".
   - `apps/dashboard/src/lib/zip-utils.ts:29` — `conclave-build-pack.zip`.
   - `apps/dashboard/src/app/projects/[id]/export/page.tsx:101` — `.md` 번들 파일명 `conclave-build-pack-...`.
   - pr-fix 팩도 확인: `conclave-pr-fix-pack.zip`류. 카탈로그 주석 "conclave-builder-pack"도.
   - 유저가 다운받는 파일명이라 **Category A**(Stage 84에서 B로 잘못 넘긴 것). 테스트: 팩 path가 `simsa-...`로 시작함을 assert.
2. **[P0-honesty] 빌더팩 README 과장 정직화**
   - `export.ts` `genReadme`(~167행) "프롬프트 하나만 넘기면...배포·전달까지 한 번에 알아서 끝납니다" + `ONE_SHOT_RUNBOOK`(~492~505). → "에이전트에 배포 도구(MCP)가 연결돼 있어야 배포까지 됩니다" 식 정직 카피.
3. **[P0-honesty] generate에 verify-against-user-words 게이트**
   - `apps/central-plane/src/workspace/generate.ts` — mock/LLM **무관하게** 생성된 productSpec이 사용자 원문 단어를 최소 N% 반영하는지 결정론적 검증(안 되면 정직 경고/재시도). #298의 mock 트리거 좁히기보다 근본(LLM도 날조하므로). 순수 함수 + 테스트.
4. **[P0-honesty] C2 답을 productSpec에 병합**
   - `apps/dashboard/src/app/projects/[id]/spec/page.tsx` — `resolveOpenDecision`이 `resolvedOpenDecisions`(extended data)에만 저장 → **checks/export가 읽는 productSpec에 병합 안 됨**. 답을 `productSpec.decisions`에 넣고 `openQuestions`에서 제거해 빌더에 도달시킬 것. export route(`workspace.ts`)/`generateBuilderPack`가 읽는 소스 확인.
5. **[P0-clarity] stage-1~85 docs redirect 배너**
   - `docs/stage-*.md`(또는 해당 위치) 최상단에 `> Conclave-era 가정 하에 작성됨. 최신 방향은 docs/simsa-research-audit-2026-07.md (v2).` 배너 삽입(스크립트 10분). 독립적이라 순서 무관.

## 3. 작업 그룹 (serial, 병렬 아님)
- **Group A (~1.5h):** #1 파일명 rename + #2 README 정직화. 같은 파일(export.ts/zip-utils/export page) → **한 PR**로. **먼저.**
- **Group B (~3h):** #3 verify 게이트 + #4 C2 파이프라인. generate.ts + spec/page + export/checks 경로.
- **Group C (~0.5h):** #5 stage docs 배너. 독립, 마지막.
- (선택) **prompt caching (~1.5h):** Anthropic system prompt + schema에 `cache_control` — `anthropic-fetch.ts` 경유. P0 다 나간 뒤. `/claude-api` skill 참고.

## 4. 그룹별 수동 검증 체크리스트 (Stage 84 miss 방지 — CI가 못 잡음)
- **A (파일명):** 실제 팩 다운로드 → ZIP·`.md`·클립보드 **어디에도 `conclave` 문자열 없음** 확인(`grep -ri conclave`). 폴더/파일명 전부 simsa.
- **A (README):** 다운받은 README에 "한 번에 알아서 끝납니다"류 단언 없음, "배포 도구 필요" 조건 명시.
- **B (verify 게이트):** "리뷰를 요약하는 앱" 등 다양한 아이디어로 생성 → productSpec이 그 아이디어를 반영(무관 제품 아님). LLM 경로도(키 있는 상태) 확인.
- **B (C2):** spec 페이지에서 openQuestion 답 → export 팩의 product.md `decisions`에 그 답이 등장하고 `openQuestions`에서 빠졌는지.
- **C (배너):** 무작위 stage doc 3개 상단에 배너 있는지.
- **공통:** i18n 만졌으면 `node --test test/i18n.test.mjs`(EN/KO parity). 시크릿/정직 PR은 **머지될 head 원격 CI green 확인 후** 머지(irreversible 게이트).

## 5. 참조
- 감사 v2: **`docs/simsa-research-audit-2026-07.md`** (변경 이력 + §0.5 = 최신 진실).
- 설계: `docs/onboarding-feasibility-layer.md`.
- 승계 배너: `ARCHITECTURE.md`·`CLAUDE.md` 상단(둘 다 Conclave 서술 — Simsa 작업 시 감사 우선).

## 6. 명시적 non-goals (오늘 하지 말 것)
- **Langfuse 완전 wiring** — **내일 첫 작업**(P0 fix 효과 측정용). 오늘 X.
- **정체성 포크 재구현**(Simsa 축 B를 Worker-네이티브 협의체로) — **Q1 프로젝트**. P0 다 정리 후 별도 킥오프. 오늘 X.
- **`@Simsa_AI` 봇 이관 · CLI `simsa` alias · 상표/핸들 확보** — 유저 0 표면, 지금 불급. 오늘 X.
- **prompt caching** — P0 전부 나간 뒤 여유 있으면(선택). P0 우선.

## 7. 환경 gotcha (재발 방지)
- **Windows Git Bash curl가 한국어를 mojibake로 전송** — 비ASCII API 검증은 `Write`로 UTF-8 파일 만들고 `curl --data-binary @file`. 인라인 `curl -d '한국어'` 금지.
- **배포:** central-plane = `gh workflow run deploy-central-plane.yml --ref main -f confirm=deploy`(수동, 머지≠배포) 또는 `pnpm ship`. dashboard = main 머지 → `npx vercel --prod --yes`. 양쪽이면 central 먼저.
- **pre-push 훅**이 `pnpm verify`(~3-4분) 자동 실행. 커밋·push 분리, 긴 timeout.
- **테스트 import 가능 dashboard 로직**은 `.mjs` + `.d.mts` 패턴(Node 20 CI가 .ts type-strip 못 함). central-plane는 `dist/`에서 import.
- **base=main** 스택 PR 금지. 한 그룹 한 PR.

---
**한 줄:** 감사 v2 fresh하게 읽고 → Group A(파일명+README) → B(verify+C2) → C(배너) 순서로, 각 그룹 수동 검증 후 머지·배포. Langfuse·포크재구현·네이밍은 오늘 X.
