# Train L3 — 라벨러 프로덕션 연결 (2026-11-02)

승인: `train L3 start approved` (Bae 2026-11-02). 전제: train L2(PR #625). 규약: `docs/simsa-labeling-design-2026-10-20.md` §0.0 (LOCKED). 머지·배포·첫 실행은 이 승인 범위 밖이다.

## 결정

| # | 결정 | 이유 |
|---|---|---|
| L3-1 | **대상 = 직원(벤치) 런만.** 사용자 런은 `staff_runs_only`로 거절한다. 사용자 앱은 동의 문구를 정리한 뒤 별도 승인 | 사용자 앱 화면을 다른 벤더에 다시 보이는 일은 동의 범위 문제다. 벤치 앱은 우리 앱이다 |
| L3-2 | **수동 실행.** `POST /admin/labeler-runs` · ops-probe `labeler-run`. 자동 샘플링은 프로덕션 비용을 잰 뒤 | 자동은 상한을 정한 뒤에 켠다 |
| L3-3 | **패스별 벤더 고정, 대체 금지.** A = OpenAI `gpt-5.6-sol`, B = Anthropic `claude-opus-5-5`(effort high, max_tokens≥8000), C = OpenAI `gpt-5.4`(칸 분쟁용 세 번째 패스) | 대체가 켜지면 두 패스가 몰래 같은 벤더가 되어 κ가 의미를 잃는다. 막히면 그 패스가 실패하는 것이 맞다 |
| L3-4 | **마이그레이션 없음.** 잡 상태 = `inspection_agent_spend` 행(잡 id `lab_<runId>_<패스>`, 예산 $5·200호출) + 0076 라벨 행 + KV 메모(실패 사유 분류, 30일) | 되돌리기 쉽다 |
| L3-5 | **사용자 화면과 분리.** 검수 행을 만들지 않고 전용 콜백 `/internal/labeler-done`으로만 받는다. 원장 호출 지점 `inspect_labeler` — 사용자 검수 하루 예산(`inspect_agent`)을 쓰지 않는다 | 검수 결과·재검수·과금과 섞이지 않게 |
| L3-6 | **읽기 = 숫자만.** `GET /admin/labeler-runs?runId=` · `GET /admin/labeler-agreement` · ops-probe `labeler-status`. 분쟁은 건수만, 어느 런·기준인지는 내지 않는다. 실패 사유는 분류만(timeout·budget·llm·no_rows·other), 원문은 console에만 | 레포가 공개라 Actions 로그를 누구나 읽는다 |
| L3-7 | **분쟁.** 칸 분쟁 → 세 번째 패스 C를 같은 엔드포인트로 수동 실행. H1 분쟁 → 사용자 질문은 마이크로 라벨 UI(다음 트레인) | §0.0 규칙 그대로 |

토큰은 종류를 가른다(`ilb1`). 검수 런 토큰으로는 라벨러 경로에 못 들어온다. 블라인드(§5-1): 컨테이너에는 주소·의도·기준(허용 목록 칸만)만 보낸다. 원 런의 리포트·계획·판정은 보내지 않는다.

## 흐름

1. 관리자 → `POST /admin/labeler-runs {runId, passes:["A","B"]}`. 원 런이 완료·v2·직원 런·운영 정보 허용인지 확인
2. 패스마다 예산 행 + 잡 토큰 → 컨테이너(`profile:"labeler"`, reproRuns 3)
3. 컨테이너 → LLM 프록시(토큰 종류로 라벨러 경로, 벤더 고정) → 같은 v2 실행기 → `/internal/labeler-done`
4. 콜백 → `labelerRowsFromV2Report` → 실패 사건 칸 보강(그 패스 벤더) → Zod → 0076 append(닫힌 어휘만) → 잡 닫기
5. 읽기: 같은 런의 A·B 행을 런 × 기준으로 짝지어 κ·분쟁 건수

## 비용 (예상)

로컬 F1~F14(기준 1개짜리 앱 14개) 패스 B = 입력 163K·출력 20K ≈ $1.05, 앱당 약 $0.08이다. 기준 10개짜리 벤치 앱이면 패스당 약 $1 수준으로 본다. 프로덕션 실측은 아직 없다. `gpt-5.6-sol`은 단가표에 없어 원장·예산이 보수 단가로 잡는다(실제보다 크게 잡힘).

## 세 칸 보고

| 라이브확인 | 테스트만 | 미측정 |
|---|---|---|
| — (머지·배포 전) | `test/train-l3-labeler-wiring.test.mjs` 실제 라우트 + 실제 SQLite: 직원 런만·블라인드·벤더 고정(막히면 실패)·잡 닫기·행 출처·숫자만 | Worker에서 Anthropic 도달(프로브 200뿐, `ANTHROPIC_ENABLED="off"`인 상태) · 컨테이너 왕복 · 실제 벤치 앱 비용·시간 · 패스 C 라벨 품질 |

## 첫 실행 순서 (각각 별도 승인)

1. `PR #N merge approved.`
2. `deploy central-plane approved.` — 컨테이너 이미지 포함
3. 벤치 런 1개 × 패스 A·B (KST 10~17시). 패스 B가 403이면 벤더 도달 문제로 보고하고 멈춘다
