# Paddle 샌드박스 스파이크 — works-or-free 상태 머신 ($-0)

- **스테이지**: Train $ · **$-0** (게이트 `train $ start approved`, 2026-09-28 Bae — 샌드박스·코드만)
- **계획 정본**: `docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §1.1(성공 시 청구 메커니즘)·§5.2($-0 행)·§5.5(D-23 초안)
- **관련 결정**: D-7(예산 상한 — 초과 시 청구 없음) · D-9(판정 불변식 — human AC가 있으면 User Acceptance Required) · D-23 [PILOT, **미잠금 초안**] 과금 설계 · PRD §12(전면 무료, 예외는 D-23으로만)
- **도구**: [`tools/paddle-spike/`](../../tools/paddle-spike/README.md)
- **상태**: **실행 대기** — 샌드박스 계정·키가 아직 없다. 아래 결과 칸은 전부 비어 있다.
- **규칙**: 이 결론(§4 분기) 없이 $-1 착수 금지(계획 §5.2).

> 읽는 법: §1은 공식 문서로 이미 확정된 것, §2는 샌드박스를 돌려야만 알 수 있는 것, §3은 그 결과 칸, §4는 결과를 분기 A/B/C로 바꾸는 규칙, §5는 "성공"의 정의 초안, §6은 샌드박스로도 못 푸는 것.

---

## 1. 문서 조사로 확정된 것

접근일 **2026-09-28**. 원문은 요약 도구를 거쳐 읽었다. 결정 근거로 인용할 때는 링크의 원문을 한 번 더 확인할 것.

| # | 사실 | 출처 (developer.paddle.com) |
|---|---|---|
| F1 | **trialing 구독에 일회 청구가 문서화돼 있다**: "Bill a one-time charge to a trialing subscription for things like onboarding or setup fees." 미리보기 `POST /subscriptions/{id}/charge/preview` → 생성 `POST /subscriptions/{id}/charge` | [/build/trials/update-trials](https://developer.paddle.com/build/trials/update-trials) |
| F2 | `/charge` 본문: `effective_from` **필수**(`immediately` \| `next_billing_period`), `items` 1~100개, **`billing_cycle`이 null인 가격만**, `on_payment_failure` 기본 `prevent_change`(또는 `apply_change`), `receipt_data`는 immediately일 때만 | [/api-reference/subscriptions/create-subscription-charge](https://developer.paddle.com/api-reference/subscriptions/create-subscription-charge) |
| F3 | `/charge` 응답은 **구독 엔티티(201)**. "one-time charges aren't held against the subscription entity" → 청구 거래는 `GET /transactions?subscription_id=…&origin=subscription_charge`로 찾는다 | 같은 페이지 · [/api-reference/transactions/list-transactions](https://developer.paddle.com/api-reference/transactions/list-transactions) |
| F4 | `immediately`는 거래를 바로 만든다. 자동 수금 구독은 결제 시도 동안 응답이 늦을 수 있다 | [/build/subscriptions/bill-add-one-time-charge](https://developer.paddle.com/build/subscriptions/bill-add-one-time-charge) |
| F5 | 다음 청구가 **30분 이내**이거나 `past_due`이면 구독을 바꿀 수 없다 | 같은 페이지 |
| F6 | trialing 구독은 **`items`·`next_billed_at`만** 바꿀 수 있고 `proration_billing_mode`는 **`do_not_bill`만** 허용 → 트라이얼 단축·연장 가능 | [/build/trials/update-trials](https://developer.paddle.com/build/trials/update-trials) |
| F7 | `POST /subscriptions/{id}/activate`: 자동 수금 **trialing만**, **즉시 청구** + 청구일을 활성화 시각 기준으로 재계산 | [/api-reference/subscriptions/activate-subscription](https://developer.paddle.com/api-reference/subscriptions/activate-subscription) |
| F8 | `POST /subscriptions/{id}/cancel`: `effective_from` 기본 `next_billing_period` → `scheduled_change`(effective_at = next_billed_at) 생성, `immediately` → 바로 `canceled`. 취소된 구독은 되살릴 수 없다 | [/api-reference/subscriptions/cancel-subscription](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription) · [/build/subscriptions/cancel-subscriptions](https://developer.paddle.com/build/subscriptions/cancel-subscriptions) |
| F9 | 예약 변경 제거 = `PATCH /subscriptions/{id}` `{"scheduled_change": null}` ("you may only set to null to remove a scheduled change") | [/api-reference/subscriptions/update-subscription](https://developer.paddle.com/api-reference/subscriptions/update-subscription) |
| F10 | 레이트 리밋: IP당 240 요청/분. **구독당 청구성 변경 20회/시간·100회/24시간**. 초과 시 429 + `Retry-After` | [/api-reference/about/rate-limiting](https://developer.paddle.com/api-reference/about/rate-limiting) |
| F11 | 가격: `billing_cycle` null = 일회성. `trial_period`는 `billing_cycle`이 있어야 한다. `trial_period.requires_payment_method` 기본 true(false = 카드 없는 트라이얼 — **works-or-free에는 쓰면 안 됨**, 청구할 결제수단이 없다). 최소 금액 규정은 문서에 없음 | [/api-reference/prices/create-price](https://developer.paddle.com/api-reference/prices/create-price) |
| F12 | 인증 `Authorization: Bearer <키>`. 키 형식 `pdl_sdbx_apikey_…`(샌드박스)/`pdl_live_apikey_…`(라이브). 샌드박스 API `https://sandbox-api.paddle.com`, 대시보드 `sandbox-vendors.paddle.com` | [/api-reference/about/authentication](https://developer.paddle.com/api-reference/about/authentication) · [/build/tools/sandbox](https://developer.paddle.com/build/tools/sandbox) |
| F13 | Client-side token: `test_`/`live_` + 27자, 프런트엔드에 공개해도 됨(체크아웃·가격 미리보기 전용) | [/paddlejs/client-side-tokens](https://developer.paddle.com/paddlejs/client-side-tokens) |
| F14 | Paddle.js v2 `https://cdn.paddle.com/paddle/v2/paddle.js` · `Paddle.Environment.set("sandbox")` · `Paddle.Initialize({ token, eventCallback })` · `Paddle.Checkout.open({ items:[{priceId, quantity}], customer:{email, address:{countryCode}}, customData, settings:{displayMode:"overlay", locale, …} })`. customData는 키 1개 이상. 이메일에 공백·비ASCII 불가. 반복 품목은 같은 주기여야 함. **기본 결제 링크**가 있어야 체크아웃이 열림(샌드박스는 localhost 허용·도메인 승인 없음) | [/build/checkout/build-overlay-checkout](https://developer.paddle.com/build/checkout/build-overlay-checkout) · [/paddlejs/methods/paddle-checkout-open](https://developer.paddle.com/paddlejs/methods/paddle-checkout-open) · [/build/transactions/default-payment-link](https://developer.paddle.com/build/transactions/default-payment-link) |
| F15 | Paddle.js 이벤트: `checkout.loaded`·`checkout.completed`·`checkout.closed`·`checkout.error`·`checkout.payment.failed`… (completed의 data 필드 목록은 문서에 없음) | [/paddlejs/events/overview](https://developer.paddle.com/paddlejs/events/overview) |
| F16 | 테스트 카드(샌드박스 전용): `4242 4242 4242 4242` 성공(3DS 없음) · `4000 0038 0000 0446` 3DS · `4000 0000 0000 0002` 거절 · `4000 0027 6000 3184` 성공 후 거절 · 이름 아무거나·만료 미래 | [/concepts/payment-methods/credit-debit-card](https://developer.paddle.com/concepts/payment-methods/credit-debit-card) |
| F17 | 웹훅 서명: `Paddle-Signature: ts=…;h1=…`, 서명 대상 `${ts}:${원문 본문}`(변형 금지), HMAC-SHA256(엔드포인트 시크릿), 기본 허용 오차 **5초**, 시크릿 교체 중 h1 여러 개 | [/webhooks/signature-verification](https://developer.paddle.com/webhooks/signature-verification) |
| F18 | 웹훅 처리: 5초 안에 200, `event_id`로 멱등, **순서 보장 없음**. 샌드박스 재시도 15분 3회(라이브 3일 60회) | [/webhooks/overview](https://developer.paddle.com/webhooks/overview) · [/build/tools/sandbox](https://developer.paddle.com/build/tools/sandbox) |
| F19 | 환불: `POST /adjustments` `{action:"refund", type:"full"\|"partial", transaction_id, reason}`, **`completed` 거래만**, `pending_approval` → `approved`/`rejected`, 앞 조정이 pending이면 새 조정 불가. 라이브 자동 승인 = 검증 완료 계정 ∧ ≤ $400 ∧ 잔액 이내 ∧ 은행이체 아님. **샌드박스는 10분마다 자동 승인** | [/build/transactions/create-transaction-adjustments](https://developer.paddle.com/build/transactions/create-transaction-adjustments) |
| F20 | (계약, 계획 §1.1) 환불 시 수수료 **미반환**(MSA §10.4), 차지백 $20/건, 판매자 직접 환불 불가(paddle.net 경유) | 계획 문서 §1.1 — S-E가 샌드박스 숫자로 대조 |

도구가 이 표를 어떻게 따르는지: 요청 본문 모양은 `tools/paddle-spike/lib/requests.mjs`, 서명 검증은 `webhook-verify.mjs`, 둘 다 테스트로 고정.

## 2. 샌드박스를 돌려야만 알 수 있는 것

| # | 질문 | 문서로 안 되는 이유 | 어디서 보나 |
|---|---|---|---|
| Q1 | trialing 구독에 `/charge immediately` → 거래가 **실제로 정산(`completed`)** 되는가 | F1은 "가능"만 말하고 상태 전이는 없다 | S-A |
| Q2 | 청구 뒤 구독 `status`·`next_billed_at`·트라이얼이 그대로인가 | 문서 없음 | S-A |
| Q3 | 청구 없이 **즉시 취소**하면 체크아웃의 $0 거래 외에 청구가 **정말 0**인가 | cancel 문서는 trialing 청구를 말하지 않는다 | S-B |
| Q4 | 트라이얼 끝 **cancel 예약** 뒤 `/charge`가 그 예약을 지우거나 바꾸거나 거부하는가 | 문서 없음 | S-C |
| Q5 | 같은 구독에 **두 번째** `/charge`(수리 $29)가 되는가 | 레이트 리밋(F10)만 있다 | S-D |
| Q6 | 전액 환불 조정의 **fee 처리**(조정 totals.fee·payout_totals vs 원거래 fee), 승인 소요 | fee 반환 여부가 API 문서에 없다(F20 계약과 대조) | S-E |
| Q7 | 청구 없이 트라이얼이 끝나면 — F1 보호 없음: **$19 자동 청구 + active 전환**(= Care 자동 부착)인가 / F2 cancel 예약: **canceled + 청구 0**인가 | trialing 만료 흐름이 문서에 없다 | S-F |
| Q8 | **$0/월 반복 가격**이 허용되는가(분기 B의 전제) | 최소 금액 규정이 문서에 없다(F11) | setup |
| Q9 | 체크아웃 화면이 "Build guarantee"로 보이는가, "30일 무료 후 $19/월"이 **구독으로 오해**되게 보이는가 | 화면은 실행해야 보인다 | run-checkout(`shots/display-*.png`·`displayText`) |
| Q10 | customData의 **한글 프로젝트명**이 구독·거래에 깨지지 않고 돌아오는가(규칙 6) | 인코딩은 실측만 믿는다 | run-checkout(`koreanCustomData`) |
| Q11 | `checkout.completed` 이벤트 data에 `transaction_id`가 오는가 | F15 — 필드 목록 없음 | run-checkout |
| Q12 | 트라이얼 체크아웃이 만드는 거래(origin·금액 $0·상태)의 모양 | 문서 없음 | run-checkout(`checkoutTransaction`) |

## 3. 시나리오별 결과

| 시나리오 | 관측 항목 | 결과 | 증거 | 실행일 |
|---|---|---|---|---|
| setup | Q8 $0/월 가격 허용 | 실행 대기 | `evidence/catalog.json` | — |
| checkout | Q9 상품 표시 · Q10 한글 왕복 · Q11 거래 id · Q12 체크아웃 거래 · trialing 생성 | 실행 대기 | `evidence/checkout-trial19.json` · `shots/display-*.png` | — |
| S-A 성공 | Q1 거래 정산 · Q2 구독 상태 유지 · (거부 시) activate 경로 | 실행 대기 | `evidence/S-A.json` | — |
| S-B 실패 | Q3 즉시 취소 → 청구 0 | 실행 대기 | `evidence/S-B.json` | — |
| S-C 자동 전환 방지 | Q4 cancel 예약 vs `/charge` | 실행 대기 | `evidence/S-C.json` | — |
| S-D 두 번째 청구 | Q5 $29 재청구 | 실행 대기 | `evidence/S-D.json` | — |
| S-E 환불 | Q6 승인·수수료 | 실행 대기 | `evidence/S-E.json` | — |
| S-F 만료 | Q7 F1·F2 최종 상태 | 실행 대기 | `evidence/S-F.json` | — |
| **분기 판정** | §4 | **실행 대기** | `evidence/verdict.json` | — |

결과를 옮길 때: 값은 증거 파일에서 그대로(요약·해석 금지), 해석은 칸 아래 한 줄로. 증거 파일 자체는 커밋하지 않는다(`.gitignore`) — 필요한 숫자만 이 표에.

## 4. 상태 머신 분기 판정 규칙

```
체크아웃(카드 수집, 트라이얼 구독, $0 거래) ──► trialing
   │
   ├─ 성공 predicate 참(§5)
   │     [A] POST /charge(immediately, $199) ─► 거래 completed ─► 트라이얼 끝 cancel 예약 유지 확인(S-C)
   │     [B] POST /activate($0 가격) ─► POST /charge ─► cancel 예약
   │
   ├─ 실패 · 45분 초과 · 예산 초과(D-7) · 킬스위치 ─► POST /cancel(immediately) ─► canceled, 청구 0 (S-B)
   │
   └─ 무응답으로 트라이얼 만료 ─► cancel 예약 있음: canceled, 청구 0 (S-F F2)
                               cancel 예약 없음: $19 자동 청구 위험 (S-F F1) ← Care 자동 부착 금지 위반
```

| 분기 | 판정 조건 (전부 참) | $-4 설계 귀결 |
|---|---|---|
| **A 직접 /charge** | S-A `/charge` 2xx ∧ 그 거래 `paid`/`completed` ∧ S-B 청구 0 | hold → predicate → trialing 구독에 `/charge` / 실패 → `cancel immediately`. 모든 카드 수집 구독에 체크아웃 직후 cancel 예약(S-F 결과에 따라) |
| **B activate 뒤 charge** | S-A 직접 `/charge` 거부 ∧ $0 가격 허용(setup) ∧ `activate`(trial0) 청구 0 ∧ 그 뒤 `/charge` 정산 ∧ S-B 청구 0 | 성공 시 activate → charge → cancel 예약. activate 뒤 구독은 active $0/월로 남으므로 잔존 구독 정리 필요 |
| **C 불성립** | S-B에서 청구 발생 ∨ (직접 거부 ∧ ($0 거부 ∨ activate 청구 > 0 ∨ activate 뒤 `/charge` 거부)) | 계획 §1.1 메커니즘 폐기. 대안 = 성공 시점 새 체크아웃(카드 재입력) · Paddle 서면 질의(§6) · 다른 MoR(Dodo on_demand — 계획 $-0 병행 항목, 이 PR 범위 밖) |
| pending | 그 밖(미실행·거래 미정산) | 판정 보류 — 결과 칸을 채우지 않는다 |

이 표는 코드로 고정돼 있다: `tools/paddle-spike/lib/observe.mjs` `decideBranch` ↔ `test/observe.test.mjs`. 표를 바꾸면 테스트도 같은 커밋에서 바꾼다.

분기와 별개로 **$-1 착수 전 확인해야 할 보조 관측**:
- S-C: `/charge`가 cancel 예약을 지우면 → $-4에서 청구 직후 cancel 예약을 다시 건다.
- S-F F1: 보호 없는 만료가 $19를 청구하면 → **모든 카드 수집 구독에 cancel 예약 필수**(D-23 ⑤ 초안 "Care 자동 부착 금지"의 집행 방법). $0 가격이 허용되면 카드 수집 가격을 $0으로 바꿔 위험 자체를 없앤다.
- S-D: 같은 구독 재청구가 되면 S2 수리 $29도 같은 구독으로 — 안 되면 청구마다 새 체크아웃.
- S-E: 환불 수수료 숫자 → D-22 가격 공식의 환불 항(계획 §5.5 ⑦) 재확인.
- F10: 구독당 20회/시간 — 1회 청구 = 최대 3회 시도(D-23 ② 초안)와 충돌 없음.

## 5. works-or-free 성공 predicate 초안

`$-4`에서 코드화한다(이 PR에는 코드 없음). D-23 ②(초안, 미잠금)와 D-9를 한 식으로:

```
charge_allowed(build) :=
      build.status     == "done"
  ∧   build.exit_code  == 0
  ∧   build.works      === true
  ∧ ( count(must AC where verifiedBy == "human") == 0      -- D-9: 기계 증거(build|test|browser)로 전부 통과
      ∨ user_verdict == "as_intended" )                    -- human AC가 있으면 사람 확인이 있어야 청구
  ∧   receipt.issued   == true                             -- 영수증(증거 묶음) 발행 뒤에만
```

- **무응답은 청구 근거가 아니다.** `user_verdict`가 기한(N일 [PILOT]) 안에 오지 않으면 청구하지 않고 cancel. 4값(`USER_VERDICTS` = `as_intended`·`works_but_different`·`still_broken`·`unsure`, `apps/central-plane/src/workspace/visual-check-db.ts`) 중 `as_intended`("생각대로 됐어요")만 청구, `works_but_different`는 7일 내 1회 재작업(계획 §2.4 S2 행과 같은 원칙).
- **반대편(무조건 cancel, 청구 0)**: 빌드 실패 · exit ≠ 0 · works ≠ true · 45분 초과 · 예산 상한(D-7) 도달 · 킬스위치.
- 멱등: 청구 키 = `build_id`(billing_charges, $-1). 1회 청구 = 최대 3회 시도(`on_payment_failure`·재시도 정책은 S-A 결과로 정한다).
- 청구 전 동의 ②(조건부 청구 체크박스)는 결제 화면($-3)에서 — Paddle 체크아웃은 "성공 시 $199" 조건을 표시하지 않는다(계획 §4).

## 6. 남는 미검증

샌드박스로도 풀리지 않는 것:

1. **라이브 동작 차이** — 결제 실패율, 3DS/SCA, 레이트 리밋, 환불 자동 승인 조건(계정 검증 전엔 `pending_approval`). 첫 실청구는 $-7(Bae 본인 카드 S2 $29 + 환불 왕복)에서만 확인.
2. **3DS 카드의 서버 청구** — 체크아웃 때 3DS를 통과한 카드에 나중에 서버가 `/charge`하면 추가 인증이 필요해 실패하는가. 샌드박스 3DS 카드(`4000 0038 0000 0446`)로 볼 수 있으나 이번 도구에는 없다(S-G 후보, 미구현).
3. **AUP·체크아웃 고지 요건** — works-or-free가 Paddle 정책상 허용되는가, 체크아웃에 무엇을 표시해야 하는가(아래 질의 ①).
4. 청구 주체 관련 3건(질의 ②③④) — 계획 §3.
5. **Dodo on_demand 병행 비교**(계획 $-0 행) — 이 PR 범위 밖.

### sellers@paddle.com 서면 질의 4건 (EN 초안)

> 발송은 **외부 발송 = 건별 개별 승인**(표준 문구 없음). Bae 승인 전 발송 금지. 청구 주체(결정 ⑤)가 확정된 뒤 ②③④의 명의를 채운다.

**Subject:** Pre-onboarding questions — conditional one-time charges on trialing subscriptions (Simsa)

Hello Paddle Seller team,

We are preparing to sell Simsa, a software service that builds and independently verifies web apps for non-developers, through Paddle Billing. Before we apply for a live account we would like written confirmation on four points.

1. **Charging only on success ("works-or-free").** We plan to collect a payment method through a trial-subscription checkout (a price with a 30-day trial, `requires_payment_method` left as `true`). If — and only if — our service delivers a working build, we would bill a one-time, non-recurring price with `POST /subscriptions/{id}/charge` (`effective_from: immediately`) while the subscription is still `trialing`. If the build fails, we cancel the subscription immediately and the customer pays nothing; a cancellation at the end of the trial is scheduled in every case, so the trial never converts to a recurring plan. The condition and the amount are disclosed on our own payment page and in our terms before checkout. Is this model acceptable under the Acceptable Use Policy and your checkout terms? Is there anything we must additionally display in the checkout, and are there limits beyond the documented 20 chargeable updates per subscription per hour?
2. **Legal name on receipts.** The seller account would be registered to a Korean sole proprietorship whose registered trade name differs from our product brand "Simsa". Can the trade name be used as the business name on customer receipts and in checkout, with "Simsa" shown as the product name?
3. **Tax form.** As a sole proprietor resident in the Republic of Korea with no US presence, should we submit W-8BEN (individual) or W-8BEN-E (entity) for payouts, and do you apply US–Korea treaty benefits?
4. **Transfer on incorporation.** If we later incorporate (a Korean corporation or a Delaware C-Corp), what is the procedure to transfer the seller account, active and trialing subscriptions with saved payment methods, and payout history to the new entity? Is re-verification required, and would customers need to re-enter their payment details?

Thank you,
[Name] — [Business name], Republic of Korea

---

## 7. 이 PR의 보고 (세 칸)

| 라이브 확인 | 테스트만 | 미측정 |
|---|---|---|
| 없음 | 도구 테스트 131개 통과(네트워크 0 — 가짜 fetch 주입·자식 프로세스 fetch 차단·메모리 가짜 Paddle 글루 스모크) · 가드를 하나씩 없앤 변이 9개를 테스트가 전부 잡음 | §3의 모든 칸(샌드박스 키 대기) · 체크아웃 자동화의 입력 칸 셀렉터(첫 실행 전 추정) · Q1~Q12 전부 |

글루 스모크의 가짜 Paddle은 "trialing `/charge` → 즉시 completed"를 **가정**한다. 그래서 스모크에서 나온 분기 A는 배선 확인일 뿐 판정이 아니다.

프로덕션 코드 변경 0 · 실결제 0 · `BILLING_ENABLED` 등 과금 런타임 영향 없음.

## 8. 다음

Bae 3줄(README) → 에이전트가 README 실행 순서대로 실행 → §3 채움 → §4 분기 확정 → D-23 문안 조정 → `design lock approved`(과금) → $-1.
