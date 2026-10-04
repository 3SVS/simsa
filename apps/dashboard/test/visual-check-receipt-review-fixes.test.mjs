/**
 * PR #572 검증 결함 수정 — C-3 확인 영수증 (재정렬 D-19 amend: 고친 주체 ≠ 판정 주체).
 *
 * 영수증은 인쇄·복사되어 제3자에게 가는 증빙이다. 그래서 "있는 사실만, 그 사실이 가리키는 것에만" 붙어야 한다.
 * 이 파일의 테스트는 검증에서 나온 결함을 하나씩 재현한다 — 고치기 전 코드(head 5b1f454)에서 실패한다
 * (행동 보존 가드는 이름에 '가드'라고 적었다).
 *
 *   [1] 수리보다 먼저 한 재검수를 '고친 뒤 다시 확인한 증거'로 붙이지 않는다(시간 순서)
 *   [2]·[4] 고침 지시서만 올린 수리(brief_only · 레거시 mode=null) 뒤 다음 할 일은 '고친 뒤 다시 확인'이 아니다
 *   [3]·[11] 재확인 문구는 이어진 방식대로 — 수리가 없거나 머지 뒤 재검수가 아니면 '고친 뒤'라고 말하지 않는다
 *   [5] 목록(최근 50개) 밖일 수 있는 재검수를 '아직 안 했다'로 부정하지 않는다
 *   [6] 직접 올린(local) 확인의 Ready는 로그인 뒤를 봤다는 뜻이 아니다 · 올린 기록이라고 적는다
 *   [9] '고친 내용' 머리말은 실패·진행 중·지시서만 올린 수리에도 맞는 말이다
 *   [10] 다시 확인이 진행 중이면 '결과 보기'가 아니라 '상황 보기'
 *   [12] '문제를 찾지 못했어요'를 영수증에서 '문제 없음'으로 부풀리지 않는다
 *   [13] 고친 코드가 아직 실제 앱에 없을 수 있다는 말이 인쇄·복사본에도 남는다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DICTIONARIES } from "../src/i18n/dictionary.mjs";
import { DEV_TERMS, devTermHits } from "../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs";
import { buildReceiptView, receiptPlainText } from "../src/lib/visual-check-receipt.mjs";
import * as receiptModule from "../src/lib/visual-check-receipt.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECEIPT_PAGE = path.resolve(HERE, "../src/app/projects/[id]/visual-checks/[runId]/receipt/page.tsx");
const BEGINNER_TERMS = [...DEV_TERMS, "저장소", "리포지토리", "repository", "브랜치", "branch", "commit", "커밋", "merge", "머지"];
const fmt = (iso) => iso.slice(0, 16).replace("T", " ");

// ─── 리얼 데이터 픽스처 (Rule 6) ─────────────────────────────────────────────────

const RUN = "wvc_빵집01";
const CHECK = {
  id: RUN,
  projectId: "proj_(주)트루픽셀",
  targetUrl: "https://truepixel-빵집.lovable.app/예약",
  intent: "손님이 빵을 골라 예약하고, 예약 목록에서 확인할 수 있어야 한다",
  decision: "Needs Fix",
  works: false,
  status: "done",
  executor: "container",
  evidenceKeys: [],
  createdAt: "2026-09-28T03:00:00.000Z",
  report: {
    intent: "손님이 빵을 골라 예약하고, 예약 목록에서 확인할 수 있어야 한다",
    findings: [{ severity: "high", what: "예약 버튼을 눌러도 아무 일도 없어요", why: "", how: "" }],
  },
  userVerdict: null,
  sourceCheckId: null,
};

/** 두 번째 수리 R2 — 06:00에 걸어 07:00에 끝남(코드 수정, 재검수 연결 없음). */
const R2 = {
  id: "wrj_2", visualCheckId: RUN, repoFullName: "truepixel/bakery", status: "done",
  branchName: "fix/simsa-wvc_빵집01-2", prUrl: "https://github.com/truepixel/bakery/pull/9", prNumber: 9,
  envCause: false, error: null, createdAt: "2026-09-28T06:00:00.000Z", updatedAt: "2026-09-28T07:00:00.000Z",
  mode: "auto_fix", changedFiles: 4, buildVerified: true, verifyCheckId: null, resolved: null,
};

/** 첫 수리 R1의 verify-sweep 재검수 V1 — 05:00, R2보다 먼저(작동 안 함). */
const V1 = {
  id: "wvc_v1", targetUrl: CHECK.targetUrl, decision: "Needs Fix", works: false, status: "done",
  executor: "container", evidenceCount: 3, createdAt: "2026-09-28T05:00:00.000Z", sourceCheckId: RUN, userVerdict: null,
};

const recheckAt = (id, createdAt, patch = {}) => ({ ...V1, id, createdAt, ...patch });

/** 영수증 글에서 한 섹션만 자른다(다음 '[' 머리까지). */
function section(text, title) {
  const at = text.indexOf(`[${title}]`);
  if (at < 0) return "";
  const rest = text.slice(at + title.length + 2);
  const end = rest.indexOf("\n[");
  return end < 0 ? rest : rest.slice(0, end);
}

// ─── [1] 시간 순서 ───────────────────────────────────────────────────────────────

describe("[1] 수리보다 먼저 한 재검수는 그 수리의 증거가 아니다", () => {
  it("★두 번째 수리 + 첫 수리의 verify 런(수리보다 앞섬) → 재검수 '아직 없음' · 다음 할 일 = 고친 뒤 다시 확인", () => {
    const v = buildReceiptView({ check: CHECK, repair: R2, checks: [V1] });
    assert.equal(v.fix.changesUrl, R2.prUrl);
    assert.deepEqual(v.recheck, { state: "none" }, "05:00 확인은 06:00에 건 수리를 판정하지 않았다");
    assert.deepEqual(v.nextAction, { kind: "recheckAfterFix" });
  });

  it("★'다시 확인'을 먼저 누르고 나서 수리를 요청했으면, 그 확인은 이 수리의 증거가 아니다", () => {
    const early = recheckAt("wvc_먼저", "2026-09-28T04:00:00.000Z");
    const v = buildReceiptView({ check: CHECK, repair: R2, checks: [early] });
    assert.deepEqual(v.recheck, { state: "none" });
  });

  it("★수리가 진행되는 동안 시작한 확인도 증거가 아니다(수리가 끝난 뒤에 시작한 확인만)", () => {
    const during = recheckAt("wvc_도중", "2026-09-28T06:30:00.000Z");
    assert.deepEqual(buildReceiptView({ check: CHECK, repair: R2, checks: [during] }).recheck, { state: "none" });
    const active = { ...R2, status: "running", updatedAt: "2026-09-28T06:10:00.000Z", prUrl: null };
    const v = buildReceiptView({ check: CHECK, repair: active, checks: [during] });
    assert.deepEqual(v.recheck, { state: "none" }, "아직 고치는 중이면 어떤 확인도 이 수리를 판정하지 않았다");
    assert.deepEqual(v.nextAction, { kind: "viewRepair" });
  });

  it("★인쇄·복사본: 수리보다 앞선 확인의 판정·시각이 '다시 확인한 증거'에 찍히지 않는다", () => {
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const text = receiptPlainText(buildReceiptView({ check: CHECK, repair: R2, checks: [V1] }), t, fmt);
      const re = section(text, r.recheckTitle);
      assert.ok(re.length > 0, `${loc}: the re-check section is there\n${text}`);
      assert.ok(!re.includes(fmt(V1.createdAt)), `${loc}: 05:00 must not be printed as evidence\n${re}`);
      assert.ok(!re.includes(r.recheckBy), `${loc}: no 'after the fix' verdict line\n${re}`);
      assert.ok(re.includes(r.recheckNone), `${loc}\n${re}`);
    }
  });

  it("가드: 수리가 끝난 뒤에 시작한 확인은 그대로 증거", () => {
    const after = recheckAt("wvc_뒤", "2026-09-28T08:00:00.000Z", { works: true, decision: "Ready" });
    const v = buildReceiptView({ check: CHECK, repair: R2, checks: [V1, after] });
    assert.equal(v.recheck.state, "done");
    assert.equal(v.recheck.runId, "wvc_뒤");
    assert.deepEqual(v.nextAction, { kind: "viewRecheck", runId: "wvc_뒤" });
  });

  it("가드: 수리 잡에 이어진 verify 런(verifyCheckId)은 시각과 상관없이 그 수리의 재검수", () => {
    const v = buildReceiptView({ check: CHECK, repair: { ...R2, verifyCheckId: "wvc_v1" }, checks: [V1] });
    assert.equal(v.recheck.runId, "wvc_v1");
    assert.equal(v.recheck.via, "afterFix");
  });
});

// ─── [2]·[4] 지시서만 올린 수리 ──────────────────────────────────────────────────

describe("[2]·[4] 고침 지시서만 올린 수리 뒤의 다음 할 일", () => {
  it("★brief_only가 끝났으면 다음 할 일은 '지시서를 넘겨 이어서 고치기' — '고친 뒤 다시 확인'이 아니다", () => {
    const brief = { ...R2, mode: "brief_only", changedFiles: null, buildVerified: null };
    const v = buildReceiptView({ check: CHECK, repair: brief, checks: [] });
    assert.equal(v.fix.kind, "briefOnly");
    assert.deepEqual(v.nextAction, { kind: "handOff" });
  });

  it("★Stage 270 이전 레거시 수리(mode=null)도 지시서 — handOff", () => {
    const legacy = { ...R2, mode: null, changedFiles: null, buildVerified: null };
    assert.deepEqual(buildReceiptView({ check: CHECK, repair: legacy, checks: [] }).nextAction, { kind: "handOff" });
  });

  it("가드: 코드를 바꾼 수리(auto_fix)만 '고친 뒤 다시 확인'", () => {
    assert.deepEqual(buildReceiptView({ check: CHECK, repair: R2, checks: [] }).nextAction, { kind: "recheckAfterFix" });
  });

  it("★handOff 문구(KO/EN)는 코드가 아직 바뀌지 않았다고 말하고, 개발 용어·점수가 없다", () => {
    for (const loc of ["ko", "en"]) {
      const r = DICTIONARIES[loc].visualChecks.receipt;
      assert.ok(r.next?.handOff?.trim(), `${loc}.next.handOff`);
      assert.ok(r.nextWhy?.handOff?.trim(), `${loc}.nextWhy.handOff`);
      for (const s of [r.next.handOff, r.nextWhy.handOff]) assert.deepEqual(devTermHits(s, { terms: BEGINNER_TERMS }), [], s);
    }
    assert.match(DICTIONARIES.ko.visualChecks.receipt.nextWhy.handOff, /아직 바뀌지 않았/);
    assert.match(DICTIONARIES.en.visualChecks.receipt.nextWhy.handOff, /hasn't changed|has not changed/i);
  });
});

// ─── [3]·[11] 재확인 문구 ─────────────────────────────────────────────────────────

describe("[3]·[11] 재확인 문구는 이어진 방식대로", () => {
  it("★수리가 없는 재확인: '고친 뒤'도 '고친 쪽'도 없는 중립 문구 · 수리를 전제하지 않는 제목", () => {
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const v = buildReceiptView({ check: CHECK, repair: null, checks: [recheckAt("wvc_재", "2026-09-28T04:00:00.000Z")] });
      assert.equal(v.fix, null);
      assert.equal(v.recheck.via, "sourceCheck");
      const text = receiptPlainText(v, t, fmt);
      assert.ok(r.recheckBySourceNoFix?.trim(), `${loc}.recheckBySourceNoFix`);
      assert.ok(text.includes(r.recheckBySourceNoFix), `${loc}\n${text}`);
      assert.ok(!text.includes(r.recheckBy), `${loc}: no fix-presupposing verdict line\n${text}`);
      assert.ok(r.recheckTitleNoFix?.trim() && r.recheckTitleNoFix !== r.recheckTitle, `${loc}.recheckTitleNoFix`);
      assert.ok(text.includes(`[${r.recheckTitleNoFix}]`), `${loc}\n${text}`);
    }
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.receipt.recheckBySourceNoFix, /고친/);
    assert.doesNotMatch(DICTIONARIES.en.visualChecks.receipt.recheckBySourceNoFix, /\bfix/i);
  });

  it("★수리가 있어도 sourceCheck로만 이어진 확인은 '고친 뒤'라고 단정하지 않는다(머지 전일 수 있다)", () => {
    const after = recheckAt("wvc_뒤", "2026-09-28T08:00:00.000Z");
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const text = receiptPlainText(buildReceiptView({ check: CHECK, repair: R2, checks: [after] }), t, fmt);
      assert.ok(r.recheckBySource?.trim(), `${loc}.recheckBySource`);
      assert.ok(text.includes(r.recheckBySource), `${loc}\n${text}`);
      assert.ok(!text.includes(r.recheckBy), `${loc}\n${text}`);
    }
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.receipt.recheckBySource, /고친 뒤/);
    assert.match(DICTIONARIES.ko.visualChecks.receipt.recheckBySource, /고친 쪽이 아니라/, "고친 주체 ≠ 판정 주체는 그대로 말한다");
    assert.doesNotMatch(DICTIONARIES.en.visualChecks.receipt.recheckBySource, /after the fix/i);
  });

  it("★머지 뒤 verify-sweep 재검수(afterFix)만 '고친 뒤' — KO/EN이 같은 뜻", () => {
    const t = DICTIONARIES.ko;
    const text = receiptPlainText(buildReceiptView({ check: CHECK, repair: { ...R2, verifyCheckId: "wvc_v2" }, checks: [recheckAt("wvc_v2", "2026-09-28T08:00:00.000Z")] }), t, fmt);
    assert.ok(text.includes(t.visualChecks.receipt.recheckBy), text);
    assert.match(DICTIONARIES.ko.visualChecks.receipt.recheckBy, /고친 뒤/);
    assert.match(DICTIONARIES.en.visualChecks.receipt.recheckBy, /after the fix/i, "EN도 '고친 뒤'를 말한다(KO와 같은 뜻)");
  });

  it("★수리가 없으면 '아직 다시 확인하지 않았어요' 문구도 '고친 내용'을 전제하지 않는다", () => {
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const text = receiptPlainText(buildReceiptView({ check: CHECK, repair: null, checks: [] }), t, fmt);
      assert.ok(r.recheckNoneNoFix?.trim(), `${loc}.recheckNoneNoFix`);
      assert.ok(text.includes(r.recheckNoneNoFix), `${loc}\n${text}`);
      assert.ok(!text.includes(r.recheckNone), `${loc}\n${text}`);
    }
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.receipt.recheckNoneNoFix, /고친 내용/);
  });
});

// ─── [5] 목록 상한 ────────────────────────────────────────────────────────────────

describe("[5] 목록(최근 50개) 밖일 수 있는 재검수", () => {
  const newer = Array.from({ length: 50 }, (_, i) => ({
    id: `wvc_n${String(i).padStart(2, "0")}`, targetUrl: CHECK.targetUrl, decision: "Needs Fix", works: false, status: "done",
    executor: "container", evidenceCount: 0, createdAt: new Date(Date.parse("2026-09-29T00:00:00.000Z") + i * 60_000).toISOString(),
    sourceCheckId: null, userVerdict: null,
  }));

  it("★목록이 50개로 가득 찼고 모두 이 확인보다 한참 뒤면 '아직 안 했다'고 부정하지 않는다 → unknown", () => {
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const v = buildReceiptView({ check: CHECK, repair: null, checks: newer });
      assert.deepEqual(v.recheck, { state: "unknown" });
      const text = receiptPlainText(v, t, fmt);
      assert.ok(r.recheckUnknown?.trim(), `${loc}.recheckUnknown`);
      assert.ok(text.includes(r.recheckUnknown), `${loc}\n${text}`);
      assert.ok(!text.includes(r.recheckNoneNoFix ?? "\u0000") && !text.includes(r.recheckNone), `${loc}\n${text}`);
    }
  });

  it("★수리가 있으면 '수리가 끝난 뒤' 구간이 목록 밖일 때도 unknown", () => {
    const v = buildReceiptView({ check: CHECK, repair: R2, checks: newer });
    assert.deepEqual(v.recheck, { state: "unknown" });
    assert.deepEqual(v.nextAction, { kind: "recheckAfterFix" }, "다시 확인은 언제든 할 수 있다");
  });

  it("가드: 목록이 50개 미만이면(전부 받았다) 없는 건 정말 없는 것 — none", () => {
    assert.deepEqual(buildReceiptView({ check: CHECK, repair: null, checks: newer.slice(0, 49) }).recheck, { state: "none" });
  });

  it("가드: 가득 찼어도 가장 오래된 항목이 기준 시각보다 앞서면 그 구간은 목록 안 — none", () => {
    const covering = [...newer.slice(0, 49), { ...newer[0], id: "wvc_old", createdAt: "2026-09-28T02:00:00.000Z" }];
    assert.deepEqual(buildReceiptView({ check: CHECK, repair: null, checks: covering }).recheck, { state: "none" });
  });
});

// ─── [6] 직접 올린 확인 ─────────────────────────────────────────────────────────

describe("[6] 직접 올린(local) 확인", () => {
  const ready = { ...CHECK, works: true, decision: "Ready", report: { intent: CHECK.intent, findings: [] } };

  it("★local 런의 Ready는 로그인 뒤를 봤다는 뜻이 아니다 — '못 본 것'에 로그인 뒤가 남는다", () => {
    const v = buildReceiptView({ check: { ...ready, executor: "local" }, repair: null, checks: [] });
    assert.ok(v.notSeen.some((n) => n.kind === "loginBehind"), JSON.stringify(v.notSeen));
  });

  it("★local 런의 영수증은 '직접 올린 기록'이라고 적는다(KO/EN · 화면과 글 모두)", () => {
    const v = buildReceiptView({ check: { ...ready, executor: "local" }, repair: null, checks: [] });
    assert.equal(v.uploaded, true);
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      assert.ok(t.visualChecks.receipt.uploadedNote?.trim(), `${loc}.uploadedNote`);
      assert.ok(receiptPlainText(v, t, fmt).includes(t.visualChecks.receipt.uploadedNote), loc);
    }
    assert.match(readFileSync(RECEIPT_PAGE, "utf8"), /r\.uploadedNote/);
  });

  it("컨테이너 런의 Ready는 (종전대로) 로그인 뒤를 '못 본 것'에서 빼고, 올린 기록 표기(새 필드 uploaded)는 없다", () => {
    const v = buildReceiptView({ check: ready, repair: null, checks: [] });
    assert.ok(!v.notSeen.some((n) => n.kind === "loginBehind"));
    assert.equal(v.uploaded, false);
    assert.ok(!receiptPlainText(v, DICTIONARIES.ko, fmt).includes(DICTIONARIES.ko.visualChecks.receipt.uploadedNote ?? "\u0000"));
  });
});

// ─── [9] '고친 내용' 머리말 ─────────────────────────────────────────────────────

describe("[9] '고친 내용' 머리말은 모든 수리 상태에 맞는 말", () => {
  it("★실패·진행 중·지시서만 올린 수리에도 '만든 변경'이 있다고 단정하지 않는다 (KO/EN)", () => {
    assert.doesNotMatch(DICTIONARIES.ko.visualChecks.receipt.fixBy, /변경|바꿨|바꾼|고쳤/);
    assert.doesNotMatch(DICTIONARIES.en.visualChecks.receipt.fixBy, /\bchanges?\b|\bmade\b|\bfixed\b/i);
    for (const repair of [{ ...R2, status: "failed" }, { ...R2, status: "running" }, { ...R2, mode: "brief_only", changedFiles: null }]) {
      for (const loc of ["ko", "en"]) {
        const t = DICTIONARIES[loc];
        const fx = section(receiptPlainText(buildReceiptView({ check: CHECK, repair, checks: [] }), t, fmt), t.visualChecks.receipt.fixTitle);
        assert.ok(fx.includes(t.visualChecks.receipt.fixBy), `${loc}/${repair.status}/${repair.mode}`);
        assert.ok(!fx.includes(t.visualChecks.receipt.fixAutoFix), `${loc}/${repair.status}/${repair.mode}`);
      }
    }
  });
});

// ─── [10] 다시 확인 진행 중 ───────────────────────────────────────────────────────

describe("[10] 다시 확인이 진행 중일 때의 다음 할 일", () => {
  it("★진행 중 → viewRecheckProgress(그 런으로) — 아직 없는 결과를 '결과 보기'로 약속하지 않는다", () => {
    const running = recheckAt("wvc_진행", "2026-09-28T08:00:00.000Z", { status: "running", works: null, decision: "" });
    const v = buildReceiptView({ check: CHECK, repair: null, checks: [running] });
    assert.equal(v.recheck.state, "active");
    assert.deepEqual(v.nextAction, { kind: "viewRecheckProgress", runId: "wvc_진행" });
    for (const loc of ["ko", "en"]) {
      const r = DICTIONARIES[loc].visualChecks.receipt;
      assert.ok(r.next?.viewRecheckProgress?.trim() && r.nextWhy?.viewRecheckProgress?.trim(), loc);
      assert.notEqual(r.next.viewRecheckProgress, r.next.viewRecheck);
    }
    assert.match(readFileSync(RECEIPT_PAGE, "utf8"), /viewRecheckProgress/, "the button goes to the running check");
  });
});

// ─── [12] 판정 라벨 ─────────────────────────────────────────────────────────────

describe("[12] '문제를 찾지 못했어요'를 영수증에서 부풀리지 않는다", () => {
  it("★KO 영수증의 Simsa 확인 결과(칩·글)는 '문제를 찾지 못함' — 표와 같은 말, '문제 없음'이 아니다", () => {
    const t = DICTIONARIES.ko;
    const r = t.visualChecks.receipt;
    const cr = { ...CHECK, works: null, decision: "Conditionally Ready", report: { intent: CHECK.intent, findings: [] } };
    const text = receiptPlainText(buildReceiptView({ check: cr, repair: null, checks: [] }), t, fmt);
    assert.ok(text.includes(`${r.resultLabel}: ${r.status.noProblemFound}`), text);
    assert.ok(!text.includes(t.visualChecks.worksNoProblems), text);
    assert.equal(typeof receiptModule.receiptVerdictLabel, "function");
    assert.equal(receiptModule.receiptVerdictLabel(null, "Conditionally Ready", t).label, r.status.noProblemFound);
    assert.equal(receiptModule.receiptVerdictLabel(null, "Conditionally Ready", t).tone, "clear");
    assert.match(readFileSync(RECEIPT_PAGE, "utf8"), /receiptVerdictLabel\(/, "the chip uses the receipt label too");
  });

  it("★다시 확인한 결과가 '문제를 찾지 못했어요'여도 같은 라벨", () => {
    const t = DICTIONARIES.ko;
    const cr = recheckAt("wvc_뒤", "2026-09-28T08:00:00.000Z", { works: null, decision: "Conditionally Ready" });
    const text = receiptPlainText(buildReceiptView({ check: CHECK, repair: R2, checks: [cr] }), t, fmt);
    assert.ok(text.includes(`${t.visualChecks.receipt.recheckResult}: ${t.visualChecks.receipt.status.noProblemFound}`), text);
    assert.ok(!text.includes(t.visualChecks.worksNoProblems), text);
  });

  it("receiptVerdictLabel(새 함수)의 작동/작동 안 함/확인 필요 라벨은 결과 화면과 같다", () => {
    const t = DICTIONARIES.ko;
    assert.equal(receiptModule.receiptVerdictLabel?.(true, "Ready", t).label, t.visualChecks.worksYes);
    assert.equal(receiptModule.receiptVerdictLabel?.(false, "Needs Fix", t).label, t.visualChecks.worksNo);
    assert.equal(receiptModule.receiptVerdictLabel?.(null, "Not Verified", t).label, t.visualChecks.worksUnknown);
  });
});

// ─── [13] 아직 실제 앱에 없을 수 있음 ──────────────────────────────────────────────

describe("[13] 고친 코드가 아직 실제 앱에 없을 수 있다는 말", () => {
  it("★코드를 바꾼 수리가 끝났고 머지 뒤 재검수 연결이 없으면, 인쇄·복사되는 '고친 내용'에 그 말이 남는다", () => {
    const v = buildReceiptView({ check: CHECK, repair: R2, checks: [] });
    assert.equal(v.fix.pendingLive, true);
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      assert.ok(r.fixPendingLive?.trim(), `${loc}.fixPendingLive`);
      assert.deepEqual(devTermHits(r.fixPendingLive, { terms: BEGINNER_TERMS }), [], r.fixPendingLive);
      const fx = section(receiptPlainText(v, t, fmt), r.fixTitle);
      assert.ok(fx.includes(r.fixPendingLive), `${loc}\n${fx}`);
    }
    assert.match(readFileSync(RECEIPT_PAGE, "utf8"), /fix\.pendingLive/);
  });

  it("머지 뒤 재검수가 이어졌거나(verifyCheckId) 코드를 바꾸지 않은 수리면 그 말을 하지 않는다(pendingLive=false)", () => {
    assert.equal(buildReceiptView({ check: CHECK, repair: { ...R2, verifyCheckId: "wvc_v2" }, checks: [] }).fix.pendingLive, false);
    assert.equal(buildReceiptView({ check: CHECK, repair: { ...R2, mode: "brief_only" }, checks: [] }).fix.pendingLive, false);
    assert.equal(buildReceiptView({ check: CHECK, repair: { ...R2, status: "failed" }, checks: [] }).fix.pendingLive, false);
  });
});
