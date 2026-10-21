# 정적 정찰 실험 — 결과 (2026-10-21)

> 사전 등록: `static-recon-prereg-2026-10-21.md` (`d1240c7`, 결과 전 커밋). 규칙·정규식은 등록본 그대로 실행했다. 스크립트 `static-recon.mjs`(세션 scratchpad, GET만·코드 실행 없음). 실행 KST 2026-10-21 새벽(정적 수집이라 시각 무관).
> 비교: v1 엔진은 같은 13셀 중 **0**을 짚었다(10-19·10-20 측정).

## 요약

| 점수 | 값 |
|---|---|
| 등록 규칙 그대로 — 적중 셀 | **13 / 13** |
| 헛짚음 셀 | 1 (gemini A7) · 정상 앱 lovable 발화 **0** |
| **원인까지 맞음**(등록 채점 3번째 줄) | **11 / 13** — v0 2셀은 원인이 다름(아래). 사전 예측 "상한 11/13"과 같음 |
| 수집 | 앱당 2~12파일, 클릭·제출 0, 앱 상태 변화 0 |

## 앱별

| 앱 | 발화 | 근거(번들 발췌) | must 실패 정답 | 판정 |
|---|---|---|---|---|
| chatgpt | R1 `missing_backend_config` | `if (!supabaseClient) { setMessage("관리자에게 사이트 연결 설정을 먼저 요청해주세요.") …` | A3~A7 (Supabase 미연결) | **5/5 원인 일치** |
| | R3 | `new Date(d - d.getTimezoneOffset()*60000)…toISOString().slice(0, 10)` | — | **오발화**(현지 시간 보정한 올바른 코드) — 다른 칸을 덮지 않아 점수 영향 없음 |
| gemini | R2 `client_only_storage` | `saveReservations(list) { localStorage.setItem(STORAGE_KEY, …) }`, 서버 쓰기 흔적 0 | A3·A6 (기기 저장) | **2/2 원인 일치** |
| | R3 | `const today = new Date().toISOString().split('T')[0]` | — | 진짜 UTC 날짜 사용(KST 00~09시 결함 가능성) — 정답지 must엔 없음 → **헛짚음 A7 1셀**(A6는 R2와 겹침) |
| claude | R2 | `set(k, v) { localStorage.setItem(k, JSON.stringify(v)) }`, 서버 쓰기 흔적 0 | A3·A6 (기기 저장) | **2/2 원인 일치** |
| bolt | R3 | `p.setHours(0,0,0,0); const w = p.toISOString().slice(0,10)` — 현지 자정을 UTC로 바꿔 한국에선 **하루 전 날짜** | A6·A7 (UTC 날짜) | **2/2 원인 일치** |
| v0 | R3 | `…getTimezoneOffset(); return new Date(e.getTime()-t).toISOString().slice(0,10)` | A6·A7 (**서버**가 UTC로 "오늘" 계산) | 칸은 맞았으나 **근거가 결함이 아님**(보정된 클라이언트 코드). 서버 코드는 번들에 없다 → 원인 불일치 0/2 |
| lovable | 없음 | — | 없음(정상) | 헛짚음 0 |

## 해석

1. **v2 정찰(V-4) 방향은 증거로 확인됐다.** 번들을 읽기만 해도 chatgpt·gemini·claude·bolt의 must 결함 11셀이 **원인까지** 가설로 선다. 같은 앱에서 v1이 3런 내내 0을 짚은 것과 대조된다. 이 앱들의 결함은 화면을 헤매서 찾는 것이 아니라 코드에 적혀 있다.
2. **가설은 판정이 아니다.** R3는 같은 모양의 올바른 코드에도 걸렸다(chatgpt·v0). v2 설계대로 가설은 실행 증거로 확인해야 한다 — 예: 시계를 KST 00:30으로 옮겨(`setClock`) 관리 화면 "오늘"을 본다. gemini R3도 실행으로 참·거짓을 가린다.
3. **서버 쪽 결함(v0)은 정적 정찰로 안 보인다.** 실행 실험(시계 변형 + 관리 화면)이 필요하다 — v2 가설 단계에 "프레임워크가 서버 렌더(Next 서버 액션 등)면 날짜는 서버 시간대 가설을 자동으로 세운다"를 넣을 근거.
4. 규칙 보완(사후, 점수엔 반영 안 함): R3에서 같은 식 안에 `getTimezoneOffset` 보정이 있으면 제외 → chatgpt·v0 오발화 제거, 사후 점수 11/13 적중·헛짚음 1(gemini A7). 이 보완은 v2 S2 정적 사실 추출의 테스트 사례로 옮긴다.

## 다음 (Bae 승인 2026-10-21 "다 승인한다" 범위)

- v2 **S0~S2**(최강 모델 도달성 → 증거물 저장소·기계 검증기 → 정찰·정적 사실 추출) — 이 실험의 R1~R3(+보완)과 6앱 발췌가 S2의 첫 테스트 사례. 착수는 `train v2-S0 start approved.` 문구로.
- 가설 → 실행 확인(S3~S5)에서 짚어야 할 13셀의 실행 실험 목록: 새 브라우저 이중 예약(gemini·claude A3), 사장님 화면 다른 기기 예약 표시(gemini·claude A6), KST 00:30 시계 + 관리 화면(bolt·v0 A6), 제출 후 결과 없음(chatgpt A4).
