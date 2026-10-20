# 정적 정찰 실험 — 사전 등록 (2026-10-21, 결과 보기 전 커밋)

> 승인: Bae 2026-10-21 "제안대로 진행해. 다 승인한다" (제안 3번 — 하루짜리 실험).
> 질문: v2 설계(`docs/simsa-inspector-v2-design-2026-10-07.md` §2.2-1 정찰, V-4)대로 **앱의 HTML·JS 번들을 읽기만 해서**(같은 출처 GET, 클릭·제출 0) 벤치 #1 must 결함 13개 중 몇 개의 **가설**이 서는가. v1 엔진은 같은 13개 중 0개를 짚었다(10-19·10-20 측정).
> 이 실험은 판정이 아니라 **가설**의 적중을 잰다(V-4: 정적 사실은 가설 근거일 뿐, 판정은 실행 증거로).

## 대상 · 정답

벤치 #1 앱 6개(`tools/simsa-inspection-fixtures/agent-bench1-local.mjs` APPS). must 실패 정답(정답지 `bench1-answer-key-*.md`):
chatgpt A3·A4·A5·A6·A7 · gemini A3·A6 · claude A3·A6 · v0 A6·A7 · bolt A6·A7 · lovable 없음 = **13셀**.

## 수집 (고정)
- 첫 화면 HTML + HTML이 참조하는 **같은 출처** `<script src>`(모듈 포함) + 그 안의 같은 출처 동적 import 1단계. 외부 출처 스크립트는 받지 않는다. GET만.
- 각 앱 `/admin`이 있으면 그 HTML·스크립트도(링크가 화면에 있는 경우만 — F6 규칙과 같음). [사전 결정: 첫 화면 HTML에 `/admin` 링크가 있을 때만]

## 사실 → 가설 규칙 (고정, 정규식은 스크립트에 그대로)

| 규칙 | 정적 사실 | 가설(결함 분류) | 이 가설이 덮는 AC |
|---|---|---|---|
| R1 | 백엔드 설정 자리표시자·미설정 안내: `YOUR_SUPABASE` · `SUPABASE_URL\s*[:=]\s*["']\s*["']` · `config\.js에` · `연결 정보를 입력` · `연결 설정을 먼저` · `your-project\.supabase` · `<your` | `missing_backend_config` | A3 A4 A5 A6 A7 |
| R2 | 예약 저장에 `localStorage.setItem`(또는 `indexedDB.open`)이 있고, **서버 쓰기 흔적이 없음**(`fetch(`·`axios`·`.insert(`·`.from(`·`method:\s*["']POST`·`supabase`·`firebase`·`firestore`·`/api/` 모두 0) | `client_only_storage` | A3 A6 |
| R3 | 클라이언트 "오늘" 날짜를 UTC로 만든다: `toISOString\(\)\.slice\(0,\s*10\)` · `toISOString\(\)\.split\(["']T["']\)\[0\]` · `toISOString\(\)\.substring\(0,\s*10\)` | `timezone_date` | A6 A7 |

## 채점 (고정)
- **적중 셀** = 앱의 must 실패 셀 중, 그 앱에서 발화한 규칙이 덮는 AC에 든 셀. 13셀 중 몇 개.
- **헛짚음** = 발화한 규칙이 덮는 AC 중 정답이 must 실패가 아닌 셀(특히 lovable — 정상 앱에서 발화하면 헛짚음).
- 원인까지 맞았는가: 정답지에 적힌 원인(chatgpt=Supabase 미연결 · gemini/claude=기기 저장 · bolt=UTC 날짜 · v0=**서버** UTC 날짜)과 규칙 분류가 같은가.
- **예측(결과 전 기록)**: v0의 날짜 결함은 서버 쪽 코드라 클라이언트 번들로는 R3가 발화하지 않을 것 → 적중 상한 11/13 [추정].

## 보고
결과는 `docs/pilot-2026-10/static-recon-result-2026-10-21.md`에 표(앱 × 규칙 발화 · 근거 줄 발췌 · 적중/헛짚음)로. 규칙·정규식을 결과를 본 뒤 바꾸면 그 사실과 바뀌기 전 점수를 함께 적는다.
