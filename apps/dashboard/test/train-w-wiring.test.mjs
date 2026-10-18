/**
 * Train W — 화면 배선 정적 검사 (train-c-wiring.test.mjs 방식: 소스를 grep 한다).
 *
 * 순수 함수가 맞아도 화면이 옛 경로(`t.visualChecks.runErrors[notice.errorKey]`)로 그리면
 * resetAt이 버려지고, 수리 잡의 buildVerified는 아무도 읽지 않는다. 각 검사는 고치기 전 코드에서
 * 실패한다.
 *
 *  W-2a 검수 목록의 [지금 검수하기]가 응답 본문 전체를 runErrorNotice로 매핑하고 errorNoticeText로 그린다
 *  W-2b 리포트 상세의 재검수(useRecheck)·[고치기]도 같은 경로 — 수리는 repairErrorNotice
 *  W-2c 새 프로젝트의 자동 첫 검수가 상한·일시 중지에 막히면 조용히 삼키지 않는다(토스트)
 *  W-2d 알림에 받은 시각(receivedAt)을 저장해 '지금 다시'를 리셋 전에 받은 알림에만 (#558 검증 2차 P2-1)
 *  W-3a 진행 화면: queued면 queued 전용 본문, 수리 대기도 마찬가지
 *  W-3b 수리 완료 카드: showBuildUnverified → buildUnverified 1줄, repairDoneKind → auto_fix 문구
 *  API  429/503 본문 필드(kind·limit·resetAt)와 잡 뷰 buildVerified·mode가 타입에 있다(옛 서버: 선택 필드)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const listPage = read("app/projects/[id]/visual-checks/page.tsx");
const detailPage = read("app/projects/[id]/visual-checks/[runId]/page.tsx");
const newPage = read("app/projects/new/page.tsx");
const api = read("lib/workspace-visual-checks-api.ts");

test("W-2a: 검수 목록 — runErrorNotice(res)로 매핑하고 errorNoticeText로 그린다 (resetAt 전달)", () => {
  assert.match(listPage, /runErrorNotice\(res\)/);
  // #558 검증 P2-11: 네 번째 인자는 locale이 아니라 사전 조각(t.visualChecks.resetWhen).
  assert.match(listPage, /errorNoticeText\(t\.visualChecks\.runErrors, notice\.errorKey, notice\.resetAt, t\.visualChecks\.resetWhen\b/);
  assert.ok(!/t\.visualChecks\.runErrors\[notice\.errorKey\]/.test(listPage), "raw runErrors[...] lookup drops resetAt");
  assert.match(listPage, /runErrorTone\(notice\.errorKey\)/);
});

test("W-2b: 리포트 상세 — 재검수와 [고치기]가 본문 전체를 매핑하고 사전 문구에 resetAt을 넣는다", () => {
  assert.match(detailPage, /runErrorNotice\(res\)/);
  assert.match(detailPage, /repairErrorNotice\(res\)/);
  assert.match(detailPage, /errorNoticeText\(t\.visualChecks\.runErrors, notice\.errorKey, notice\.resetAt, t\.visualChecks\.resetWhen\b/);
  assert.match(detailPage, /errorNoticeText\(s\.errors, errorNotice\.errorKey, errorNotice\.resetAt, t\.visualChecks\.resetWhen\b/);
  assert.ok(!/t\.visualChecks\.runErrors\[notice\.errorKey\]/.test(detailPage), "raw runErrors lookup");
  assert.ok(!/s\.errors\[errorKey\]/.test(detailPage), "raw repair errors lookup");
  assert.match(detailPage, /repairErrorTone\(errorNotice\.errorKey\)/);
});

// #558 검증 2차 P2-1 — '지금 다시 할 수 있어요'(dailyLimitCleared)는 리셋 **전에** 받은 알림이 리셋을 넘겨
// 떠 있을 때만이다. 그 판정에는 응답을 받은 시각이 필요하다: 알림을 만드는 곳(응답 직후)에서
// receivedAt: Date.now()를 함께 저장하고, 그리는 곳에서 errorNoticeText에 넘긴다. 빠뜨리면 lib는
// 안전하게 '지금 다시'를 내지 않지만(상한 문장 유지), 알림이 리셋을 넘겨 떠 있는 경우의 안내를 잃는다.
test("W-2d: 알림을 만드는 곳은 받은 시각(receivedAt)을 함께 저장하고, 그리는 곳은 그 값을 넘긴다", () => {
  // 검수 목록
  assert.match(listPage, /\.\.\.runErrorNotice\(res\), receivedAt: Date\.now\(\)/);
  assert.match(listPage, /t\.visualChecks\.resetWhen, \{ receivedAt: notice\.receivedAt \}\)/);
  assert.match(listPage, /kind: "error"; errorKey: RunErrorKey; resetAt: string \| null; receivedAt: number/);
  // 리포트 상세 — 재검수
  assert.match(detailPage, /\.\.\.runErrorNotice\(res\), receivedAt: Date\.now\(\)/);
  assert.match(detailPage, /t\.visualChecks\.resetWhen, \{ receivedAt: notice\.receivedAt \}\)/);
  assert.match(detailPage, /kind: "error"; errorKey: RunErrorKey; resetAt: string \| null; receivedAt: number/);
  // 리포트 상세 — [고치기]
  assert.match(detailPage, /\.\.\.repairErrorNotice\(res\), receivedAt: Date\.now\(\)/);
  assert.match(detailPage, /t\.visualChecks\.resetWhen, \{ receivedAt: errorNotice\.receivedAt \}\)/);
  assert.match(detailPage, /errorKey: RepairErrorKey; resetAt: string \| null; receivedAt: number/);
  // 받은 시각 없이 그리는 곳이 남아 있지 않다(토스트 제외 — 아래 W-2c).
  for (const [name, src] of [["list", listPage], ["detail", detailPage]]) {
    const bare = [...src.matchAll(/errorNoticeText\([^)]*t\.visualChecks\.resetWhen\)/g)].map((m) => m[0]);
    assert.deepEqual(bare, [], `${name}: errorNoticeText without receivedAt`);
  }
});

// #558 검증 P2-4·P2-14 — 이 안내는 runErrorTone이 'info'로 정한 두 경우(상한·일시 중지)인데 빨간
// error 토스트(role=alert, 3초)로 뜨고 곧바로 화면을 옮겨 놓치기 쉬웠다 → info 톤 + 오래 머문다.
test("W-2c: 새 프로젝트의 자동 첫 검수가 상한·일시 중지면 info 토스트로, 충분히 오래 알린다", () => {
  const i = newPage.indexOf("await runVisualCheck(id, { userKey, locale");
  assert.ok(i >= 0, "auto first inspection call");
  const tail = newPage.slice(i, i + 900);
  assert.match(tail, /runErrorNotice\(/);
  assert.match(tail, /isServiceGateKey\(/);
  assert.match(tail, /toast\.info\(\s*errorNoticeText\(t\.visualChecks\.runErrors/);
  assert.match(tail, /duration: SERVICE_GATE_TOAST_MS/);
  assert.ok(!/toast\.error\(\s*errorNoticeText/.test(tail), "red error toast for a non-error notice");
});

// #558 검증 2차 P2-1 — 토스트는 응답을 받는 순간 한 번만 문장을 만든다. 그 순간 '지금 다시 할 수 있어요'가
// 나오는 경우는 (시계 차이로) 방금 거절된 경우뿐이므로 receivedAt을 넘기지 않는다 → lib가 cleared를 내지 않는다.
test("[행동 보존] W-2c: 새 프로젝트 토스트는 받은 시각을 넘기지 않는다 (받는 순간 계산 — 'cleared' 경로 없음)", () => {
  const i = newPage.indexOf("await runVisualCheck(id, { userKey, locale");
  const tail = newPage.slice(i, i + 900);
  const call = /errorNoticeText\(t\.visualChecks\.runErrors[^;]*?t\.visualChecks\.resetWhen\)/.exec(tail);
  assert.ok(call, "toast sentence call");
  assert.ok(!/receivedAt/.test(call[0]), call[0]);
});

test("Toast: info 변형이 있다 — 빨간색·role=alert가 아니다", () => {
  const toastTsx = read("components/Toast.tsx");
  assert.match(toastTsx, /\binfo: \(message: string/);
  assert.match(toastTsx, /variant: "info"/);
  assert.match(toastTsx, /toast\.variant === "info"/);
  assert.match(toastTsx, /role=\{toast\.variant === "error" \? "alert" : "status"\}/);
});

test("W-3a: 진행 화면 — queued는 queued 전용 본문(검수·수리)", () => {
  assert.match(detailPage, /check\.status === "queued" \? t\.visualChecks\.progressBodyQueued : t\.visualChecks\.progressBody/);
  assert.match(detailPage, /repair\.status === "queued" \? s\.progressBodyQueued : s\.progressBody/);
});

test("W-3b: 수리 완료 카드 — 빌드 미확인 1줄과 auto_fix 완료 문구", () => {
  assert.match(detailPage, /showBuildUnverified\(repair\) && \(/);
  assert.match(detailPage, /\{s\.buildUnverified\}/);
  assert.match(detailPage, /repairDoneKind\(repair\) === "autoFix"/);
  assert.match(detailPage, /s\.doneTitleAutoFix/);
  assert.match(detailPage, /s\.doneBodyAutoFix/);
});

test("API: 오류 본문 필드와 잡 뷰 필드가 타입에 있다 (전부 선택 — 옛 서버에서 없다)", () => {
  assert.match(api, /kind\?: "inspection" \| "repair"/);
  assert.match(api, /limit\?: number/);
  assert.match(api, /resetAt\?: string/);
  assert.match(api, /buildVerified\?: boolean \| null/);
  assert.match(api, /mode\?: string \| null/);
});
