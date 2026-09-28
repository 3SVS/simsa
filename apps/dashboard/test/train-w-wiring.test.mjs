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
  assert.match(listPage, /errorNoticeText\(t\.visualChecks\.runErrors, notice\.errorKey, notice\.resetAt, locale\)/);
  assert.ok(!/t\.visualChecks\.runErrors\[notice\.errorKey\]/.test(listPage), "raw runErrors[...] lookup drops resetAt");
  assert.match(listPage, /runErrorTone\(notice\.errorKey\)/);
});

test("W-2b: 리포트 상세 — 재검수와 [고치기]가 본문 전체를 매핑하고 사전 문구에 resetAt을 넣는다", () => {
  assert.match(detailPage, /runErrorNotice\(res\)/);
  assert.match(detailPage, /repairErrorNotice\(res\)/);
  assert.match(detailPage, /errorNoticeText\(t\.visualChecks\.runErrors, notice\.errorKey, notice\.resetAt, locale\)/);
  assert.match(detailPage, /errorNoticeText\(s\.errors, errorNotice\.errorKey, errorNotice\.resetAt, locale\)/);
  assert.ok(!/t\.visualChecks\.runErrors\[notice\.errorKey\]/.test(detailPage), "raw runErrors lookup");
  assert.ok(!/s\.errors\[errorKey\]/.test(detailPage), "raw repair errors lookup");
  assert.match(detailPage, /repairErrorTone\(errorNotice\.errorKey\)/);
});

test("W-2c: 새 프로젝트의 자동 첫 검수가 상한·일시 중지면 토스트로 알린다", () => {
  const i = newPage.indexOf("await runVisualCheck(id, { userKey, locale })");
  assert.ok(i >= 0, "auto first inspection call");
  const tail = newPage.slice(i, i + 900);
  assert.match(tail, /runErrorNotice\(/);
  assert.match(tail, /isServiceGateKey\(/);
  assert.match(tail, /toast\.error\(errorNoticeText\(t\.visualChecks\.runErrors/);
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
