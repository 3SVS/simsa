// Train C · C-3 — 확인 영수증 (재정렬 D-19 amend).
//
// 한 번의 확인이 **무엇을, 언제, 어디까지** 봤는지 한 장에 모은다: 확인한 주소·의도·시각, 항목별 결과,
// 못 본 것, 그리고 수리가 있었다면 **고친 내용**과 **다시 확인한 증거**를 서로 다른 섹션으로.
// 고친 주체(수리 잡)와 판정 주체(고친 뒤 실제 앱을 다시 연 별도 확인)가 섞이면 영수증이 스스로를
// 보증하는 문서가 된다 — 그래서 두 섹션은 서로의 필드를 갖지 않는다(테스트로 고정).
//
// 마이그레이션 없음: 기존 GET 상세(check) · 수리 잡(repair) · 목록(checks)만 조합한다. 재검수는
// repair.verifyCheckId(수리 뒤 verify-sweep이 돌린 확인)가 먼저, 없으면 sourceCheckId로 이 런을 가리키는
// 가장 최근 런.
//
// PURE — 네트워크·저장소·시간 없음. 사용자에게 보이는 말은 전부 사전(t.visualChecks.receipt.*)에서 온다.
// 숫자 점수 없음(개수는 있다: 바뀐 파일 수).

import { hasSomethingToFix, isEnvCause, repairDoneKind } from "./repair-state.mjs";
import { normalizeUserVerdict, userVerdictLabel } from "./user-verdict.mjs";
import { verdictLabel } from "./visual-check-view.mjs";

/** @param {unknown} v */
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 지시서 수용 기준 결과 → 영수증 표의 결과. not_run은 표가 아니라 '못 본 것'으로 간다. */
const AC_STATUS = { no_problem: "pass", broken: "broken", not_confirmed: "notConfirmed" };

/**
 * 핵심 흐름 한 줄의 결과. "문제를 찾지 못했어요"(Conditionally Ready)는 확인이 아니라 **못 찾은** 것이라
 * 통과로 부풀리지 않는다(visual-check-view.mjs verdictLabel과 같은 구분).
 * @param {{ works?: unknown, decision?: unknown }} check
 */
function coreFlowStatus(check) {
  if (check.works === true) return "pass";
  if (check.works === false) return "broken";
  if (check.decision === "Conditionally Ready") return "noProblemFound";
  return "notConfirmed";
}

/** @param {unknown} report */
function acceptanceItems(report) {
  const ac = isObj(report) ? report.acceptance : null;
  const items = isObj(ac) && Array.isArray(ac.items) ? ac.items : [];
  return items.filter(isObj);
}

/** 고친 내용 링크는 https만 — 서버가 준 값이라도 다른 스킴은 링크로 만들지 않는다. @param {unknown} v */
function httpsUrl(v) {
  const s = str(v);
  return s !== null && /^https:\/\//i.test(s) ? s : null;
}

/**
 * 수리 잡 → '고친 내용'. 판정(works·decision·resolved)은 여기에 두지 않는다 — 그건 '다시 확인한 증거'의 몫.
 * @param {Record<string, unknown>} repair
 */
function fixView(repair) {
  const status =
    repair.status === "done" ? "done" : repair.status === "queued" || repair.status === "running" ? "active" : "failed";
  const kind = repairDoneKind(repair);
  const codeChanged = status === "done" && kind === "autoFix";
  const files = repair.changedFiles;
  return {
    status,
    kind,
    changesUrl: httpsUrl(repair.prUrl),
    changedFiles: codeChanged && typeof files === "number" && Number.isInteger(files) && files >= 0 ? files : null,
    buildCheck: codeChanged ? (repair.buildVerified === true ? "passed" : repair.buildVerified === false ? "unverified" : null) : null,
    envCause: isEnvCause(repair),
  };
}

/**
 * 목록의 재검수 런 → '다시 확인한 증거'. 고친 쪽 필드(링크·파일 수·점검)는 두지 않는다.
 * @param {Record<string, unknown>} item
 * @param {"afterFix" | "sourceCheck"} via
 */
function recheckFromItem(item, via) {
  const runId = String(item.id);
  if (item.status === "done") {
    return {
      state: "done",
      runId,
      works: item.works === true ? true : item.works === false ? false : null,
      decision: str(item.decision) ?? "",
      at: str(item.createdAt) ?? "",
      via,
    };
  }
  if (item.status === "failed") return { state: "failed", runId };
  return { state: "active", runId };
}

/**
 * @param {Record<string, unknown>} check
 * @param {Record<string, unknown> | null} repair
 * @param {unknown[]} list
 */
function pickRecheck(check, repair, list) {
  const items = list.filter(isObj).filter((c) => str(c.id) !== null && c.id !== check.id);
  const verifyId = repair ? str(repair.verifyCheckId) : null;
  if (verifyId !== null) {
    const hit = items.find((c) => c.id === verifyId);
    if (hit) return recheckFromItem(hit, "afterFix");
    // 목록(최근 50개)에 없거나 목록을 못 읽었다 — 이어진 기록과 수리 잡에 찍힌 결과만 말한다.
    return { state: "linked", runId: verifyId, resolved: repair?.resolved === true ? true : repair?.resolved === false ? false : null };
  }
  const mine = items
    .filter((c) => c.sourceCheckId === check.id)
    .sort((a, b) => {
      const x = String(a.createdAt ?? "");
      const y = String(b.createdAt ?? "");
      return x < y ? 1 : x > y ? -1 : 0;
    });
  const latest = mine[0];
  return latest ? recheckFromItem(latest, "sourceCheck") : { state: "none" };
}

/**
 * 다음 할 일 하나.
 * @param {Record<string, unknown>} check
 * @param {{ status: string } | null} fix
 * @param {{ state: string, runId?: string }} recheck
 */
function nextAction(check, fix, recheck) {
  if ((recheck.state === "done" || recheck.state === "active" || recheck.state === "linked") && recheck.runId) {
    return { kind: "viewRecheck", runId: recheck.runId };
  }
  if (fix?.status === "done") return { kind: "recheckAfterFix" };
  if (fix?.status === "active") return { kind: "viewRepair" };
  if (hasSomethingToFix(check)) return { kind: "fix" };
  if (normalizeUserVerdict(check.userVerdict) === null) return { kind: "tellUs" };
  return { kind: "backToProject" };
}

/**
 * 영수증 뷰 모델.
 *
 * @param {{ check: unknown, repair?: unknown, checks?: unknown }} input
 *   check  — GET 상세의 check (없으면 missing)
 *   repair — GET …/repair의 repair (null = 수리 없음, undefined = 못 읽음 — 둘 다 '고친 내용' 없음)
 *   checks — GET 목록의 checks (재검수 찾기; 못 읽었으면 null)
 */
export function buildReceiptView(input) {
  const check = input?.check;
  if (!isObj(check)) return { state: "missing" };
  if (check.status === "failed") return { state: "failed" };
  if (check.status !== "done") return { state: "notReady", status: String(check.status ?? "") };

  const report = isObj(check.report) ? check.report : null;
  const intent = str(report?.intent) ?? str(check.intent) ?? "";
  const acItems = acceptanceItems(report);

  const items =
    acItems.length > 0
      ? {
          basis: "acceptance",
          rows: acItems
            .filter((a) => a.status !== "not_run")
            .map((a) => ({
              title: str(a.featureTitle) ?? "",
              expected: str(a.then),
              status: AC_STATUS[/** @type {keyof typeof AC_STATUS} */ (String(a.status))] ?? "notConfirmed",
            })),
        }
      : { basis: "coreFlow", rows: [{ title: intent, expected: null, status: coreFlowStatus(check) }] };

  // 못 본 것 — 로그인 뒤는 확언 판정(Ready: 로그인 왕복까지 확인된 유일한 판정)이 아니면 언제나.
  const notSeen = [];
  if (check.decision !== "Ready") notSeen.push({ kind: "loginBehind" });
  const notReached = acItems.filter((a) => a.status === "not_run").map((a) => str(a.featureTitle)).filter((s) => s !== null);
  if (notReached.length > 0) notSeen.push({ kind: "notReached", titles: notReached });
  notSeen.push({ kind: "otherPaths" });

  const repair = isObj(input.repair) ? input.repair : null;
  const fix = repair ? fixView(repair) : null;
  const recheck = pickRecheck(check, repair, Array.isArray(input.checks) ? input.checks : []);

  return {
    state: "ready",
    runId: String(check.id ?? ""),
    checked: { targetUrl: str(check.targetUrl) ?? "", intent, at: str(check.createdAt) ?? "" },
    verdict: { works: check.works === true ? true : check.works === false ? false : null, decision: str(check.decision) ?? "" },
    userVerdict: normalizeUserVerdict(check.userVerdict),
    source: str(check.sourceCheckId) !== null ? { runId: String(check.sourceCheckId) } : null,
    items,
    notSeen,
    fix,
    recheck,
    // 고칠 것이 있거나 고쳤거나 다시 확인했으면 '다시 확인한 증거' 칸을 둔다(없으면 "아직"이라고 말한다).
    showRecheck: fix !== null || recheck.state !== "none" || hasSomethingToFix(check),
    nextAction: nextAction(check, fix, recheck),
  };
}

/**
 * '못 본 것' 한 줄.
 * @param {{ kind: string, titles?: string[] }} n
 * @param {{ notSeen: Record<string, string> }} r
 */
export function notSeenText(n, r) {
  if (n.kind === "notReached") return r.notSeen.notReached.replace("{items}", (n.titles ?? []).join(", "));
  return r.notSeen[n.kind] ?? "";
}

/**
 * 인쇄·붙여넣기용 글 한 덩어리. 섹션 순서는 화면과 같다: 확인한 것 → 항목 → 못 본 것 → 고친 내용 →
 * 다시 확인한 증거 → 정직 문구.
 *
 * @param {ReturnType<typeof buildReceiptView>} view
 * @param {any} t 사전(Dictionary)
 * @param {(iso: string) => string} formatDate
 * @param {{ partial?: boolean }} [opts] partial — 수리·목록을 못 읽었다(빠진 섹션이 있을 수 있음을 글에도 적는다)
 */
export function receiptPlainText(view, t, formatDate, opts = {}) {
  const r = t.visualChecks.receipt;
  if (view.state !== "ready") return `${r.title}\n${view.state === "failed" ? r.failed : r.notReady}`;
  const lines = [r.title];
  if (opts.partial) lines.push(r.partialLoad);
  lines.push("", `[${r.sectionChecked}]`);
  lines.push(`${r.address}: ${view.checked.targetUrl}`);
  lines.push(`${r.intent}: ${view.checked.intent}`);
  lines.push(`${r.checkedAt}: ${formatDate(view.checked.at)}`);
  lines.push(`${r.resultLabel}: ${verdictLabel(view.verdict.works, view.verdict.decision, t).label}`);
  lines.push(`${r.yourAnswer}: ${view.userVerdict ? userVerdictLabel(view.userVerdict, t) : r.yourAnswerNone}`);
  if (view.source) lines.push(r.sourceNote);

  lines.push("", `[${view.items.basis === "acceptance" ? r.itemsTitleAcceptance : r.itemsTitleCoreFlow}]`);
  if (view.items.rows.length === 0) lines.push(r.itemsNoneReached);
  for (const row of view.items.rows) {
    lines.push(`- ${row.title} — ${r.status[row.status]}${row.expected ? ` (${r.colExpected}: ${row.expected})` : ""}`);
  }

  lines.push("", `[${r.notSeenTitle}]`);
  for (const n of view.notSeen) lines.push(`- ${notSeenText(n, r)}`);

  if (view.fix) {
    const f = view.fix;
    lines.push("", `[${r.fixTitle}]`, r.fixBy);
    if (f.status === "active") lines.push(r.fixActive);
    else if (f.status === "failed") lines.push(r.fixFailed);
    else lines.push(f.kind === "autoFix" ? r.fixAutoFix : r.fixBriefOnly);
    if (f.changedFiles !== null) lines.push(r.changedFiles.replace("{count}", String(f.changedFiles)));
    if (f.buildCheck === "passed") lines.push(r.buildPassed);
    if (f.buildCheck === "unverified") lines.push(r.buildUnverified);
    if (f.envCause) lines.push(t.visualChecks.repair.envCauseWarning);
    if (f.changesUrl) lines.push(`${r.openChanges}: ${f.changesUrl}`);
  }

  if (view.showRecheck) {
    const c = view.recheck;
    lines.push("", `[${r.recheckTitle}]`);
    if (c.state === "done") {
      lines.push(r.recheckBy);
      lines.push(`${r.recheckResult}: ${verdictLabel(c.works, c.decision, t).label}`);
      lines.push(`${r.recheckAt}: ${formatDate(c.at)}`);
    } else if (c.state === "linked") {
      lines.push(r.recheckBy);
      lines.push(c.resolved === true ? r.recheckLinkedWorks : c.resolved === false ? r.recheckLinkedBroken : r.recheckLinked);
    } else if (c.state === "active") lines.push(r.recheckActive);
    else if (c.state === "failed") lines.push(r.recheckFailed);
    else lines.push(r.recheckNone);
  }

  lines.push("", r.notAGuarantee);
  return lines.join("\n");
}
