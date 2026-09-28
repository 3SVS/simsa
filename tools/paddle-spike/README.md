# Paddle 샌드박스 스파이크 ($-0)

works-or-free(빌드가 성공했을 때만 청구)가 Paddle Billing에서 **어떤 상태 머신으로 성립하는지** 샌드박스에서 실증하는 도구입니다.
Train $ 스테이지 **$-0**(`train $ start approved`, 2026-09-28 — 샌드박스·코드만). 결과 문서: [`docs/billing/paddle-sandbox-2026-10.md`](../../docs/billing/paddle-sandbox-2026-10.md).

- **샌드박스 전용.** API 주소는 `https://sandbox-api.paddle.com` 하나만 허용합니다. 라이브 주소·라이브 키·라이브 client-side token이면 요청을 보내기 전에 멈춥니다.
- **실결제 0.** Paddle 공개 테스트 카드만 씁니다(샌드박스는 실제 카드를 받지 않습니다).
- **프로덕션 코드와 무관.** 워크스페이스 패키지가 아니고, Worker·대시보드·CI 어디에도 연결되지 않습니다.
- 키가 없으면 모든 스크립트가 `키 없음 — 실행 대기`를 출력하고 **종료 코드 3**으로 끝납니다(네트워크 0, 증거 폴더도 만들지 않음).

## Bae가 할 일 (3줄)

1. 샌드박스 계정을 만듭니다: <https://sandbox-vendors.paddle.com/signup> (무료, 실결제 없음). 만든 뒤 **Checkout → Checkout settings → Default payment link**에 `https://localhost/`를 저장합니다(샌드박스는 localhost 허용, 이게 없으면 체크아웃이 열리지 않습니다).
2. **Developer tools → Authentication**에서 API 키(권한: products·prices·subscriptions·transactions·adjustments 읽기/쓰기)와 **Client-side token**(`test_`로 시작)을 하나씩 발급합니다.
3. `tools/paddle-spike/.env.example`을 `tools/paddle-spike/.env.local`로 복사해 두 값을 넣습니다. 이 파일은 `.gitignore` 대상이라 커밋되지 않습니다.

## 실행 순서 (에이전트가 실행)

| # | 명령 (`tools/paddle-spike`에서) | 하는 일 | 기대 소요 |
|---|---|---|---|
| 0 | `npm install` → `npx playwright install chromium` | 체크아웃 자동화 도구 설치(최초 1회) | 2~3분 |
| 1 | `node setup.mjs` | 상품 2개('Build guarantee'·'Repair fee') + 가격 4개(일회성 $199·$29, 카드 수집용 ①$19/월+30일 트라이얼 ②$0/월+30일 트라이얼) 생성. 두 번 돌려도 새로 만들지 않음. **$0 가격 허용 여부**가 여기서 나옴 | 10초 |
| 2 | `node run-checkout.mjs --variant trial19 --count 4` | 로컬 페이지에서 Paddle.js 오버레이 체크아웃을 테스트 카드로 완주 → trialing 구독 4개를 풀에 추가. 체크아웃 화면(상품 표시) 스크린샷·한글 프로젝트명 왕복 확인 | 회당 1~2분 |
| 2b | `node run-checkout.mjs --variant trial0 --count 1` | ($0 가격이 허용된 경우만) 분기 B 확인용 구독 1개 | 1~2분 |
| 3 | `node scenarios.mjs all --allow-activate` | S-A → S-B → S-C → S-D → S-E → S-F(시작) → 분기 판정 | 20~25분(S-E 환불 자동 승인 대기 최대 15분) |
| 4 | 약 40분 뒤 `node scenarios.mjs S-F --observe` | 트라이얼을 35분으로 줄인 구독 2개(보호 없음 / cancel 예약)의 최종 상태 | 10초 |
| 5 | `node scenarios.mjs verdict` | 증거로 분기 A/B/C 판정 → 결과 문서 §3 칸에 옮겨 적기 | 즉시 |

전체 ≈ 1시간(대기 포함), 손이 가는 시간 ≈ 10분. 체크아웃 자동화가 실패하면 `evidence/shots/fail-*.png`를 보고 `run-checkout.mjs`의 입력 칸 패턴(`FIELD`)을 고칩니다 — 입력 칸 라벨은 샌드박스 첫 실행 전에는 **추정**입니다. 눈으로 보려면 `--headed`.

수동으로 화면만 보려면 `node serve.mjs --variant trial19` → 출력된 `http://127.0.0.1:4817/`을 열면 됩니다(이 경로로 만든 구독은 풀에 자동으로 들어가지 않습니다).

## 시나리오

| id | 질문 | 요청 |
|---|---|---|
| S-A 성공 | trialing 구독에 즉시 일회 청구가 되는가, 거래가 정산되는가, 구독 상태·다음 청구일이 바뀌는가 | `POST /subscriptions/{id}/charge/preview` → `POST /subscriptions/{id}/charge` `{effective_from: immediately, items:[$199]}` → 거래 추적. 거부되면(`--allow-activate` + $0 구독) `POST /activate` 뒤 재시도(분기 B) |
| S-B 실패 | 청구 없이 즉시 취소하면 청구가 정말 0인가 | `POST /subscriptions/{id}/cancel` `{effective_from: immediately}` → 거래 목록으로 0 확인 |
| S-C Care 자동 전환 방지 | 트라이얼 끝 cancel 예약을 걸어 둔 뒤 `/charge`가 그 예약을 지우거나 바꾸는가 | `cancel {next_billing_period}` → `/charge` → `scheduled_change` 전후 비교 |
| S-D 두 번째 청구 | 같은 구독에 수리 $29를 한 번 더 청구할 수 있는가 | S-A 구독에 `/charge` `{items:[$29]}` |
| S-E 환불 | 전액 환불 Adjustment가 승인되는가, 수수료는 어떻게 처리되는가 | `POST /adjustments {action: refund, type: full}` → 승인까지 폴링 → 거래·조정 합계의 fee 비교 |
| S-F 만료 | 청구 없이 트라이얼이 끝나면 어떻게 되는가(보호 없음 F1 / cancel 예약 F2) | `PATCH /subscriptions/{id}` `{next_billed_at: +35분, proration_billing_mode: do_not_bill}` → 만료 뒤 상태·거래 |

## 증거

`evidence/`(커밋 안 됨)에 `catalog.json`·`setup.json`·`pool.json`·`checkout-<변형>.json`·`S-A.json`…`S-F.json`·`verdict.json`·`shots/*.png`.
증거 파일은 **요청·응답 요약**만 담고, 쓰기 전에 키·토큰·Bearer 헤더·이메일·카드 번호·카드 객체·고객 포털 URL·주소 줄을 가립니다(`lib/redact.mjs`). 가린 뒤에도 패턴이 남아 있으면 파일을 만들기 전에 멈춥니다(`assertNoLeak`). Paddle ID·금액·날짜·한글 프로젝트명은 남깁니다.

## 종료 코드

| 코드 | 뜻 |
|---|---|
| 0 | 완료 |
| 1 | 오류(요청 실패·가격 생성 실패 등) |
| 2 | 사용법 오류 |
| 3 | **실행 대기** — 키·카탈로그·풀·playwright가 없거나 관측 시점 전. 성공으로 세지 않습니다 |

## 테스트

```bash
cd tools/paddle-spike && node --test test/*.test.mjs
```

네트워크 호출 0(가짜 fetch 주입, 자식 프로세스는 fetch를 막아 두고 실행). 라이브 URL·키 거부, 가림, 요청 본문 모양, 웹훅 서명 검증, 키 없음 정직 종료, 분기 판정 규칙을 고정합니다.
`test/glue-smoke.test.mjs`는 진입 스크립트를 실제 프로세스로 돌리되 fetch를 메모리 가짜 Paddle(`test/helpers/fake-paddle.mjs`)로 바꿔 setup 멱등·풀→시나리오→증거→판정 배선을 확인합니다. 가짜는 Paddle 동작을 **가정**하므로 거기서 나온 판정은 증거가 아닙니다.

## 파일

| 파일 | 역할 |
|---|---|
| `paddle-client.mjs` | fetch 기반 최소 클라이언트(샌드박스 허용 목록·라이브 키 거부·경로 탈출 금지) |
| `setup.mjs` | 상품·가격 멱등 생성, $0 가격 허용 여부 기록 |
| `checkout/index.html` · `serve.mjs` | 127.0.0.1 전용 Paddle.js(sandbox) 오버레이 체크아웃 페이지 |
| `run-checkout.mjs` | Playwright 체크아웃 완주 → trialing 구독 풀 |
| `scenarios.mjs` | S-A~S-F · `verdict` |
| `webhook-verify.mjs` | `Paddle-Signature` 검증 순수 함수($-2가 옮겨 쓸 참조 구현) |
| `lib/` | 카탈로그·요청 빌더·가림·증거·관측/판정·env |
