# Current Task — KV 도입 스파이크

## 목표

Simsa live product(`apps/central-plane`)에 Cloudflare Workers KV를 작게 도입할 수 있는지 검증한다. D1/R2/DO의 역할은 유지하고, KV는 TTL 캐시·단기 lock·idempotency처럼 일시적인 데이터에만 쓴다.

## 승인 상태

- Bae 승인: 2026-10-01 — "KV 도입 스파이크"로 current-task 변경 승인.

## 절대 하지 말 것

- 프로덕션 deploy 하지 말 것.
- 원격 D1 migration 적용하지 말 것.
- secrets, 토큰, 실제 API 키를 파일·로그·커밋에 남기지 말 것.
- 결제/크레딧/영수증/DevSpec/build_jobs 같은 source-of-truth 데이터를 KV로 옮기지 말 것.
- 기존 CLI behavior 바꾸지 말 것.
- 대규모 리팩터링하지 말 것.
- 새 dependency 설치하지 말 것.

## 해야 할 일

1. Cloudflare KV binding 이름과 용도를 정한다.
2. `apps/central-plane/src/env.ts`에 optional KV binding 타입을 추가한다.
3. `apps/central-plane/wrangler.toml`에 KV binding placeholder를 추가한다. 실제 namespace id는 `결정 필요`로 남긴다.
4. 작은 KV helper를 추가한다. KV가 없으면 기존 동작으로 fail-open한다.
5. 첫 적용 지점은 D1 truth가 필요 없는 TTL 캐시 또는 단기 중복 방지로 제한한다.
6. 테스트를 추가해 KV binding 없음 / KV hit / KV miss / KV failure를 검증한다.
7. 문서에 "KV에 넣어도 되는 것 / 넣으면 안 되는 것"을 남긴다.

## 후보 적용 지점

우선순위:

1. Source reachability 또는 GitHub repo lookup 같은 짧은 TTL 캐시.
2. visual-check / repair 중복 클릭 방지용 단기 idempotency lock.
3. rate limit의 D1 부하를 줄이는 보조 캐시.

이번 스파이크에서는 1개만 고른다. 선택 기준은 코드 변경량이 작고, 실패 시 기존 D1/네트워크 경로로 돌아갈 수 있는가이다.

## 산출물

- 작고 리뷰 가능한 코드 변경.
- 테스트 추가.
- KV 도입 메모 또는 기존 문서 업데이트.

## 완료 조건

- `pnpm --filter @simsa/central-plane typecheck` 통과.
- 관련 테스트 통과.
- KV binding이 없어도 로컬/프로덕션 기존 동작이 깨지지 않는다.
- KV namespace id는 실제 값 없이 placeholder 또는 문서 지시만 남긴다.
