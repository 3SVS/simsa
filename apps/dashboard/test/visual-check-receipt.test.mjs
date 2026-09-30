/**
 * Train C · C-3 — 확인 영수증 (재정렬 D-19 amend: 수리 diff 섹션 ≠ 재검수 증거 섹션 · 고친 주체 ≠ 판정 주체).
 *
 * 마이그레이션 없이 기존 GET 상세 · 수리 잡 · 목록 API만 조합한다. 그 조합을 순수 함수(buildReceiptView ·
 * receiptPlainText)로 고정하고, 화면은 그 결과를 그리기만 한다.
 *
 * 고정하는 것:
 *   ① 확인한 주소 · 의도 · 시각 · Simsa 판정 · 사람 판정(없으면 null) · 출처(재검수면 원 런)
 *   ② 항목 표: 지시서 확인 항목이 있으면 통과/작동 안 함/확인 못 함(시간 부족 항목은 표가 아니라 '못 본 것'),
 *      없으면 핵심 흐름 한 줄(판정에서 도출, '문제를 찾지 못함'을 통과로 부풀리지 않는다)
 *   ③ 못 본 것: 로그인 뒤(확언 판정 Ready가 아니면 항상) · 시간 부족 항목 · 따라가지 않은 흐름
 *   ④ ★고친 내용(수리 잡: 고친 내용 링크·바뀐 파일 수·기본 점검)과 다시 확인한 증거(source_check_id /
 *      verifyCheckId로 이어진 재검수 런의 판정)는 서로 다른 섹션 — 한쪽 필드가 다른 쪽에 섞이지 않는다
 *   ⑤ 다음 할 일은 하나
 *   ⑥ 레거시 런(리포트 없음·새 필드 없음)·진행 중·실패 런도 깨지지 않는다
 *   ⑦ 사전 KO/EN 파리티 · 초보자 금칙어 0 · 숫자 점수 0 · 정직 문구
 *   ⑧ 배선: 결과 화면 → 영수증 링크, 영수증 화면은 순수 함수를 거친다, 채운 버튼은 하나
 *
 * 이 파일은 고치기 전 코드에서 실패한다(모듈·사전 키·화면이 없다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DICTIONARIES } from "../src/i18n/dictionary.mjs";
import { DEV_TERMS, devTermHits } from "../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs";
import { assertNoNumericScores } from "../../../tools/simsa-completion-loop-spike/lib/receipt.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const receipt = await import("../src/lib/visual-check-receipt.mjs").catch(() => null);

const BEGINNER_TERMS = [...DEV_TERMS, "저장소", "리포지토리", "repository", "repositories", "브랜치", "branch", "commit", "커밋", "merge", "머지"];

function mod() {
  assert.ok(receipt, "src/lib/visual-check-receipt.mjs must exist");
  return receipt;
}

// ─── 리얼 데이터 픽스처 (Rule 6: 한글·특수문자) ──────────────────────────────────

const RUN = "wvc_빵집01";
const BASE = {
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
    acceptance: {
      total: 4, noProblem: 1, notConfirmed: 1, broken: 1, notRun: 1,
      items: [
        { acceptanceId: "AC-1", featureTitle: "빵 고르기", then: "장바구니에 담긴다", status: "no_problem" },
        { acceptanceId: "AC-2", featureTitle: "예약하기", then: "예약 완료 화면이 뜬다", status: "broken" },
        { acceptanceId: "AC-3", featureTitle: "예약 목록", then: "방금 예약이 목록에 보인다", status: "not_confirmed" },
        { acceptanceId: "AC-4", featureTitle: "예약 취소", then: "취소하면 목록에서 사라진다", status: "not_run" },
      ],
    },
  },
  userVerdict: "still_broken",
  sourceCheckId: null,
};

const REPAIR_AUTO = {
  id: "wrj_1", visualCheckId: RUN, repoFullName: "truepixel/bakery", status: "done",
  branchName: "fix/simsa-wvc_빵집01", prUrl: "https://github.com/truepixel/bakery/pull/12", prNumber: 12,
  envCause: false, error: null, createdAt: "2026-09-28T03:10:00.000Z", updatedAt: "2026-09-28T03:20:00.000Z",
  mode: "auto_fix", changedFiles: 3, buildVerified: true, verifyCheckId: null, resolved: null,
};

const RECHECK_ITEM = {
  id: "wvc_빵집02", targetUrl: BASE.targetUrl, decision: "Conditionally Ready", works: null, status: "done",
  executor: "container", evidenceCount: 4, createdAt: "2026-09-28T05:00:00.000Z", sourceCheckId: RUN, userVerdict: null,
};

// ─── ① ② ③ 기본 뷰 ─────────────────────────────────────────────────────────────

describe("① ② ③ 확인한 것 · 항목 표 · 못 본 것", () => {
  it("★지시서 항목이 있으면 통과/작동 안 함/확인 못 함 — 시간 부족(not_run)은 표가 아니라 '못 본 것'으로", () => {
    const v = mod().buildReceiptView({ check: BASE, repair: null, checks: [] });
    assert.equal(v.state, "ready");
    assert.deepEqual(v.checked, { targetUrl: BASE.targetUrl, intent: BASE.report.intent, at: BASE.createdAt });
    assert.deepEqual(v.verdict, { works: false, decision: "Needs Fix" });
    assert.equal(v.userVerdict, "still_broken");
    assert.equal(v.source, null);
    assert.equal(v.items.basis, "acceptance");
    assert.deepEqual(v.items.rows, [
      { title: "빵 고르기", expected: "장바구니에 담긴다", status: "pass" },
      { title: "예약하기", expected: "예약 완료 화면이 뜬다", status: "broken" },
      { title: "예약 목록", expected: "방금 예약이 목록에 보인다", status: "notConfirmed" },
    ]);
    const kinds = v.notSeen.map((n) => n.kind);
    assert.deepEqual(kinds, ["loginBehind", "notReached", "otherPaths"]);
    assert.deepEqual(v.notSeen[1].titles, ["예약 취소"]);
  });

  it("지시서 항목이 없으면 핵심 흐름 한 줄 — 판정에서 도출(작동/안 됨/문제 못 찾음/확인 못 함)", () => {
    const { buildReceiptView } = mod();
    const noAc = { ...BASE, report: { ...BASE.report, acceptance: undefined } };
    const row = (patch) => buildReceiptView({ check: { ...noAc, ...patch }, repair: null, checks: [] }).items;
    assert.deepEqual(row({}), { basis: "coreFlow", rows: [{ title: BASE.report.intent, expected: null, status: "broken" }] });
    assert.equal(row({ works: true, decision: "Ready" }).rows[0].status, "pass");
    assert.equal(row({ works: null, decision: "Conditionally Ready" }).rows[0].status, "noProblemFound", "'문제를 찾지 못함'을 통과로 부풀리지 않는다");
    assert.equal(row({ works: null, decision: "User Acceptance Required" }).rows[0].status, "notConfirmed");
    // 빈 acceptance.items도 핵심 흐름으로.
    const emptyAc = { ...BASE, report: { ...BASE.report, acceptance: { total: 0, noProblem: 0, notConfirmed: 0, broken: 0, notRun: 0, items: [] } } };
    assert.equal(buildReceiptView({ check: emptyAc, repair: null, checks: [] }).items.basis, "coreFlow");
  });

  it("★로그인 뒤는 확언 판정(Ready — 로그인 왕복까지 확인된 유일한 판정)일 때만 '못 본 것'에서 빠진다", () => {
    const { buildReceiptView } = mod();
    const ready = buildReceiptView({ check: { ...BASE, works: true, decision: "Ready", report: { intent: "x", findings: [] } }, repair: null, checks: [] });
    assert.ok(!ready.notSeen.some((n) => n.kind === "loginBehind"));
    assert.ok(ready.notSeen.some((n) => n.kind === "otherPaths"), "따라가지 않은 흐름은 언제나 못 본 것");
    for (const decision of ["Conditionally Ready", "Needs Fix", "Not Verified", "User Acceptance Required"]) {
      const v = buildReceiptView({ check: { ...BASE, works: null, decision }, repair: null, checks: [] });
      assert.equal(v.notSeen[0].kind, "loginBehind", decision);
    }
  });

  it("재검수 런이면 출처(원 런 id)를 싣는다", () => {
    const v = mod().buildReceiptView({ check: { ...BASE, id: "wvc_빵집02", sourceCheckId: RUN }, repair: null, checks: [] });
    assert.deepEqual(v.source, { runId: RUN });
  });
});

// ─── ④ 고친 내용 ≠ 다시 확인한 증거 ──────────────────────────────────────────────

describe("④ 고친 내용과 다시 확인한 증거는 서로 다른 섹션", () => {
  it("★수리 잡(auto_fix)은 '고친 내용'에만: 고친 내용 링크·바뀐 파일 수·기본 점검 — 판정 필드 없음", () => {
    const v = mod().buildReceiptView({ check: BASE, repair: REPAIR_AUTO, checks: [RECHECK_ITEM] });
    assert.deepEqual(v.fix, {
      status: "done", kind: "autoFix", changesUrl: REPAIR_AUTO.prUrl, changedFiles: 3, buildCheck: "passed", envCause: false,
    });
    for (const k of ["works", "decision", "verdict", "runId", "resolved"]) assert.ok(!(k in v.fix), `fix must not carry ${k}`);
  });

  it("★다시 확인한 증거는 재검수 런의 판정만: 고친 쪽 필드(링크·파일 수·점검)가 섞이지 않는다", () => {
    const v = mod().buildReceiptView({ check: BASE, repair: REPAIR_AUTO, checks: [RECHECK_ITEM] });
    assert.deepEqual(v.recheck, {
      state: "done", runId: "wvc_빵집02", works: null, decision: "Conditionally Ready", at: RECHECK_ITEM.createdAt, via: "sourceCheck",
    });
    for (const k of ["changesUrl", "changedFiles", "buildCheck", "kind"]) assert.ok(!(k in v.recheck), `recheck must not carry ${k}`);
  });

  it("verify-sweep이 이은 재검수(verifyCheckId)가 사용자가 누른 재검수보다 앞선다 · 목록에 없으면 linked + 수리의 resolved", () => {
    const { buildReceiptView } = mod();
    const sweep = { ...RECHECK_ITEM, id: "wvc_sweep", createdAt: "2026-09-28T04:00:00.000Z", works: true, decision: "Ready" };
    const v = buildReceiptView({ check: BASE, repair: { ...REPAIR_AUTO, verifyCheckId: "wvc_sweep" }, checks: [RECHECK_ITEM, sweep] });
    assert.equal(v.recheck.runId, "wvc_sweep");
    assert.equal(v.recheck.via, "afterFix");
    const linked = buildReceiptView({ check: BASE, repair: { ...REPAIR_AUTO, verifyCheckId: "wvc_old", resolved: true }, checks: [] });
    assert.deepEqual(linked.recheck, { state: "linked", runId: "wvc_old", resolved: true });
  });

  it("사용자 재검수가 여럿이면 가장 최근 것 · 진행 중이면 active · 실패면 failed", () => {
    const { buildReceiptView } = mod();
    const older = { ...RECHECK_ITEM, id: "wvc_old", createdAt: "2026-09-28T04:00:00.000Z" };
    assert.equal(buildReceiptView({ check: BASE, repair: null, checks: [older, RECHECK_ITEM] }).recheck.runId, "wvc_빵집02");
    assert.equal(buildReceiptView({ check: BASE, repair: null, checks: [{ ...RECHECK_ITEM, status: "running" }] }).recheck.state, "active");
    assert.equal(buildReceiptView({ check: BASE, repair: null, checks: [{ ...RECHECK_ITEM, status: "failed" }] }).recheck.state, "failed");
    // 자기 자신·다른 런의 재검수는 무시
    const other = { ...RECHECK_ITEM, id: "wvc_x", sourceCheckId: "wvc_다른런" };
    assert.deepEqual(buildReceiptView({ check: BASE, repair: null, checks: [other, { ...BASE, sourceCheckId: RUN }] }).recheck, { state: "none" });
  });

  it("brief_only는 코드를 바꾸지 않은 것으로 — 파일 수·점검 없음 · buildVerified=false면 unverified", () => {
    const { buildReceiptView } = mod();
    const brief = buildReceiptView({ check: BASE, repair: { ...REPAIR_AUTO, mode: "brief_only", changedFiles: null, buildVerified: null }, checks: [] });
    assert.equal(brief.fix.kind, "briefOnly");
    assert.equal(brief.fix.changedFiles, null);
    assert.equal(brief.fix.buildCheck, null);
    const unverified = buildReceiptView({ check: BASE, repair: { ...REPAIR_AUTO, buildVerified: false }, checks: [] });
    assert.equal(unverified.fix.buildCheck, "unverified");
    const active = buildReceiptView({ check: BASE, repair: { ...REPAIR_AUTO, status: "running", prUrl: null }, checks: [] });
    assert.equal(active.fix.status, "active");
    assert.equal(active.fix.changesUrl, null);
  });

  it("수리가 없으면 fix=null · 고칠 것도 재검수도 없으면 다시 확인 섹션도 숨김", () => {
    const { buildReceiptView } = mod();
    const fine = buildReceiptView({ check: { ...BASE, works: true, decision: "Ready", report: { intent: "x", findings: [] } }, repair: null, checks: [] });
    assert.equal(fine.fix, null);
    assert.equal(fine.showRecheck, false);
    const broken = buildReceiptView({ check: BASE, repair: null, checks: [] });
    assert.equal(broken.showRecheck, true, "고칠 것이 있으면 '아직 다시 확인하지 않았어요'를 보여 준다");
  });
});

// ─── ⑤ 다음 할 일 하나 ────────────────────────────────────────────────────────

describe("⑤ 다음 할 일은 하나", () => {
  it("재검수 있음 → viewRecheck · 수리 끝남 → recheckAfterFix · 수리 중 → viewRepair · 고칠 것 → fix · 판정 없음 → tellUs · 그 외 → backToProject", () => {
    const { buildReceiptView } = mod();
    const next = (input) => buildReceiptView({ repair: null, checks: [], ...input }).nextAction;
    assert.deepEqual(next({ check: BASE, repair: REPAIR_AUTO, checks: [RECHECK_ITEM] }), { kind: "viewRecheck", runId: "wvc_빵집02" });
    assert.deepEqual(next({ check: BASE, repair: REPAIR_AUTO }), { kind: "recheckAfterFix" });
    assert.deepEqual(next({ check: BASE, repair: { ...REPAIR_AUTO, status: "queued" } }), { kind: "viewRepair" });
    assert.deepEqual(next({ check: BASE }), { kind: "fix" });
    const fine = { ...BASE, works: null, decision: "Conditionally Ready", report: { intent: "x", findings: [{ severity: "info", what: "n", why: "", how: "" }] } };
    assert.deepEqual(next({ check: { ...fine, userVerdict: null } }), { kind: "tellUs" });
    assert.deepEqual(next({ check: { ...fine, userVerdict: "as_intended" } }), { kind: "backToProject" });
  });
});

// ─── ⑥ 레거시·진행 중·실패 ─────────────────────────────────────────────────────

describe("⑥ 레거시 런 · 끝나지 않은 런", () => {
  it("★리포트 없음·새 필드(userVerdict·sourceCheckId) 없음 — 의도는 런의 intent, 판정·출처는 null", () => {
    const legacy = { id: "wvc_old", projectId: "p", targetUrl: "https://old.example.app", intent: "옛 의도", decision: "Not Verified", works: null, status: "done", executor: "local", report: null, evidenceKeys: [], createdAt: "2026-07-02T00:00:00.000Z" };
    const v = mod().buildReceiptView({ check: legacy, repair: undefined, checks: null });
    assert.equal(v.state, "ready");
    assert.equal(v.checked.intent, "옛 의도");
    assert.equal(v.userVerdict, null);
    assert.equal(v.source, null);
    assert.equal(v.items.basis, "coreFlow");
    assert.equal(v.items.rows[0].status, "notConfirmed");
    assert.equal(v.fix, null);
    assert.deepEqual(v.recheck, { state: "none" });
  });

  it("알 수 없는 사람 판정 값은 null로(서버 값은 문자열 캐스트일 뿐)", () => {
    assert.equal(mod().buildReceiptView({ check: { ...BASE, userVerdict: "완전 좋음" }, repair: null, checks: [] }).userVerdict, null);
  });

  it("진행 중(queued/running/uploaded) → notReady · 실패 → failed · 체크 없음 → missing", () => {
    const { buildReceiptView } = mod();
    for (const status of ["queued", "running", "uploaded"]) assert.equal(buildReceiptView({ check: { ...BASE, status } }).state, "notReady", status);
    assert.equal(buildReceiptView({ check: { ...BASE, status: "failed" } }).state, "failed");
    assert.equal(buildReceiptView({ check: null }).state, "missing");
  });
});

// ─── ⑦ 사전 · 금칙어 · 점수 · 정직 문구 · 글로 복사 ─────────────────────────────

const STATUS_KEYS = ["pass", "broken", "notConfirmed", "noProblemFound"];
const NEXT_KEYS = ["viewRecheck", "recheckAfterFix", "viewRepair", "fix", "tellUs", "backToProject"];
const NOT_SEEN_KEYS = ["loginBehind", "notReached", "otherPaths"];

function receiptStrings(r) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(r);
  return out;
}

describe("⑦ 사전 — KO/EN · 초보자 금칙어 0 · 숫자 점수 0 · 정직 문구", () => {
  for (const loc of ["ko", "en"]) {
    it(`${loc}: receipt.* 키가 모두 있고 비어 있지 않다`, () => {
      const r = DICTIONARIES[loc].visualChecks.receipt;
      assert.ok(r, `${loc}.visualChecks.receipt`);
      for (const k of STATUS_KEYS) assert.ok(r.status?.[k]?.trim(), `${loc}.receipt.status.${k}`);
      for (const k of NEXT_KEYS) {
        assert.ok(r.next?.[k]?.trim(), `${loc}.receipt.next.${k}`);
        assert.ok(r.nextWhy?.[k]?.trim(), `${loc}.receipt.nextWhy.${k}`);
      }
      for (const k of NOT_SEEN_KEYS) assert.ok(r.notSeen?.[k]?.trim(), `${loc}.receipt.notSeen.${k}`);
      assert.match(r.notSeen.notReached, /\{items\}/);
      assert.match(r.changedFiles, /\{count\}/);
    });

    it(`${loc}: 개발 용어(GitHub·PR·브랜치·저장소 …)와 숫자 점수가 없다`, () => {
      const strings = receiptStrings(DICTIONARIES[loc].visualChecks.receipt);
      assert.ok(strings.length >= 30, `${loc}: the receipt copy exists (${strings.length} strings) — an empty dictionary must not pass vacuously`);
      for (const s of strings) {
        assert.deepEqual(devTermHits(s, { terms: BEGINNER_TERMS }), [], `"${s}"`);
        assert.doesNotMatch(s, /\d+\s*(점|\/\s*\d+|%)|score/i, `"${s}" looks like a score`);
      }
    });
  }

  it("★정직 문구: 실제 서비스 운영 보증이 아니다 (KO/EN)", () => {
    assert.match(DICTIONARIES.ko.visualChecks.receipt.notAGuarantee, /실제 서비스 운영 보증이 아닙니다/);
    assert.match(DICTIONARIES.en.visualChecks.receipt.notAGuarantee, /not a guarantee/i);
  });

  it("★고친 쪽 ≠ 판정한 쪽을 두 섹션이 각각 스스로 말한다 (KO/EN)", () => {
    for (const loc of ["ko", "en"]) {
      const r = DICTIONARIES[loc].visualChecks.receipt;
      assert.ok(r.fixTitle !== r.recheckTitle);
      assert.ok(r.fixBy.trim() && r.recheckBy.trim());
    }
    assert.match(DICTIONARIES.ko.visualChecks.receipt.recheckBy, /고친 쪽이 아니라/);
    assert.match(DICTIONARIES.en.visualChecks.receipt.recheckBy, /not from/i);
  });
});

describe("⑦ 뷰·글로 복사에 점수가 없다 (기존 가드 assertNoNumericScores)", () => {
  const fmt = (iso) => iso.slice(0, 16).replace("T", " ");

  for (const loc of ["ko", "en"]) {
    it(`${loc}: ★글로 복사 — 섹션 순서(확인한 것 → 항목 → 못 본 것 → 고친 내용 → 다시 확인한 증거 → 정직 문구), 점수 0`, () => {
      const { buildReceiptView, receiptPlainText } = mod();
      const t = DICTIONARIES[loc];
      const r = t.visualChecks.receipt;
      const view = buildReceiptView({ check: BASE, repair: REPAIR_AUTO, checks: [RECHECK_ITEM] });
      assert.equal(assertNoNumericScores(view), true);
      const text = receiptPlainText(view, t, fmt);
      assert.equal(typeof text, "string");
      assertNoNumericScores({ text });
      const order = [r.title, r.sectionChecked, r.itemsTitleAcceptance, r.notSeenTitle, r.fixTitle, r.recheckTitle, r.notAGuarantee].map((s) => text.indexOf(s));
      for (const i of order) assert.ok(i >= 0, `${loc}: every section is in the text\n${text}`);
      assert.deepEqual([...order].sort((a, b) => a - b), order, `${loc}: sections in order\n${text}`);
      // 리얼 데이터가 깨지지 않고 그대로 — 한글 주소·항목·시간 부족 항목
      assert.ok(text.includes(BASE.targetUrl));
      assert.ok(text.includes("예약하기") && text.includes("예약 취소"));
      assert.ok(text.includes(REPAIR_AUTO.prUrl), "고친 내용 링크는 글에도 남는다(인쇄본에서 따라갈 수 있게)");
      assert.ok(text.includes(r.changedFiles.replace("{count}", "3")));
      assert.ok(!/\{\w+\}/.test(text), `${loc}: no unfilled placeholder`);
      // 고친 내용 섹션 안에는 다시 확인 판정 문구가 없다 — 섹션 경계로 자른다.
      const fixPart = text.slice(text.indexOf(r.fixTitle), text.indexOf(r.recheckTitle));
      assert.ok(!fixPart.includes(t.visualChecks.worksNoProblems), `${loc}: verdict leaked into the fix section`);
    });
  }

  it("수리·목록을 못 읽었으면(partial) 글에도 '빠져 있을 수 있다'를 적는다 — 조용히 완전해 보이지 않게", () => {
    const { buildReceiptView, receiptPlainText } = mod();
    for (const loc of ["ko", "en"]) {
      const t = DICTIONARIES[loc];
      const view = buildReceiptView({ check: BASE, repair: undefined, checks: null });
      assert.ok(receiptPlainText(view, t, fmt, { partial: true }).includes(t.visualChecks.receipt.partialLoad), loc);
      assert.ok(!receiptPlainText(view, t, fmt).includes(t.visualChecks.receipt.partialLoad), loc);
    }
  });

  it("수리·재검수 없는 레거시 런의 글에는 두 섹션이 없다", () => {
    const { buildReceiptView, receiptPlainText } = mod();
    const t = DICTIONARIES.ko;
    const legacy = { id: "wvc_old", projectId: "p", targetUrl: "https://old.example.app", intent: "옛 의도", decision: "Ready", works: true, status: "done", report: null, evidenceKeys: [], createdAt: "2026-07-02T00:00:00.000Z" };
    const text = receiptPlainText(buildReceiptView({ check: legacy, repair: null, checks: [] }), t, fmt);
    assert.ok(!text.includes(t.visualChecks.receipt.fixTitle));
    assert.ok(!text.includes(t.visualChecks.receipt.recheckTitle));
    assert.ok(text.includes(t.visualChecks.receipt.notAGuarantee));
  });
});

// ─── ⑧ 배선 ───────────────────────────────────────────────────────────────────

describe("⑧ 배선 (소스 정적 검사)", () => {
  const RECEIPT_PAGE = path.join(SRC, "app/projects/[id]/visual-checks/[runId]/receipt/page.tsx");
  const DETAIL_PAGE = path.join(SRC, "app/projects/[id]/visual-checks/[runId]/page.tsx");

  it("★영수증 화면이 있고, 기존 API(상세·수리·목록)만 조합해 buildReceiptView → 화면/receiptPlainText로 그린다", () => {
    assert.ok(existsSync(RECEIPT_PAGE), "receipt/page.tsx");
    const src = readFileSync(RECEIPT_PAGE, "utf8");
    assert.match(src, /getVisualCheck\(id, runId, userKey\)/);
    assert.match(src, /getRepair\(id, runId, userKey\)/);
    assert.match(src, /listVisualChecks\(id, userKey\)/);
    assert.match(src, /buildReceiptView\(/);
    assert.match(src, /receiptPlainText\(/);
    assert.match(src, /window\.print\(\)/);
    assert.match(src, /data-receipt/);
    assert.ok(!/fetch\(/.test(src), "no new server route — only the existing API client");
  });

  it("영수증 화면의 채운 버튼(btn-primary)은 하나 — 다음 할 일", () => {
    const src = readFileSync(RECEIPT_PAGE, "utf8");
    assert.equal((src.match(/btn-primary/g) ?? []).length, 1);
  });

  it("결과 화면이 영수증으로 가는 링크를 단다(보조 링크 — 채운 버튼 아님)", () => {
    const src = readFileSync(DETAIL_PAGE, "utf8");
    assert.match(src, /href=\{`\/projects\/\$\{id\}\/visual-checks\/\$\{runId\}\/receipt`\}/);
    assert.match(src, /t\.visualChecks\.receipt\.openFromReport/);
  });
});
