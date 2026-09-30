// pilot-metrics (Train P · P-2) — 신규 도구 테스트. 네트워크 없음: fetch·git·파일 읽기는 전부 주입.
// Rule 6: 정답지 파일명·프로젝트 이름·발견 문장은 한글·공백이 섞인 실제 모양으로 쓴다.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AXES,
  decisionBucket,
  bucketSide,
  humanSide,
  findingCodesFromReport,
  findingsFromReport,
  sanitizeProject,
  sanitizeRun,
  mergeD1Rows,
  evaluateAxes,
  evaluateAgreement,
  evaluateTime,
  evaluateRules,
  summarize,
  parseAnswerKey,
  parseCostSheet,
  parseOpsFill,
  opsFillRatios,
  checkPreRegistration,
  diffPreFields,
  computeCase,
  renderMarkdown,
  redact,
  assertNoSecret,
  maskId,
  median,
  USER_VERDICT_LABEL_KO,
  DECISION_LABEL_KO,
} from "../lib/pilot-metrics.mjs";
import { parseCliArgs, resolveUserKey, d1SqlFor, collectCase, makeGitSeam, runPilotMetrics } from "../pilot-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const USER_KEY = "uk_mg7p2x9q4k1ab";

// ─── 픽스처 ──────────────────────────────────────────────────────────────────────

const ANSWER_KEY_FILLED = `# 파일럿 정답지 — 동네 꽃집 픽업 예약 (건 1/6)

> 규율: **실행 전에 커밋**한다.

| 필드 | 값 |
|---|---|
| 문 | (b) 만든 앱이 안 됨 |
| 원래 의도 1문장 | 손님이 꽃다발 픽업 시간을 고르고 확인 문자를 받아야 한다 |
| (b)(c) 지금 다른 점 1문장 | '예약하기'를 누르면 화면이 하얗게 되고 아무 일도 없다 |
| 만든 도구 · 주소 | Lovable · https://kkot-pickup.lovable.app |
| 예상 실패 지점 | 예약 화면 · '예약하기' 클릭 · 흰 화면 + 콘솔 오류 |
| 기대 판정 | 안 돼요 |
| 기대 user_verdict | as_intended |
| 예상 WTP 구간 | $99 |
| 예상 spent_usd (빌드, (a)만) | $ |
| 정답지 작성자 · 일시 | 배승훈 · 2026-10-06 |

## 실행 후 (빈칸으로 커밋)

| 필드 | 실제 |
|---|---|
| 실제 판정 · 검수 런 id | |
| 실제 user_verdict | |
| 실패 지점 일치 여부 | 예측 적중 |
| 메모 | |
`;

function report({ verdict, oneLine, findings }) {
  return { title: "리포트", target: "https://kkot-pickup.lovable.app", intent: "픽업 예약", verdict, oneLine, works: null, findings, nextSteps: [], notes: [] };
}

const RUN1 = {
  id: "wvc_mg7aaa11",
  createdAt: "2026-10-06T01:00:00.000Z",
  status: "done",
  decision: "Needs Fix",
  works: false,
  userVerdict: "still_broken",
  userVerdictAt: "2026-10-06T01:05:00.000Z",
  sourceCheckId: null,
  targetUrl: "https://kkot-pickup.lovable.app",
  report: report({
    verdict: "작동 안 해요 — 고쳐야 해요",
    oneLine: "'예약하기'를 눌러도 다음 화면으로 넘어가지 않아요",
    findings: [
      { severity: "high", what: "'예약하기'를 눌러도 아무 일도 일어나지 않아요", code: "step_failed" },
      { severity: "medium", what: "화면 뒤에서 오류가 났어요", code: "console_error" },
    ],
  }),
};
const RUN2 = {
  id: "wvc_mg7bbb22",
  createdAt: "2026-10-06T01:40:00.000Z",
  status: "done",
  decision: "Conditionally Ready",
  works: null,
  userVerdict: "as_intended",
  userVerdictAt: "2026-10-06T01:50:00.000Z",
  sourceCheckId: "wvc_mg7aaa11",
  targetUrl: "https://kkot-pickup.lovable.app",
  report: report({ verdict: "문제를 찾지 못했어요", oneLine: "예약까지 끝까지 갔어요", findings: [] }),
};

const PROJECT = {
  id: "proj_mg7kkot",
  userKey: USER_KEY, // GET /workspace/projects/:id 응답에는 userKey가 실제로 들어 있다(DbProject)
  title: "동네 꽃집 픽업 예약",
  idea: "",
  entryPath: "code",
  builtWith: { tools: ["lovable"] },
  topicTags: { domain: "booking", pattern: null, integrations: [], ai_feature: null },
  regionAtCreate: "KR",
  createdAt: "2026-10-06T00:59:00.000Z",
};

function listItem(r) {
  return { id: r.id, targetUrl: r.targetUrl, decision: r.decision, works: r.works, status: r.status, executor: "container", evidenceCount: 3, userVerdict: r.userVerdict, userVerdictAt: r.userVerdictAt, sourceCheckId: r.sourceCheckId, createdAt: r.createdAt };
}
function detail(r) {
  return { ...listItem(r), projectId: PROJECT.id, intent: "픽업 예약이 끝까지 되는지", report: r.report, evidenceKeys: [] };
}

/** 라이브 API 모양의 가짜 fetch. repairs: runId → repair view. */
function fakeFetch({ runs = [RUN1, RUN2], repairs = {}, project = PROJECT, failPath = null } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (failPath && u.pathname.endsWith(failPath)) {
      // 오류 본문에 URL(=userKey)을 되돌려 주는 최악의 서버 — 도구는 이걸 출력에 옮기면 안 된다.
      return { ok: false, status: 500, json: async () => ({ ok: false, error: `boom ${url}` }) };
    }
    if (u.searchParams.get("userKey") !== USER_KEY) return { ok: false, status: 403, json: async () => ({ ok: false, error: "forbidden" }) };
    const m = u.pathname.match(/^\/workspace\/projects\/([^/]+)(?:\/visual-checks(?:\/([^/]+)(\/repair)?)?)?$/);
    if (!m) return { ok: false, status: 404, json: async () => ({ ok: false, error: "not_found" }) };
    const [, , runId, repair] = m;
    if (!u.pathname.includes("/visual-checks")) return { ok: true, status: 200, json: async () => ({ ok: true, project }) };
    if (!runId) return { ok: true, status: 200, json: async () => ({ ok: true, checks: [...runs].reverse().map(listItem), signupAvailable: false }) };
    const r = runs.find((x) => x.id === runId);
    if (repair) return { ok: true, status: 200, json: async () => ({ ok: true, repair: repairs[runId] ?? null }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, check: detail(r) }) };
  };
  fn.calls = calls;
  return fn;
}

const noGit = { log: () => [], show: () => null, dirty: () => false };

function runsFor(list, repairs = {}) {
  return list.map((r) => sanitizeRun({ item: listItem(r), detail: detail(r), repair: repairs[r.id] ?? null }));
}

// ─── 판정 매핑 ────────────────────────────────────────────────────────────────────

describe("판정 매핑 (RUNBOOK §4.1)", () => {
  it("decision → 정답지 4칸, done이 아니면 null, 모르는 decision은 '사람 확인 필요'", () => {
    assert.equal(decisionBucket({ status: "done", decision: "Ready" }), "작동해요");
    assert.equal(decisionBucket({ status: "done", decision: "Conditionally Ready" }), "문제를 찾지 못했어요");
    assert.equal(decisionBucket({ status: "done", decision: "Needs Fix" }), "안 돼요");
    assert.equal(decisionBucket({ status: "done", decision: "Not Verified" }), "사람 확인 필요");
    assert.equal(decisionBucket({ status: "done", decision: "User Acceptance Required" }), "사람 확인 필요");
    assert.equal(decisionBucket({ status: "done", decision: "Something New" }), "사람 확인 필요");
    assert.equal(decisionBucket({ status: "failed", decision: "Not Verified" }), null);
    assert.equal(decisionBucket({ status: "running", decision: "Not Judged" }), null);
    assert.equal(decisionBucket(null), null);
  });

  it("수용 쪽: 문제를 찾지 못했어요도 accept, works_but_different는 reject, unsure는 라벨 아님", () => {
    assert.equal(bucketSide("작동해요"), "accept");
    assert.equal(bucketSide("문제를 찾지 못했어요"), "accept");
    assert.equal(bucketSide("안 돼요"), "reject");
    assert.equal(bucketSide("사람 확인 필요"), "abstain");
    assert.equal(bucketSide(null), null);
    assert.equal(humanSide("as_intended"), "accept");
    assert.equal(humanSide("works_but_different"), "reject");
    assert.equal(humanSide("still_broken"), "reject");
    assert.equal(humanSide("unsure"), null);
    assert.equal(humanSide(null), null);
  });
});

describe("발견 코드 — 서버 enrichReportForStorage와 같은 규칙", () => {
  it("[] = 측정됨·발견 0, 코드 배열, 옛 이미지(코드 없음) = null, 리포트 아님 = null", () => {
    assert.deepEqual(findingCodesFromReport(report({ verdict: "v", oneLine: "o", findings: [] })), []);
    assert.deepEqual(findingCodesFromReport(RUN1.report), ["step_failed", "console_error"]);
    assert.equal(findingCodesFromReport(report({ verdict: "v", oneLine: "o", findings: [{ severity: "high", what: "x" }] })), null);
    assert.equal(findingCodesFromReport({ error: "inspection failed" }), null);
    assert.equal(findingCodesFromReport(null), null);
    assert.equal(findingCodesFromReport([]), null);
    // 스키마 위반(what 없음)은 서버 safeParse 실패와 같게 null
    assert.equal(findingCodesFromReport({ findings: [{ severity: "high", code: "x" }] }), null);
  });

  it("발견 원문을 남긴다 — 개수가 아니라 코드·severity·what 문장", () => {
    const f = findingsFromReport(RUN1.report);
    assert.equal(f.length, 2);
    assert.deepEqual(f[0], { code: "step_failed", severity: "high", what: "'예약하기'를 눌러도 아무 일도 일어나지 않아요" });
  });
});

// ─── 정답지 ──────────────────────────────────────────────────────────────────────

describe("정답지 파싱", () => {
  it("채운 정답지(한글) → 문·기대 판정·기대 user_verdict·예상 실패 지점·건 번호, 실행 후 적중 칸은 사람 값 그대로", () => {
    const k = parseAnswerKey(ANSWER_KEY_FILLED);
    assert.equal(k.caseNo, 1);
    assert.equal(k.pre.door, "b");
    assert.equal(k.pre.expectedJudgment, "안 돼요");
    assert.equal(k.pre.expectedUserVerdict, "as_intended");
    assert.equal(k.pre.expectedFailurePoint, "예약 화면 · '예약하기' 클릭 · 흰 화면 + 콘솔 오류");
    assert.equal(k.pre.tool, "Lovable");
    assert.equal(k.pre.url, "https://kkot-pickup.lovable.app");
    assert.equal(k.pre.writtenAt, "2026-10-06");
    assert.equal(k.post.failurePointMatch, "예측 적중");
    assert.deepEqual(k.warnings, []);
  });

  it("main의 실제 템플릿 그대로면 전부 미선택(null) + 경고 — 선택지 나열을 값으로 오인하지 않는다", () => {
    const k = parseAnswerKey(read("docs/pilot-2026-10/answer-key-TEMPLATE.md"));
    assert.equal(k.caseNo, null);
    assert.equal(k.pre.door, null);
    assert.equal(k.pre.expectedJudgment, null);
    assert.equal(k.pre.expectedUserVerdict, null);
    assert.equal(k.pre.expectedFailurePoint, null);
    assert.equal(k.pre.intent, null);
    assert.equal(k.pre.tool, null);
    assert.equal(k.pre.url, null);
    assert.equal(k.post.failurePointMatch, null);
    assert.ok(k.warnings.length >= 4);
  });

  it("기대 user_verdict는 화면 문구(생각대로 됐어요)로 적어도 읽는다", () => {
    const k = parseAnswerKey(ANSWER_KEY_FILLED.replace("| 기대 user_verdict | as_intended |", "| 기대 user_verdict | 되긴 하는데 달라요 |"));
    assert.equal(k.pre.expectedUserVerdict, "works_but_different");
  });

  it("빈 입력은 던지지 않고 경고만", () => {
    const k = parseAnswerKey("");
    assert.equal(k.caseNo, null);
    assert.ok(k.warnings.length > 0);
  });

  it("기대 칸 변경 감지(실행 뒤 수정 금지 규율)", () => {
    const before = parseAnswerKey(ANSWER_KEY_FILLED);
    const after = parseAnswerKey(ANSWER_KEY_FILLED.replace("| 기대 판정 | 안 돼요 |", "| 기대 판정 | 문제를 찾지 못했어요 |"));
    assert.deepEqual(diffPreFields(before, after), ["기대 판정"]);
    // 실행 후 칸만 바뀌면 기대 칸 변경 아님
    const postOnly = parseAnswerKey(ANSWER_KEY_FILLED.replace("| 메모 | |", "| 메모 | 버튼 위치가 달랐다 |"));
    assert.deepEqual(diffPreFields(before, postOnly), []);
  });
});

describe("정답지 선기록 확인", () => {
  const firstRun = "2026-10-06T01:00:00.000Z";
  it("첫 커밋이 첫 런보다 앞서면 ok, 기대 칸 변경 없음", () => {
    const r = checkPreRegistration({
      commits: [{ sha: "a".repeat(40), committedAt: "2026-10-05T12:00:00+09:00" }],
      firstRunCreatedAt: firstRun,
      currentText: ANSWER_KEY_FILLED,
      textAt: () => ANSWER_KEY_FILLED,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.beforeFirstRun, true);
    assert.deepEqual(r.expectedChangedFields, []);
  });

  it("첫 커밋이 늦으면 late — 선기록 아님", () => {
    const r = checkPreRegistration({ commits: [{ sha: "b".repeat(40), committedAt: "2026-10-06T11:00:00+09:00" }], firstRunCreatedAt: firstRun, currentText: ANSWER_KEY_FILLED, textAt: () => null });
    assert.equal(r.status, "late");
    assert.equal(r.beforeFirstRun, false);
  });

  it("런 뒤에 기대 판정을 고쳤으면 바뀐 필드를 이름으로 낸다", () => {
    const edited = ANSWER_KEY_FILLED.replace("| 기대 판정 | 안 돼요 |", "| 기대 판정 | 사람 확인 필요 |");
    const r = checkPreRegistration({
      commits: [
        { sha: "c".repeat(40), committedAt: "2026-10-06T12:00:00+09:00" },
        { sha: "d".repeat(40), committedAt: "2026-10-05T12:00:00+09:00" },
      ],
      firstRunCreatedAt: firstRun,
      currentText: edited,
      textAt: (sha) => (sha === "d".repeat(40) ? ANSWER_KEY_FILLED : edited),
    });
    assert.equal(r.status, "ok");
    assert.equal(r.commitsAfterRun, 1);
    assert.deepEqual(r.expectedChangedFields, ["기대 판정"]);
  });

  it("커밋 안 됨 / git 못 읽음 / 런 전", () => {
    assert.equal(checkPreRegistration({ commits: [], firstRunCreatedAt: firstRun, currentText: "" }).status, "not_committed");
    assert.equal(checkPreRegistration({ commits: null, firstRunCreatedAt: firstRun, currentText: "" }).status, "unknown");
    assert.equal(checkPreRegistration({ commits: [{ sha: "e".repeat(40), committedAt: "2026-10-05T00:00:00Z" }], firstRunCreatedAt: null, currentText: "" }).status, "no_run");
  });
});

// ─── 6축 ─────────────────────────────────────────────────────────────────────────

describe("6축 채움 (RUNBOOK §4.2)", () => {
  const project = sanitizeProject(PROJECT);

  it("붙여넣기 경로(수리 잡 없음)는 resolved가 비어 5/6 — 이유를 적는다", () => {
    const { axes, filledCount } = evaluateAxes(project, runsFor([RUN1, RUN2]));
    assert.equal(filledCount, 5);
    assert.equal(axes.region.value, "KR");
    assert.equal(axes.built_with.value, "lovable");
    assert.equal(axes.topic.value, "domain=booking");
    assert.equal(axes.finding_code.value, "step_failed+console_error → [] 발견 0");
    assert.equal(axes.user_verdict.value, "as_intended");
    assert.equal(axes.resolved.state, "missing");
    assert.match(axes.resolved.reason, /붙여넣기 경로/);
  });

  it("수리 잡에 resolved가 찍혔으면 6/6", () => {
    const repairs = { wvc_mg7aaa11: { id: "wrj_1", status: "done", mode: "auto_fix", resolved: true, verifyCheckId: "wvc_mg7bbb22", createdAt: "x", updatedAt: "y" } };
    const { filledCount, axes } = evaluateAxes(project, runsFor([RUN1, RUN2], repairs));
    assert.equal(filledCount, 6);
    assert.equal(axes.resolved.value, "1");
  });

  it("수리 잡은 있는데 resolved 미기록이면 비어 있음(verify-sweep 신호 없음)", () => {
    const repairs = { wvc_mg7aaa11: { id: "wrj_1", status: "done", mode: "auto_fix", resolved: null } };
    const { axes } = evaluateAxes(project, runsFor([RUN1, RUN2], repairs));
    assert.equal(axes.resolved.state, "missing");
    assert.match(axes.resolved.reason, /verify-sweep/);
  });

  it("빈 분류(topic 값 없음)는 채움이 아니다, 도구 미선택은 비어 있음", () => {
    const p = sanitizeProject({ ...PROJECT, builtWith: null, topicTags: { domain: null, pattern: null, integrations: [], ai_feature: null } });
    const { axes, filledCount } = evaluateAxes(p, runsFor([RUN1, RUN2]));
    assert.equal(axes.topic.state, "recorded_empty");
    assert.equal(axes.built_with.state, "missing");
    assert.match(axes.built_with.reason, /도구 선택 없음/);
    assert.equal(filledCount, 3);
  });

  it("마지막 런에 답이 없으면 user_verdict 비어 있음(앞 런 답으로 채우지 않는다)", () => {
    const { axes } = evaluateAxes(project, runsFor([RUN1, { ...RUN2, userVerdict: null, userVerdictAt: null }]));
    assert.equal(axes.user_verdict.state, "missing");
    assert.match(axes.user_verdict.reason, /마지막 런에 답 없음/);
  });

  it("D1 행이 있으면 finding_code는 D1 칸이 정본 — D1이 NULL이면 비어 있음", () => {
    const merged = mergeD1Rows(runsFor([RUN1, RUN2]), [
      { id: "wvc_mg7aaa11", status: "done", updated_at: "2026-10-06T01:01:10.000Z", region: "KR", finding_codes_json: null },
      { id: "wvc_mg7bbb22", status: "done", updated_at: "2026-10-06T01:41:00.000Z", region: "KR", finding_codes_json: "[]" },
    ]);
    const { axes } = evaluateAxes(project, merged);
    assert.equal(axes.finding_code.state, "missing");
    assert.equal(axes.finding_code.source, "D1 finding_codes_json");
    assert.match(axes.finding_code.reason, /1\/2/);
  });

  it("프로젝트를 못 읽고 런도 없으면 0/6 (던지지 않음)", () => {
    const { filledCount, axes } = evaluateAxes(null, []);
    assert.equal(filledCount, 0);
    assert.equal(Object.keys(axes).length, AXES.length);
  });
});

// ─── 일치율 ───────────────────────────────────────────────────────────────────────

describe("기계 판정 vs 사람 라벨", () => {
  it("L1 정확 일치 + 런별 L2 일치 → 불일치 아님", () => {
    const { l1, l2, disagreement } = evaluateAgreement(runsFor([RUN1, RUN2]), "안 돼요");
    assert.equal(l1.actual, "안 돼요");
    assert.equal(l1.exact, true);
    assert.equal(l1.sideAgree, true);
    assert.deepEqual(l2.map((p) => p.agree), [true, true]);
    assert.equal(disagreement, false);
  });

  it("고장 난 앱인데 첫 런이 '문제를 찾지 못했어요' → L1 다른 쪽 → 건 불일치", () => {
    const miss = { ...RUN1, decision: "Conditionally Ready" };
    const r = evaluateAgreement(runsFor([miss, RUN2]), "안 돼요");
    assert.equal(r.l1.sideAgree, false);
    assert.equal(r.disagreement, true);
  });

  it("'되긴 하는데 달라요' ↔ '문제를 찾지 못했어요'는 충돌(의도 차이를 못 봄), unsure·기계 보류는 세지 않음", () => {
    const diff = { ...RUN2, userVerdict: "works_but_different" };
    const r = evaluateAgreement(runsFor([RUN1, diff]), null);
    assert.equal(r.l2[1].agree, false);
    assert.equal(r.disagreement, true);

    const unsure = { ...RUN2, userVerdict: "unsure" };
    const abstain = { ...RUN1, decision: "Not Verified" };
    const r2 = evaluateAgreement(runsFor([abstain, unsure]), null);
    assert.deepEqual(r2.l2.map((p) => p.agree), [null, null]);
    assert.equal(r2.l2[0].note, "기계 판정 보류");
    assert.match(r2.l2[1].note, /모르겠어요/);
    assert.equal(r2.disagreement, null);
  });

  it("실패한 런은 L1의 '첫 런'이 아니다 — 첫 끝난 런과 비교", () => {
    const failed = { ...RUN1, id: "wvc_mg7fff00", createdAt: "2026-10-06T00:50:00.000Z", status: "failed", decision: "Not Verified", userVerdict: null };
    const r = evaluateAgreement(runsFor([failed, RUN1, RUN2]), "안 돼요");
    assert.equal(r.l1.firstRunId, "wvc_mg7aaa11");
  });
});

// ─── 시간 ─────────────────────────────────────────────────────────────────────────

describe("시간·재검수", () => {
  it("API만으로는 런별 소요 시간 미측정, 건 단위(첫 런→마지막 런·답)는 잰다", () => {
    const t = evaluateTime(runsFor([RUN1, RUN2]));
    assert.equal(t.perRunDurationsMeasured, false);
    assert.equal(t.perRun[0].durationSec, null);
    assert.equal(t.hasRecheck, true);
    assert.equal(t.recheckCount, 1);
    assert.equal(t.toFinalRunSec, 40 * 60);
    assert.equal(t.toVerdictSec, 50 * 60);
  });

  it("D1 행(updated_at)이 있으면 런별 생성→완료 초", () => {
    const merged = mergeD1Rows(runsFor([RUN1, RUN2]), [
      { id: "wvc_mg7aaa11", status: "done", updated_at: "2026-10-06T01:00:51.000Z" },
      { id: "wvc_mg7bbb22", status: "done", updated_at: "2026-10-06T01:44:09.000Z" },
    ]);
    const t = evaluateTime(merged);
    assert.deepEqual(t.perRun.map((p) => p.durationSec), [51, 249]);
    assert.equal(t.perRunDurationsMeasured, true);
  });

  it("진행 중 런은 완료 시각이 없다(updated_at을 완료로 오인하지 않음)", () => {
    const running = { ...RUN2, status: "running" };
    const merged = mergeD1Rows(runsFor([RUN1, running]), [{ id: "wvc_mg7bbb22", status: "running", updated_at: "2026-10-06T01:41:00.000Z" }]);
    assert.equal(merged[1].doneAt, null);
    assert.equal(evaluateTime(merged).activeRuns, 1);
  });
});

// ─── 규칙 ─────────────────────────────────────────────────────────────────────────

function fakeCase({ door = "b", verdict = "as_intended", disagreement = false, filledCount = 5, support = 10, build = null }) {
  return { door, axes: { user_verdict: { state: verdict ? "filled" : "missing", value: verdict } }, disagreement, filledCount, sheet: { supportMinutes: support, buildResult: build } };
}

describe("판정 규칙 5개 입력 (RUNBOOK §5)", () => {
  const status = (cases, id) => evaluateRules(cases).find((r) => r.id === id).status;

  it("R1 (b)(c) as_intended 0건 → 넘음, 답 없는 건이 있으면 입력 부족", () => {
    assert.equal(status([fakeCase({ verdict: "still_broken" }), fakeCase({ door: "c", verdict: "works_but_different" })], "R1"), "triggered");
    assert.equal(status([fakeCase({ verdict: "still_broken" }), fakeCase({ verdict: null })], "R1"), "insufficient");
    assert.equal(status([fakeCase({}), fakeCase({ verdict: "still_broken" })], "R1"), "clear");
  });

  it("R2 불일치 ≥ 2건 → 넘음", () => {
    assert.equal(status([fakeCase({ disagreement: true }), fakeCase({ disagreement: true }), fakeCase({})], "R2"), "triggered");
    assert.equal(status([fakeCase({ disagreement: true }), fakeCase({}), fakeCase({})], "R2"), "clear");
    assert.equal(status([fakeCase({ disagreement: true }), fakeCase({ disagreement: null }), fakeCase({})], "R2"), "insufficient");
  });

  it("R3 support_minutes 중앙값 > 15분 → 넘음, 미기입이 있으면 입력 부족", () => {
    assert.equal(status([fakeCase({ support: 10 }), fakeCase({ support: 20 }), fakeCase({ support: 30 })], "R3"), "triggered");
    assert.equal(status([fakeCase({ support: 10 }), fakeCase({ support: 15 }), fakeCase({ support: 30 })], "R3"), "clear");
    assert.equal(status([fakeCase({ support: 10 }), fakeCase({ support: null })], "R3"), "insufficient");
  });

  it("R4 6축 평균 < 5/6 → 넘음 (붙여넣기 경로 5/6은 안 넘음)", () => {
    assert.equal(status([fakeCase({ filledCount: 5 }), fakeCase({ filledCount: 5 })], "R4"), "clear");
    assert.equal(status([fakeCase({ filledCount: 5 }), fakeCase({ filledCount: 4 })], "R4"), "triggered");
  });

  it("R5 (a) 빌드 성공 0/3 → 넘음, (a) 건 없으면 입력 부족(P-5 뒤)", () => {
    assert.equal(status([fakeCase({})], "R5"), "insufficient");
    const a = (build) => fakeCase({ door: "a", build });
    assert.equal(status([a("failure"), a("failure"), a("failure")], "R5"), "triggered");
    assert.equal(status([a("failure"), a("success"), a("failure")], "R5"), "clear");
    assert.equal(status([a("failure"), a(null), a("failure")], "R5"), "insufficient");
  });

  it("빈 입력: 규칙은 전부 입력 부족, 요약·렌더는 던지지 않음", () => {
    const rules = evaluateRules([]);
    assert.equal(rules.length, 5);
    assert.ok(rules.every((r) => r.status === "insufficient"));
    const s = summarize([]);
    assert.equal(s.cases, 0);
    assert.equal(s.meanFill, null);
    const md = renderMarkdown({ generatedAt: "2026-10-06T00:00:00.000Z", cases: [], rules, summary: s, sources: {} });
    assert.match(md, /판정 규칙 입력/);
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
});

// ─── 원가 시트·집계 입력 ───────────────────────────────────────────────────────────

describe("원가 수기 시트", () => {
  it("한글 머리줄·'12분'·'예 — 한 줄'·열 순서 무관", () => {
    const sheet = parseCostSheet(`| 건 | 문 | 이의(생각과 다름) | support_minutes | 재작업 | 개입(직접 쓴 지시) | spent_usd | 빌드 결과 | 메모 |
|---|---|---|---|---|---|---|---|---|
| 1 | (b) | 예 — 예약 확인 문자가 없다 | 12분 | 1 | 아니오 | | | 버튼 찾는 데 5분 |
| 2 | (c) | 아니오 | 20 | 0 | 예 | | | |
| 4 | (a) | | | | | $6.4 | 실패 | |
| 합계 | | | | | | | | |`);
    assert.equal(sheet.size, 3);
    assert.deepEqual(
      { m: sheet.get(1).supportMinutes, d: sheet.get(1).dispute, t: sheet.get(1).disputeText, i: sheet.get(1).intervention },
      { m: 12, d: true, t: "예 — 예약 확인 문자가 없다", i: false },
    );
    assert.equal(sheet.get(2).dispute, false);
    assert.equal(sheet.get(2).intervention, true);
    assert.equal(sheet.get(4).spentUsd, 6.4);
    assert.equal(sheet.get(4).buildResult, "failure");
    assert.equal(sheet.get(4).supportMinutes, null);
  });

  it("저장소의 빈 시트는 건 번호만 있고 값은 전부 null", () => {
    const sheet = parseCostSheet(read("docs/pilot-2026-10/cost-sheet.md"));
    assert.equal(sheet.size, 6);
    for (const row of sheet.values()) {
      assert.equal(row.supportMinutes, null);
      assert.equal(row.dispute, null);
      assert.equal(row.buildResult, null);
    }
  });
});

describe("ops-probe d1-readonly 집계 입력", () => {
  it("wrangler --json 모양", () => {
    const ops = parseOpsFill(JSON.stringify([{ results: [{ rows_scanned: 49, region_filled: 3, envelope_filled: 3, finding_codes_filled: 2, user_verdict_filled: 1 }], success: true }]));
    assert.deepEqual(opsFillRatios(ops).find((r) => r.column === "region_filled"), { column: "region_filled", filled: 3, scanned: 49 });
  });

  it("job summary 마크다운(renderSummary 출력) 모양", () => {
    const md = `### d1-readonly · envelope-fill-rate

| rows_scanned | region_filled | envelope_filled | finding_codes_filled | user_verdict_filled | source_check_filled | locale_filled |
| --- | --- | --- | --- | --- | --- | --- |
| 49 | 3 | 3 | 3 | 1 | 1 | 49 |

_1 rows_
`;
    const ops = parseOpsFill(md);
    assert.equal(ops.query, "envelope-fill-rate");
    assert.equal(ops.rows[0].rows_scanned, 49);
    assert.equal(opsFillRatios(ops).length, 6);
  });

  it("모양을 모르면 던진다 — '못 읽음'이 '0행'처럼 보이면 안 된다", () => {
    assert.throws(() => parseOpsFill("wrangler: authentication error"), /읽을 수 있는 행이 없어요/);
    assert.throws(() => parseOpsFill(""), /읽을 수 있는 행이 없어요/);
  });
});

// ─── userKey 비노출 ────────────────────────────────────────────────────────────────

describe("userKey 비노출", () => {
  it("프로젝트 응답의 userKey는 화이트리스트에서 빠진다", () => {
    const p = sanitizeProject(PROJECT);
    assert.equal(JSON.stringify(p).includes(USER_KEY), false);
    assert.equal("userKey" in p, false);
  });

  it("서버가 오류 본문에 URL(userKey 포함)을 되돌려도 오류 문구에 옮기지 않는다", async () => {
    const got = await collectCase({ base: "https://central.example", projectId: "proj_mg7kkot", userKey: USER_KEY, fetchImpl: fakeFetch({ failPath: "/visual-checks" }) });
    assert.equal(got.errors.length, 1);
    assert.match(got.errors[0], /^GET \/workspace\/projects\/:id\/visual-checks: HTTP 500$/);
    assert.equal(JSON.stringify(got).includes(USER_KEY), false);
  });

  it("fetch 예외 메시지(URL 포함)는 이름만 남긴다", async () => {
    const boom = async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const got = await collectCase({ base: "https://central.example", projectId: "proj_mg7kkot", userKey: USER_KEY, fetchImpl: boom });
    assert.deepEqual(got.errors, [
      "GET /workspace/projects/:id: 요청 실패 (TypeError)",
      "GET /workspace/projects/:id/visual-checks: 요청 실패 (TypeError)",
    ]);
    assert.equal(JSON.stringify(got).includes(USER_KEY), false);
  });

  it("전체 실행 출력(JSON·마크다운)에 userKey 원문·인코딩 값이 없다", async () => {
    const fetchImpl = fakeFetch();
    const { json, markdown, result } = await runPilotMetrics(
      { cases: [{ projectId: "proj_mg7kkot", answerKeyPath: "docs/pilot-2026-10/answer-key-01-꽃집 픽업 예약.md" }], base: "https://central.example", maskIds: true },
      { userKey: USER_KEY, fetchImpl, git: noGit, readFile: () => ANSWER_KEY_FILLED, now: () => new Date("2026-10-06T02:00:00.000Z"), cwd: ROOT },
    );
    // 호출은 실제로 userKey로 갔다(도구가 키를 쓰긴 했다)
    assert.ok(fetchImpl.calls.every((u) => new URL(u).searchParams.get("userKey") === USER_KEY));
    for (const out of [json, markdown]) {
      assert.equal(out.includes(USER_KEY), false);
      assert.equal(out.includes(encodeURIComponent(USER_KEY)), false);
    }
    assert.equal(result.sources.userKey, "provided");
    assert.equal(result.cases[0].filledCount, 5);
    assert.equal(result.cases[0].caseNo, 1);
    // 원문 판정 문구·발견 코드가 함께 저장된다(개수만 세지 않는다)
    const runs = result.cases[0].collected.runs;
    assert.equal(runs[0].verdictText, "작동 안 해요 — 고쳐야 해요");
    assert.deepEqual(runs[0].findingCodes, ["step_failed", "console_error"]);
    assert.match(markdown, /step_failed · '예약하기'를 눌러도 아무 일도 일어나지 않아요/);
    // 마크다운은 id를 가린다
    assert.equal(markdown.includes("wvc_mg7aaa11"), false);
    assert.match(markdown, /wvc_…aa11/);
    // 예상 실패 지점 적중은 사람이 적은 값만(자동 판정 없음)
    assert.equal(result.cases[0].failurePoint.humanJudgment, "예측 적중");
  });

  it("redact·assertNoSecret — 남으면 쓰지 않고 멈춘다(메시지에 값 없음)", () => {
    assert.equal(redact(`x ${USER_KEY} y ${encodeURIComponent(USER_KEY)}`, [USER_KEY]), "x [REDACTED] y [REDACTED]");
    assert.throws(
      () => assertNoSecret(`{"k":"${USER_KEY}"}`, [USER_KEY]),
      (err) => err instanceof Error && !err.message.includes(USER_KEY),
    );
    assert.doesNotThrow(() => assertNoSecret("clean", [USER_KEY]));
    assert.doesNotThrow(() => assertNoSecret("clean", []));
  });
});

// ─── CLI·seam ─────────────────────────────────────────────────────────────────────

describe("CLI 인자·seam", () => {
  it("--case의 정답지 경로에 한글·공백이 있어도 그대로, 모양이 틀린 id는 거절", () => {
    const o = parseCliArgs(["--case", "proj_mg7kkot=docs/pilot-2026-10/answer-key-01-꽃집 픽업 예약.md", "--case", "proj_mg7zz9"]);
    assert.deepEqual(o.cases, [
      { projectId: "proj_mg7kkot", answerKeyPath: "docs/pilot-2026-10/answer-key-01-꽃집 픽업 예약.md" },
      { projectId: "proj_mg7zz9", answerKeyPath: null },
    ]);
    assert.equal(o.maskIds, true);
    assert.throws(() => parseCliArgs(["--case", "proj_x'; DROP TABLE x;--=a.md"]), /프로젝트 id 모양/);
  });

  it("userKey 출처: 파일 > 환경변수 > 인자", () => {
    assert.equal(resolveUserKey({ userKeyFile: "k.txt", userKeyArg: "uk_arg0000" }, { SIMSA_USER_KEY: "uk_env0000" }, () => "uk_file000\n"), "uk_file000");
    assert.equal(resolveUserKey({ userKeyArg: "uk_arg0000" }, { SIMSA_USER_KEY: "uk_env0000" }), "uk_env0000");
    assert.equal(resolveUserKey({ userKeyArg: "uk_arg0000" }, {}), "uk_arg0000");
    assert.equal(resolveUserKey({}, {}), null);
  });

  it("D1 질의는 검증된 id만, 내용·식별 컬럼(user_key·intent·report_json·target_url) 없음", () => {
    const sql = d1SqlFor(["proj_mg7kkot", "bad'id"]);
    assert.match(sql, /IN \('proj_mg7kkot'\)/);
    for (const col of ["user_key", "intent", "report_json", "target_url", "agent_prompt"]) assert.equal(sql.includes(col), false);
    assert.throws(() => d1SqlFor(["nope"]), /유효한 프로젝트 id/);
  });

  it("git seam: 최신순 로그 파싱, 실패는 null, 이상한 sha는 show 안 함", () => {
    const seen = [];
    const spawn = (cmd, args, opts) => {
      seen.push({ cmd, args, cwd: opts.cwd, shell: opts.shell });
      if (args.includes("log")) return { status: 0, stdout: `${"1".repeat(40)}\t2026-10-06T10:00:00+09:00\n${"2".repeat(40)}\t2026-10-05T10:00:00+09:00\n` };
      if (args.includes("status")) return { status: 0, stdout: "" };
      return { status: 128, stdout: "" };
    };
    const g = makeGitSeam(spawn);
    const abs = path.join(ROOT, "docs", "pilot-2026-10", "answer-key-01-꽃집 픽업 예약.md");
    assert.deepEqual(g.log(abs).map((c) => c.sha[0]), ["1", "2"]);
    assert.equal(g.dirty(abs), false);
    assert.equal(g.show(abs, "zz"), null);
    assert.equal(g.show(abs, "1".repeat(40)), null); // status 128 → null
    assert.ok(seen.every((s) => s.cmd === "git" && s.shell === false && s.cwd === path.dirname(abs)));
    assert.ok(seen[0].args.includes("answer-key-01-꽃집 픽업 예약.md"));
  });

  it("--snapshot-in: 이전 출력으로 네트워크 없이 재계산 — 같은 합계", async () => {
    const first = await runPilotMetrics(
      { cases: [{ projectId: "proj_mg7kkot", answerKeyPath: "k.md" }], base: "https://central.example", maskIds: true },
      { userKey: USER_KEY, fetchImpl: fakeFetch(), git: noGit, readFile: () => ANSWER_KEY_FILLED, cwd: ROOT },
    );
    const files = { "prev.json": first.json, "k.md": ANSWER_KEY_FILLED };
    const again = await runPilotMetrics(
      { cases: [], snapshotIn: "prev.json", maskIds: true },
      {
        userKey: null,
        fetchImpl: async () => {
          throw new Error("네트워크를 쓰면 안 됨");
        },
        git: noGit,
        readFile: (p) => files[path.basename(p)],
        cwd: ROOT,
      },
    );
    assert.deepEqual(again.result.summary, first.result.summary);
    assert.equal(again.result.sources.api, null);
  });

  it("케이스가 없거나 userKey가 없으면 멈춘다", async () => {
    await assert.rejects(() => runPilotMetrics({ cases: [], maskIds: true }, { userKey: USER_KEY }), /--case가 하나도 없어요/);
    await assert.rejects(
      () => runPilotMetrics({ cases: [{ projectId: "proj_mg7kkot", answerKeyPath: null }], base: "x", maskIds: true }, { userKey: null, git: noGit }),
      /userKey가 없어요/,
    );
  });

  it("computeCase: 정답지 없는 건도 계산은 하되 경고", () => {
    const c = computeCase({ projectId: "proj_mg7kkot", collected: { project: sanitizeProject(PROJECT), runs: runsFor([RUN1]), errors: [] } });
    assert.ok(c.warnings.some((w) => w.includes("정답지 없음")));
    assert.equal(c.door, null);
  });

  it("computeCase: 선기록이 깨졌으면(늦음·미커밋·기대 칸 변경) 경고로도 올린다 — 표 한 칸에만 묻히지 않게", () => {
    const base = { projectId: "proj_mg7kkot", answerKey: parseAnswerKey(ANSWER_KEY_FILLED), collected: { project: sanitizeProject(PROJECT), runs: runsFor([RUN1]), errors: [] } };
    assert.ok(computeCase({ ...base, preRegistration: { status: "late" } }).warnings.some((w) => w.includes("선기록 아님")));
    assert.ok(computeCase({ ...base, preRegistration: { status: "not_committed" } }).warnings.some((w) => w.includes("커밋되지 않았어요")));
    assert.ok(
      computeCase({ ...base, preRegistration: { status: "ok", expectedChangedFields: ["기대 판정"] } }).warnings.some((w) => w.includes("기대 칸이 바뀌었어요: 기대 판정")),
    );
    assert.deepEqual(computeCase({ ...base, preRegistration: { status: "ok", expectedChangedFields: [] } }).warnings, []);
  });
});

// ─── 드리프트 가드 (라이브 대시보드 문구와 일치) ─────────────────────────────────────

describe("드리프트 가드", () => {
  const dictionary = read("apps/dashboard/src/i18n/dictionary.mjs");

  it("user_verdict 화면 문구 = dictionary.mjs visualChecks.userVerdict.options", () => {
    for (const [k, label] of Object.entries(USER_VERDICT_LABEL_KO)) assert.ok(dictionary.includes(`${k}: "${label}"`), `${k}: "${label}"`);
  });

  it("판정 문구 = nondev-report.ts DECISION_LABEL.ko", () => {
    const src = read("apps/central-plane/src/nondev-report.ts");
    for (const [k, label] of Object.entries(DECISION_LABEL_KO)) {
      const key = /\s/.test(k) ? `"${k}"` : k;
      assert.ok(src.includes(`${key}: "${label}"`), `${key}: "${label}"`);
    }
  });

  it("런북의 「화면 문구」는 전부 dictionary.mjs에 문자열 그대로 있다", () => {
    const runbook = read("docs/pilot-2026-10/RUNBOOK.md");
    const labels = [...new Set([...runbook.matchAll(/「([^」]+)」/g)].map((m) => m[1]))];
    assert.ok(labels.length >= 15, `라벨 ${labels.length}개`);
    const missingLabels = labels.filter((l) => !dictionary.includes(`"${l}"`));
    assert.deepEqual(missingLabels, []);
  });

  it("maskId", () => {
    assert.equal(maskId("wvc_mg7aaa11"), "wvc_…aa11");
    assert.equal(maskId("proj_mg7kkot"), "proj_…kkot");
    assert.equal(maskId(null), "—");
  });
});
