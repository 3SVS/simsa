> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 47 — progress-emit flaky 테스트 안정화

목표: `progress-emit.test.mjs`의 "emits in parallel" 테스트에서 관찰된 타이밍 의존 flaky 제거. 제품 기능 변경 없음 — 테스트 hardening만.

기준 커밋: Stage 46 `9aa6544` 이후.

---

## 1. flaky 현상

`packages/cli/test/progress-emit.test.mjs`
테스트명: **`emitProgress: emits to all notifiers in parallel (Promise.all semantics)`**

Stage 45 중 1차 full-parallel `node --test` 실행에서 1회 실패, isolation/재실행/CI에서는 통과. CI 병렬 부하나 배포 타이밍에 따라 재발 가능 → 제품 기능 추가 전 선제 안정화.

---

## 2. 원인 분류

**B. timer/fixed delay 의존** (+ 그로 인한 A. event 순서 의존)

기존 테스트:
```js
const make = (id, delay) => ({ ..., async notifyProgress() {
  await new Promise((r) => setTimeout(r, delay)); order.push(id);
}});
await emitProgress([make("a",30), make("b",10), make("c",20)], ...);
assert.deepEqual(order, ["b","c","a"]); // delay 순서 가정
```
완료 순서를 `setTimeout` 10/20/30ms의 발화 순서로 단언. CPU/이벤트루프가 혼잡하면 가까운 타이머들의 콜백 순서가 밀려 `["b","c","a"]`가 깨질 수 있음.

---

## 3. 실제 원인

- 제품 코드(`packages/cli/src/lib/progress-emit.ts`)는 `Promise.all`로 **정상적으로 parallel** 실행 — **버그 아님**.
- flaky는 순수하게 **테스트가 wall-clock 타이머 발화 순서에 완료 순서를 묶어둔 것**. 부하 시 타이머 skew로 race.

---

## 4. 수정한 파일

- `packages/cli/test/progress-emit.test.mjs` (테스트만). 제품 코드 변경 없음.

---

## 5. 수정 방식 (controlled deferred)

타이머 제거, 명시적 deferred로 실행/완료를 제어:

- 헬퍼 `createDeferred()` — 외부에서 resolve 가능한 promise.
- 헬퍼 `waitForEventCount({events, count, timeoutMs})` — count 도달까지 `setImmediate` 폴링으로 진행(고정 delay 아님). timeout은 **무한 대기 방지 guard**일 뿐 정상 경로 아님 → 순서 race 유발 안 함.

새 테스트 구조:
1. 각 notifyProgress: `started.push(id)` → `gates[id].promise` await → `completed.push(id)`.
2. `emitProgress(...)` 호출하되 **await 하지 않음** (3개 in-flight).
3. **parallelism 증명(deterministic)**: `waitForEventCount(started, 3)` — 셋 다 *완료 전에 시작*. serial이면 "a"만 시작하고 block → waitForEventCount가 timeout으로 **테스트 실패**(검증 의미 유지). started는 순서 독립(`.sort()` 비교).
4. `completed.length === 0` 확인 (release 전 아무도 완료 안 함).
5. `gates.b → c → a` 순으로 release, 각 완료를 기다린 뒤 다음 release → 완료 순서가 **우리가 제어**한 deterministic 값.
6. `assert.deepEqual(completed, ["b","c","a"])` — 타이머 아닌 release 순서 기반.

**검증 의미 유지**: "모든 notifier가 완료 전에 시작한다"(=Promise.all parallel)를 timer 없이 deterministic하게 증명. 기대값을 약화시키지 않음.

---

## 6. 반복 실행 결과

- 단일 테스트 **20회 연속** 통과.
- full-parallel `node --test --test-reporter=tap` **3회** 모두 3439/3439 pass (원래 flaky 발생 조건 재현 — 무실패).
- parallel 테스트 소요: 43ms(타이머) → ~8ms(deferred).

---

## 7. 전체 test/typecheck/build 결과

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3439 / 3439 pass** (테스트 수 동일, flaky만 안정화) |
| full-parallel 3회 재현 | 3439/3439 × 3, 무실패 |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |

---

## 8. CI Node 20/22 결과

push `0e217b3` 후 ci.yml: **typecheck-build (20) success, (22) success**. parallel 테스트 재발 없음.

---

## 9. Stage 48에서 이어서 할 일

1. 다른 타이머/race 의존 테스트 audit (선택) — `setTimeout`/`Promise.race`/고정 delay에 순서·길이를 단언하는 테스트 전수 점검.
2. (이월) fromRunId-only 비교 comment(Policy B, Stage 46), AutoComparisonPanel from→to 강화(Stage 45), 서버 저장(Stage 44).
3. 라이브 Vercel에서 Stage 40~46 UX 확인 (Bae).
4. (Stage 39 이월) release.yml node-version "20" EOL 대응.
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
