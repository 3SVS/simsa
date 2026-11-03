# Train L4 — 사용자 마이크로 라벨 (계획, 2026-11-03)

상태: **계획만.** 코드 착수는 `train L4 start approved`, 저장 표 적용은 `migration 0077 apply approved.`가 따로 있어야 한다. 규약: `docs/simsa-labeling-design-2026-10-20.md` §8.5 (LOCKED). 전제: train L·L2·L3 (#620·#625·#626).

## 0. 왜 하나 — 무엇이 이것 없이 무너지나

- 라벨링 에이전트(L3)는 **우리 쪽 눈**이다. 앱을 만든 사람만 아는 것(의도, 실제로 써 봤을 때 됐는지)은 볼 수 없다.
- 기계가 `not_verified`로 남긴 칸은 지금 버려진다. 사용자 한 번 누르기가 그 칸을 채우는 가장 싼 길이다.
- 사용자 "아니요, 돼요"(기계가 fail이라 했는데 사용자는 된다)는 **엔진의 거짓 판정을 찾는 가장 싼 신호**다. §8.5 규칙 3.
- 단, **사용자가 없으면 이 기능은 데이터를 0개 만든다.** 지금 실사용 런은 거의 없다. 그래서 L4는 "쌓일 그릇을 먼저 만든다"이고, 효과 측정은 실사용자 유입(로드맵 ③·⑤) 뒤다. 아래 §6.

## 1. 지금 있는 것 (origin/main `dc1a2c6` 기준)

| 있음 | 위치 |
|---|---|
| 앱 전체 판정 `user_verdict` (as_intended / works_but_different / still_broken / unsure) | 0069 · `POST /workspace/projects/:id/visual-checks/:runId/verdict` (`workspace-visual-check-runs.ts:1030`) · 화면 `UserVerdictSection` |
| 소유자 확인 | `requireOwnedRun` (`workspace-visual-check-runs.ts:541`) |
| 라벨 표 0076, `source` CHECK에 `user` 허용 | `migrations/0076_failure_labels.sql` |
| 기준별 결과 행 (pass / fail / not_verified) | `apps/dashboard/src/components/AgentReportSections.tsx` |
| 닫힌 어휘 W1 단계 12개 | `src/dataset/labels.ts:34` |

| 없음 | 영향 |
|---|---|
| 사용자 답을 쓰는 경로 | 0076 `AcLabel`은 pass·fail에 증거(`h5`), 확신도·범위(`h3`·`h4`)를 요구한다. 사용자 "돼요"는 이 검증을 통과할 수 없다 |
| 사용자 실패 단계(U2)를 둘 곳 | `label_failure_events`는 증상·원인·심각도 등 사용자가 줄 수 없는 칸이 NOT NULL |
| `edit_rounds`·분야·빌더 확인 저장 | Zod(`AppCard.editRounds`)에만 있다 |

## 2. 결정 (제안 — 착수 승인 시 잠금)

| # | 결정 | 이유 |
|---|---|---|
| L4-1 | **사용자 답은 새 표 `label_user_answers`(0077)에 원문 그대로.** 0076 `AcLabel`로 바꿔 넣지 않는다. 행: `answer_id`, `run_id`, `app_id`, `ac_id`(앱 질문이면 NULL), `question`, `answer`, `locale`, `supersedes`, `created_at`. `question`·`answer` 모두 CHECK 닫힌 어휘. 사용자 식별자는 넣지 않는다(런이 이미 소유자와 묶여 있다) | §8.5 규칙 1(출처 분리, 덮어쓰기 금지). 사용자 답에 증거·확신도를 지어 넣으면 라벨 오염이다. 일치율은 읽을 때 런 × 기준으로 짝지어 낸다 |
| L4-2 | **노출 기록은 기존 사용 이벤트로.** `micro_label_shown`(질문 키·기준 수만) — 새 표 없음 | §8.5 규칙 4(응답률·답한 사람 편향)와 측정(이탈률)에 노출 분모가 필요하다 |
| L4-3 | **1단계 범위:** ② 결과 화면 질문 3종(확인 못 한 기준 → 돼요/안 돼요/안 해 봤어요 · 문제 찾은 기준 → 네 안 돼요/아니요 돼요/모르겠어요 · 안 돼요일 때만 "어디서 막혔나요?" 8칩) + ① 빌더 확인 · 수정 횟수. **분야 칩은 2단계**(기획 추천 칩 연결 필요). **나이대·성별·경험(X7~X9)은 제외** — 선택 동의 ⑦와 법 검토가 먼저(D11) | 판정 품질에 직접 닿는 것부터. 인구통계는 되돌리기 어려운 수집이다 |
| L4-4 | **화면 규칙:** 결과를 다 보여 준 뒤 해당 기준 행 옆. 한 번에 최대 3개, 런당 5개. 건너뛰기 항상 보임. 판정 질문은 미리 선택하지 않음. 답하면 그 자리에서 "덕분에 더 정확해졌어요" | §8.5 원칙 1~6 그대로 |
| L4-5 | **경로:** `POST /workspace/projects/:id/visual-checks/:runId/micro-labels` — `/verdict`와 같은 소유자 확인·Zod. 완료된 v2 런만. 다시 답하면 새 행 + `supersedes`(지우지 않음) | 기존 판정 경로와 같은 보안 모양 |
| L4-6 | **쓰는 곳:** ① 관리자 읽기에 "사용자 반박 큐" 건수(숫자만) — 기계 fail에 "아니요, 돼요" · 기계 pass/not_verified에 "안 돼요". 이 런들이 라벨러 실행의 우선 대상 ② `/admin/labeler-agreement`에 U1 ↔ 라벨러 H1 일치율 추가. 80% 아래 질문은 집계에 쓰지 않고 신호로만 [PILOT] | §8.5 규칙 2·3 |
| L4-7 | **카피는 사전(`dictionary.mjs`)에 KO/EN.** 개발 용어 금지. `AgentReportSections`의 인라인 COPY에는 넣지 않는다 | 대시보드 카피 규칙 · 번역 누락 방지 |
| L4-8 | **설계 문서 정정:** §8.5 규칙 1의 `source=expert`는 코드의 `labeler_agent`를 뜻한다(10-21 "라벨러 = Simsa 에이전트" 결정 뒤 용어). 게이트 레지스트리에 정정 행 추가 | 문서·코드 어긋남 |

## 3. 단계 (각 PR base=main)

1. **L4a 저장·경로** — 0077 마이그레이션, Zod, POST 경로, 사용 이벤트, 테스트(실제 SQLite: 소유자 아니면 403·닫힌 어휘 밖 400·덮어쓰기 대신 새 행·0076 미변경). 옛 코드에서 실패하는 테스트 포함.
2. **L4b 화면** — 기준 행 옆 칩, 최대 3·런당 5, 건너뛰기, KO/EN. 실브라우저 여정 감사(한글 화면 포함).
3. **L4c 읽기** — 반박 큐 건수 · U1↔H1 일치율(숫자만, ops-probe `labeler-status` 확장).

## 4. 승인 순서

`train L4 start approved` → PR 머지 각각 → `migration 0077 apply approved.` → `deploy central-plane approved.` → 대시보드 배포(Vercel, 별도 승인). 마이그레이션은 배포보다 먼저 적용해야 한다(배포 워크플로가 미적용 마이그레이션이 있으면 배포를 거부한다).

## 5. 위험

- **유도 편향:** 판정 질문에 기본 선택을 두면 사용자가 그냥 누른다 → 미리 선택 금지(L4-4).
- **답한 사람만 보는 편향:** 문제를 겪은 사람이 더 답한다 → 노출 분모 기록(L4-2), 답만으로 실패율을 내지 않는다.
- **귀찮음:** 이탈 증가 ≤ 2%p [PILOT]. 넘으면 그 질문을 뺀다.
- **공개 레포:** 관리자 읽기는 숫자만(L3-6과 같은 규칙).

## 6. 세 칸 (계획 시점)

| 라이브확인 | 테스트만 | 미측정 |
|---|---|---|
| — | — | 전부. 특히 응답률·이탈률은 실사용자 유입 전에는 잴 수 없다(직원 테스트로는 편향 측정이 안 된다) |
