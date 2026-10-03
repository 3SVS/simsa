/**
 * lib/pilot-metrics.mjs — Train P · P-2 파일럿 지표의 **순수 부분** (신규, 2026-09-30).
 *
 * 네트워크·파일·git을 만지지 않는다. 수집(fetch)과 git 읽기는 ../pilot-metrics.mjs가
 * 주입 가능한 seam으로 하고, 여기서는 모인 값을 해석·계산·렌더만 한다.
 *
 * 정의(판정 매핑·6축·불일치·시간)는 docs/pilot-2026-10/RUNBOOK.md §4에 **사전 등록**된
 * 표와 같다. 이 파일의 표를 바꾸면 런북에 정정 절(날짜·이유)을 추가해야 한다 — 실행 뒤
 * 규칙을 조용히 바꾸면 사전 등록이 무의미해진다.
 *
 * 과거 교훈(개수만 세는 계측 재발, 2026-09-01): 개수만 남기지 않는다. 런마다 원문 판정
 * (decision · 리포트 verdict · oneLine)과 발견(코드 · severity · what 문장)을 함께 저장한다.
 */

export const AXES = Object.freeze(["region", "built_with", "topic", "finding_code", "user_verdict", "resolved"]);

/** 정답지 '기대 판정' 4칸 (docs/pilot-2026-10/answer-key-TEMPLATE.md). */
export const EXPECTED_JUDGMENTS = Object.freeze(["작동해요", "문제를 찾지 못했어요", "안 돼요", "사람 확인 필요"]);

/** 사람 수용 라벨 (apps/central-plane/src/workspace/visual-check-db.ts USER_VERDICTS). */
export const USER_VERDICTS = Object.freeze(["as_intended", "works_but_different", "still_broken", "unsure"]);

/** 화면 문구 — apps/dashboard/src/i18n/dictionary.mjs visualChecks.userVerdict.options (ko). 테스트가 드리프트를 잡는다. */
export const USER_VERDICT_LABEL_KO = Object.freeze({
  as_intended: "생각대로 됐어요",
  works_but_different: "되긴 하는데 달라요",
  still_broken: "아직 안 돼요",
  unsure: "모르겠어요",
});

/** 판정 화면 문구 — apps/central-plane/src/nondev-report.ts DECISION_LABEL.ko. 테스트가 드리프트를 잡는다. */
export const DECISION_LABEL_KO = Object.freeze({
  Ready: "정상 작동해요",
  "Conditionally Ready": "문제를 찾지 못했어요",
  "Needs Fix": "작동 안 해요 — 고쳐야 해요",
  "Not Verified": "확인 못 했어요",
  "Needs Clarification": "무엇을 확인해야 할지 애매해요",
  "Needs Evidence": "판단할 근거가 부족해요",
  "Needs Expert Review": "전문가 확인이 필요해요",
  "User Acceptance Required": "직접 눈으로 확인이 필요해요",
  "Do Not Build Yet": "아직 만들 때가 아니에요",
  "Not Applicable": "해당 없음",
  "Not Judged": "판단하지 않았어요",
});

/** 정답지 '실행 후 · 실패 지점 일치 여부' 3칸 — 사람이 적는다. 이 도구는 읽기만 한다. */
export const FAILURE_POINT_MATCHES = Object.freeze(["예측 적중", "다른 곳", "실패 없음"]);

// ─── 판정 매핑 (RUNBOOK §4.1 사전 등록) ─────────────────────────────────────────

/** decision → 정답지 4칸. 나머지 decision은 전부 '사람 확인 필요'. */
const BUCKET_BY_DECISION = Object.freeze({
  Ready: "작동해요",
  "Conditionally Ready": "문제를 찾지 못했어요",
  "Needs Fix": "안 돼요",
});

/** 4칸 → 수용 쪽. accept = 받아들일 만함 / reject = 안 됨 / abstain = 판정 보류. */
const SIDE_BY_BUCKET = Object.freeze({
  작동해요: "accept",
  "문제를 찾지 못했어요": "accept",
  "안 돼요": "reject",
  "사람 확인 필요": "abstain",
});

/**
 * 끝난(done) 런의 기계 판정을 정답지 4칸으로. done이 아니면(진행 중·실패) null —
 * 검수 실패는 판정이 아니라 실행 문제다(따로 센다).
 * @param {{ status?: unknown, decision?: unknown } | null | undefined} run
 * @returns {string | null}
 */
export function decisionBucket(run) {
  if (!run || run.status !== "done") return null;
  const d = typeof run.decision === "string" ? run.decision : "";
  return BUCKET_BY_DECISION[d] ?? "사람 확인 필요";
}

/** @param {string | null | undefined} bucket @returns {"accept"|"reject"|"abstain"|null} */
export function bucketSide(bucket) {
  if (typeof bucket !== "string") return null;
  return /** @type {any} */ (SIDE_BY_BUCKET)[bucket] ?? null;
}

/**
 * 사람 라벨 → 수용 쪽. works_but_different는 "되긴 하지만 의도와 다름" = 수용 안 됨(reject).
 * unsure·없음은 라벨이 아니다(null).
 * @param {unknown} v @returns {"accept"|"reject"|null}
 */
export function humanSide(v) {
  if (v === "as_intended") return "accept";
  if (v === "still_broken" || v === "works_but_different") return "reject";
  return null;
}

/** @param {unknown} v @returns {string | null} */
export function normalizeUserVerdict(v) {
  return typeof v === "string" && /** @type {readonly string[]} */ (USER_VERDICTS).includes(v) ? v : null;
}

// ─── 리포트 → 발견 (서버 규칙 미러) ─────────────────────────────────────────────

function isOptString(v) {
  return v === undefined || typeof v === "string";
}

/**
 * 서버 enrichReportForStorage(apps/central-plane/src/routes/workspace-visual-check-runs.ts)와
 * 같은 규칙: 리포트 모양이 아니면 null(기록 안 됨), 발견 0건이면 [](측정됨·없음), 발견이 있는데
 * 코드가 하나도 없으면 null(옛 컨테이너 — 모름).
 * @param {unknown} report @returns {string[] | null}
 */
export function findingCodesFromReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const r = /** @type {Record<string, unknown>} */ (report);
  if (!isOptString(r.target) || !isOptString(r.intent) || !isOptString(r.verdict) || !isOptString(r.oneLine)) return null;
  if (!(r.works === undefined || r.works === null || typeof r.works === "boolean")) return null;
  if (!Array.isArray(r.findings)) return null;
  for (const f of r.findings) {
    if (!f || typeof f !== "object") return null;
    const o = /** @type {Record<string, unknown>} */ (f);
    if (typeof o.severity !== "string" || typeof o.what !== "string") return null;
    if (!isOptString(o.why) || !isOptString(o.how) || !isOptString(o.code)) return null;
  }
  if (r.findings.length === 0) return [];
  const codes = r.findings
    .map((f) => /** @type {Record<string, unknown>} */ (f).code)
    .filter((c) => typeof c === "string" && c.length > 0);
  return codes.length > 0 ? /** @type {string[]} */ (codes) : null;
}

/**
 * 발견 원문(코드 · severity · what 문장). 개수가 아니라 내용을 남긴다.
 * @param {unknown} report @returns {Array<{ code: string | null, severity: string | null, what: string }>}
 */
export function findingsFromReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return [];
  const list = /** @type {Record<string, unknown>} */ (report).findings;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f === "object")
    .map((f) => {
      const o = /** @type {Record<string, unknown>} */ (f);
      return {
        code: typeof o.code === "string" && o.code ? o.code : null,
        severity: typeof o.severity === "string" ? o.severity : null,
        what: typeof o.what === "string" ? o.what.slice(0, 400) : "",
      };
    });
}

/** D1 finding_codes_json 문자열 → string[] | null (visual-check-db.ts parseCodes와 같다). */
export function parseCodesJson(json) {
  if (typeof json !== "string") return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : null;
  } catch {
    return null;
  }
}

// ─── 수집 결과 정리 (화이트리스트 — userKey 같은 필드는 애초에 옮기지 않는다) ─────────

function str(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * GET /workspace/projects/:id 응답의 project → 필요한 칸만. 응답에는 userKey가 들어 있다
 * (DbProject) — 그래서 복사가 아니라 화이트리스트다.
 * @param {unknown} p
 */
export function sanitizeProject(p) {
  if (!p || typeof p !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (p);
  return {
    id: str(o.id),
    title: typeof o.title === "string" ? o.title.slice(0, 200) : null,
    entryPath: str(o.entryPath),
    builtWith: o.builtWith ?? null,
    topicTags: o.topicTags ?? null,
    regionAtCreate: str(o.regionAtCreate),
    createdAt: str(o.createdAt),
  };
}

/**
 * 목록 항목 + 상세 + 최신 수리 잡 → 한 런. 상세가 없으면(조회 실패) 목록 값으로 채우고 표시한다.
 * @param {{ item: any, detail?: any, repair?: any }} input
 */
export function sanitizeRun({ item, detail = null, repair = null }) {
  const src = detail ?? item ?? {};
  const report = detail ? detail.report : undefined;
  return {
    id: str(src.id) ?? str(item?.id),
    createdAt: str(src.createdAt) ?? str(item?.createdAt),
    status: str(src.status) ?? str(item?.status),
    decision: str(src.decision) ?? str(item?.decision),
    works: typeof src.works === "boolean" ? src.works : null,
    verdictText: report && typeof report === "object" ? str(report.verdict) : null,
    oneLine: report && typeof report === "object" ? str(report.oneLine) : null,
    findings: findingsFromReport(report),
    findingCodes: detail ? findingCodesFromReport(report) : null,
    findingCodesSource: detail ? "api-report" : "none",
    findingCodesD1: undefined,
    userVerdict: normalizeUserVerdict(src.userVerdict ?? item?.userVerdict),
    userVerdictAt: str(src.userVerdictAt) ?? str(item?.userVerdictAt),
    sourceCheckId: str(src.sourceCheckId) ?? str(item?.sourceCheckId),
    targetUrl: str(src.targetUrl) ?? str(item?.targetUrl),
    intent: detail ? str(detail.intent) : null,
    doneAt: null,
    runRegion: null,
    repair: repair && typeof repair === "object"
      ? {
          id: str(repair.id),
          status: str(repair.status),
          mode: str(repair.mode),
          resolved: typeof repair.resolved === "boolean" ? repair.resolved : null,
          verifyCheckId: str(repair.verifyCheckId),
          buildVerified: typeof repair.buildVerified === "boolean" ? repair.buildVerified : null,
          createdAt: str(repair.createdAt),
          updatedAt: str(repair.updatedAt),
        }
      : null,
    detailMissing: !detail,
  };
}

/**
 * 선택 입력: 로컬 wrangler로 뽑은 D1 행(id·created_at·updated_at·status·region·finding_codes_json).
 * API가 주지 않는 **완료 시각**(done/failed 행의 updated_at — verdict 저장은 updated_at을 건드리지
 * 않는다, visual-check-db.ts setVisualCheckUserVerdict)과 런 단위 region을 붙인다.
 * @param {Array<ReturnType<typeof sanitizeRun>>} runs @param {Array<Record<string, unknown>>} rows
 */
export function mergeD1Rows(runs, rows) {
  const byId = new Map();
  for (const r of rows ?? []) if (r && typeof r.id === "string") byId.set(r.id, r);
  return runs.map((run) => {
    const row = run.id ? byId.get(run.id) : undefined;
    if (!row) return run;
    const status = typeof row.status === "string" ? row.status : run.status;
    return {
      ...run,
      doneAt: status === "done" || status === "failed" ? str(row.updated_at) : null,
      runRegion: str(row.region),
      findingCodesD1: parseCodesJson(row.finding_codes_json),
    };
  });
}

// ─── 6축 (RUNBOOK §4.2 사전 등록) ───────────────────────────────────────────────

/** @typedef {{ state: "filled"|"recorded_empty"|"missing", value: string|null, source: string, reason: string|null }} AxisCell */

/** @returns {AxisCell} */
function filled(value, source) {
  return { state: "filled", value, source, reason: null };
}
/** @returns {AxisCell} */
function missing(reason, source) {
  return { state: "missing", value: null, source, reason };
}

/** builtWith({ tools, other }) → 표시 문자열 | null. 서버 normalizeBuiltWith 모양. */
export function builtWithValue(bw) {
  if (!bw || typeof bw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (bw);
  const tools = Array.isArray(o.tools) ? o.tools.filter((t) => typeof t === "string" && t) : [];
  const other = typeof o.other === "string" && o.other.trim() ? `기타: ${o.other.trim()}` : null;
  const parts = [...tools, ...(other ? [other] : [])];
  return parts.length > 0 ? parts.join(", ") : null;
}

/** topicTags({ domain, pattern, integrations, ai_feature }) → { state, value }. */
export function topicState(tt) {
  if (!tt || typeof tt !== "object" || Array.isArray(tt)) return { state: "missing", value: null };
  const o = /** @type {Record<string, unknown>} */ (tt);
  const parts = [];
  for (const k of ["domain", "pattern", "ai_feature"]) if (typeof o[k] === "string" && o[k]) parts.push(`${k}=${o[k]}`);
  const integ = Array.isArray(o.integrations) ? o.integrations.filter((x) => typeof x === "string" && x) : [];
  if (integ.length) parts.push(`integrations=${integ.join("+")}`);
  return parts.length ? { state: "filled", value: parts.join(" · ") } : { state: "recorded_empty", value: null };
}

function byCreated(a, b) {
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

/**
 * 수리 잡은 있는데 resolved가 비었을 때의 **실제** 이유. verify-sweep이 재검수를 걸면 수리 잡에
 * verifyCheckId가 붙는다(verify-sweep.ts setRepairJobVerifyCheck) — 그게 있으면 "머지 신호 없음"이
 * 아니다. 가장 최근 수리 잡을 기준으로 본다.
 * @param {Array<any>} repairs @param {Array<any>} runs (생성 순)
 */
function resolvedMissingReason(repairs, runs) {
  const withVerify = repairs.filter((j) => j.verifyCheckId);
  if (withVerify.length === 0) {
    return "수리 뒤 자동 재검수(verify-sweep)가 아직 없음 — 수리 PR 머지 신호(Simsa GitHub 앱이 설치된 저장소)가 있어야 돈다";
  }
  const verifyId = withVerify[withVerify.length - 1].verifyCheckId;
  const v = runs.find((r) => r.id === verifyId) ?? null;
  if (!v) return "자동 재검수 런을 이 건의 런 목록에서 찾지 못함";
  if (v.status === "failed") return "자동 재검수가 실패로 끝남 — 실패 런은 resolved를 찍지 않는다";
  if (v.status !== "done") return "자동 재검수가 아직 끝나지 않음";
  return `자동 재검수는 끝났지만 판정이 ${v.decision ?? "—"}(works=null)이라 NULL — resolved는 Ready(1)·Needs Fix(0)에서만 찍힌다`;
}

/**
 * 건 하나의 6축. 각 축은 출처가 하나다(섞지 않는다):
 *   region       project.regionAtCreate (API)
 *   built_with   project.builtWith (API) — 도구가 하나라도 있어야 채움
 *   topic        project.topicTags (API) — 값이 하나라도 있어야 채움(빈 분류 = recorded_empty, 채움 아님)
 *   finding_code 끝난 런 **전부**의 코드 기록(D1 행이 있으면 D1 칸, 없으면 API 리포트에서 서버 규칙대로) — []도 채움
 *   user_verdict **마지막 끝난 런**의 사람 라벨
 *   resolved     이 건의 수리 잡 중 하나라도 resolved 기록 — 수리 잡이 없으면(붙여넣기 경로) 비움.
 *                비는 이유는 셋으로 나눈다(PR #570 검증 P2): 자동 재검수가 아직 없음 / 재검수가 안
 *                끝남·실패 / 재검수는 끝났지만 works=null. 완료 콜백은 works===null이면 resolved를
 *                찍지 않는다(central-plane repair-job-db.ts resolveRepairJobsByVerifyCheck,
 *                0069 "판정 불가 → NULL 유지") — works=true는 Ready(로그인 뒤 왕복 확인)뿐이고
 *                (nondev-report.ts decisionToWorks · decideFromEvidence), 흔한 성공 결과인
 *                "문제를 찾지 못했어요"(Conditionally Ready)는 NULL로 남는다.
 */
export function evaluateAxes(project, runs) {
  const p = project ?? {};
  const sorted = [...(runs ?? [])].sort(byCreated);
  const done = sorted.filter((r) => r.status === "done");
  const finalDone = done.length ? done[done.length - 1] : null;

  /** @type {Record<string, AxisCell>} */
  const axes = {};
  axes.region = p.regionAtCreate
    ? filled(p.regionAtCreate, "project.regionAtCreate")
    : missing(project ? "project.regionAtCreate 없음" : "프로젝트를 읽지 못함", "project.regionAtCreate");

  const bw = builtWithValue(p.builtWith);
  axes.built_with = bw
    ? filled(bw, "project.builtWith")
    : missing(project ? "도구 선택 없음(선택 칸을 건너뜀)" : "프로젝트를 읽지 못함", "project.builtWith");

  const tp = topicState(p.topicTags);
  axes.topic =
    tp.state === "filled"
      ? filled(tp.value, "project.topicTags")
      : tp.state === "recorded_empty"
        ? { state: "recorded_empty", value: null, source: "project.topicTags", reason: "분류는 돌았지만 해당 키워드 없음" }
        : missing(project ? "topicTags 없음" : "프로젝트를 읽지 못함", "project.topicTags");

  if (done.length === 0) {
    axes.finding_code = missing("끝난 런 없음", "run.findingCodes");
  } else {
    const codesOf = (r) => (r.findingCodesD1 !== undefined ? r.findingCodesD1 : r.findingCodes);
    const source = done.some((r) => r.findingCodesD1 !== undefined) ? "D1 finding_codes_json" : "API report.findings[].code";
    const unrecorded = done.filter((r) => codesOf(r) === null);
    if (unrecorded.length === 0) {
      const shown = done.map((r) => {
        const c = codesOf(r);
        return c.length ? c.join("+") : "[] 발견 0";
      });
      axes.finding_code = filled(shown.join(" → "), source);
    } else {
      axes.finding_code = missing(`코드 기록 없는 런 ${unrecorded.length}/${done.length}`, source);
    }
  }

  if (finalDone?.userVerdict) {
    axes.user_verdict = filled(finalDone.userVerdict, "마지막 런 userVerdict");
  } else {
    const earlier = done.some((r) => r.userVerdict);
    axes.user_verdict = missing(
      done.length === 0 ? "끝난 런 없음" : earlier ? "마지막 런에 답 없음(앞 런에만 있음)" : "답 없음",
      "마지막 런 userVerdict",
    );
  }

  const repairs = sorted.map((r) => r.repair).filter(Boolean);
  const resolvedJobs = repairs.filter((j) => j.resolved === true || j.resolved === false);
  if (resolvedJobs.length > 0) {
    axes.resolved = filled(resolvedJobs.map((j) => (j.resolved ? "1" : "0")).join(","), "repair.resolved");
  } else if (repairs.length === 0) {
    axes.resolved = missing(
      "수리 잡 없음 — 붙여넣기 경로는 resolved를 기록하지 않는다(0069: workspace_repair_jobs 전용)",
      "repair.resolved",
    );
  } else {
    axes.resolved = missing(resolvedMissingReason(repairs, sorted), "repair.resolved");
  }
  const filledCount = AXES.filter((a) => axes[a]?.state === "filled").length;
  return { axes, filledCount, fillRate: filledCount / AXES.length };
}

// ─── 판정 vs 사람 라벨 (RUNBOOK §4.1·§4.3) ─────────────────────────────────────

/**
 * 두 쪽(accept/reject/abstain)의 관계. 한쪽만 보류(abstain)면 "abstain_mismatch" — 맞다·틀리다가
 * 아니라 한쪽이 판단하지 않은 것이다(PR #570 검증 P2: L2와 같은 정의).
 * @returns {"same"|"opposite"|"abstain_mismatch"|null}
 */
export function sideRelation(a, b) {
  if (!a || !b) return null;
  if (a === b) return "same";
  if (a === "abstain" || b === "abstain") return "abstain_mismatch";
  return "opposite";
}

/**
 * L1 = 정답지 '기대 판정'(선기록) ↔ 첫 끝난 런의 4칸. L2 = 런마다 기계 쪽 ↔ 그 런의 user_verdict.
 * 건 불일치 = L1이 **반대 쪽**(accept ↔ reject)이거나 L2 충돌이 하나라도 있음.
 * 보류(abstain)는 L1·L2 모두 일치도 불일치도 아니다 — L1 '보류 차이'로 따로 센다(RUNBOOK §4.3).
 * 잴 수 있는 신호(L1 같은/반대 쪽, L2 일치/충돌)가 하나도 없으면 판정 불가(null).
 */
export function evaluateAgreement(runs, expectedJudgment) {
  const done = [...(runs ?? [])].sort(byCreated).filter((r) => r.status === "done");
  const first = done[0] ?? null;
  const actual = decisionBucket(first);
  const expected = typeof expectedJudgment === "string" ? expectedJudgment : null;
  const relation = expected && actual ? sideRelation(bucketSide(expected), bucketSide(actual)) : null;
  const l1 = {
    expected,
    actual,
    firstRunId: first?.id ?? null,
    exact: expected && actual ? expected === actual : null,
    sideAgree: relation === null ? null : relation === "same",
    sideRelation: relation,
  };
  const l2 = done
    .filter((r) => r.userVerdict)
    .map((r) => {
      const bucket = decisionBucket(r);
      const machine = bucketSide(bucket);
      const human = humanSide(r.userVerdict);
      let agree = null;
      let note = null;
      if (human === null) note = "모르겠어요 — 라벨로 세지 않음";
      else if (machine === "abstain") note = "기계 판정 보류";
      else agree = machine === human;
      return { runId: r.id, bucket, decision: r.decision, userVerdict: r.userVerdict, machine, human, agree, note };
    });
  const conflicts = l2.filter((p) => p.agree === false).length;
  const l1Measured = relation === "same" || relation === "opposite";
  let disagreement;
  if (relation === "opposite" || conflicts > 0) disagreement = true;
  else if (!l1Measured && l2.every((p) => p.agree === null)) disagreement = null;
  else disagreement = false;
  return { l1, l2, disagreement };
}

// ─── 시간·재검수 (RUNBOOK §4.4) ─────────────────────────────────────────────────

export function secondsBetween(fromIso, toIso) {
  const a = Date.parse(fromIso ?? "");
  const b = Date.parse(toIso ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

/**
 * 재검수 = sourceCheckId가 있는 런(결과 화면의 「다시 확인」·「수리 확인 재검수」·verify-sweep).
 * 후속 런 = 첫 끝난 런보다 뒤에 만든 런 중 sourceCheckId가 **없는** 런 — 결과 화면에 「다시 확인」이
 * 없는 경로(RUNBOOK §2 4-b: '고칠 것 없음' 결과 → 목록 화면 「지금 검수하기」)는 계보가 남지 않아
 * 재검수로 세지지 않는다(PR #570 검증 P1). 첫 끝난 런 **전**의 재시도(실패 런 뒤 다시 걸기)는 어느
 * 쪽도 아니다.
 */
export function evaluateTime(runs) {
  const sorted = [...(runs ?? [])].sort(byCreated);
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const done = sorted.filter((r) => r.status === "done");
  const firstDone = done[0] ?? null;
  const finalDone = done[done.length - 1] ?? null;
  const afterFirstDone = firstDone ? sorted.slice(sorted.indexOf(firstDone) + 1) : [];
  const followUps = afterFirstDone.filter((r) => !r.sourceCheckId);
  const perRun = sorted.map((r) => ({
    runId: r.id,
    status: r.status,
    createdAt: r.createdAt,
    doneAt: r.doneAt,
    durationSec: secondsBetween(r.createdAt, r.doneAt),
    recheck: Boolean(r.sourceCheckId),
    followUp: followUps.includes(r),
  }));
  return {
    runs: sorted.length,
    doneRuns: done.length,
    failedRuns: sorted.filter((r) => r.status === "failed").length,
    activeRuns: sorted.filter((r) => r.status === "queued" || r.status === "running" || r.status === "uploaded").length,
    recheckCount: sorted.filter((r) => r.sourceCheckId).length,
    hasRecheck: sorted.some((r) => r.sourceCheckId),
    followUpCount: followUps.length,
    firstCreatedAt: first?.createdAt ?? null,
    toFinalRunSec: first && last && first !== last ? secondsBetween(first.createdAt, last.createdAt) : null,
    toVerdictSec: first && finalDone?.userVerdictAt ? secondsBetween(first.createdAt, finalDone.userVerdictAt) : null,
    perRunDurationsMeasured: perRun.some((r) => r.durationSec !== null),
    perRun,
  };
}

// ─── 정답지 파싱 ─────────────────────────────────────────────────────────────────

/** `| a | b |` 줄들 → [[a, b], ...] (머리줄·구분줄 포함 — 호출자가 거른다). */
function tableRows(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // 구분줄
    rows.push(cells);
  }
  return rows;
}

function unbold(s) {
  return String(s ?? "").replace(/\*\*/g, "").trim();
}

/** 2열 표 → Map(필드 → 값). 첫 줄(머리)은 버린다. */
function twoColumnMap(text) {
  const rows = tableRows(text);
  const map = new Map();
  rows.slice(1).forEach((cells) => {
    if (cells.length >= 2) map.set(unbold(cells[0]), unbold(cells.slice(1).join(" | ")));
  });
  return map;
}

function field(map, prefix) {
  for (const [k, v] of map) if (k.startsWith(prefix)) return v;
  return null;
}

/** options 중 정확히 하나만 들어 있으면 그것, 아니면 null(미선택 — 템플릿 그대로이거나 둘 이상). */
export function pickOne(value, options) {
  if (typeof value !== "string" || !value.trim()) return null;
  const hits = options.filter((o) => value.includes(o));
  return hits.length === 1 ? hits[0] : null;
}

function pickVerdict(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const hits = new Set();
  for (const v of USER_VERDICTS) if (value.includes(v)) hits.add(v);
  for (const [v, label] of Object.entries(USER_VERDICT_LABEL_KO)) if (value.includes(label)) hits.add(v);
  return hits.size === 1 ? [...hits][0] : null;
}

function notPlaceholder(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.startsWith("예:") || t === "어느 화면 · 어느 동작 · 어떤 증상" || t === "$") return null;
  return t;
}

/**
 * 정답지(answer-key-*.md) → 기대 칸·실행 후 칸. 템플릿 그대로인 칸은 null + 경고.
 * @param {string} text
 */
export function parseAnswerKey(text) {
  const src = String(text ?? "");
  const warnings = [];
  const title = /^#\s+(.+)$/m.exec(src)?.[1]?.trim() ?? null;
  const caseNoRaw = /건\s*(\d+)\s*\/\s*\d+/.exec(title ?? "")?.[1];
  const caseNo = caseNoRaw ? Number(caseNoRaw) : null;
  const split = src.search(/^##\s*실행 후/m);
  const preText = split >= 0 ? src.slice(0, split) : src;
  const postText = split >= 0 ? src.slice(split) : "";
  const pre = twoColumnMap(preText);
  const post = twoColumnMap(postText);

  const doorRaw = field(pre, "문");
  const doorHits = doorRaw ? [...new Set([...doorRaw.matchAll(/\(([abc])\)/g)].map((m) => m[1]))] : [];
  const door = doorHits.length === 1 ? doorHits[0] : null;
  if (!door) warnings.push("문 (a)/(b)/(c)가 하나로 골라지지 않았어요");

  const expectedJudgment = pickOne(field(pre, "기대 판정"), EXPECTED_JUDGMENTS);
  if (!expectedJudgment) warnings.push("기대 판정이 4칸 중 하나로 골라지지 않았어요");
  const expectedUserVerdict = pickVerdict(field(pre, "기대 user_verdict"));
  if (!expectedUserVerdict) warnings.push("기대 user_verdict가 하나로 골라지지 않았어요");
  const expectedFailurePoint = notPlaceholder(field(pre, "예상 실패 지점"));
  if (!expectedFailurePoint && door !== "a") warnings.push("예상 실패 지점이 비어 있어요");

  const toolRaw = field(pre, "만든 도구");
  const tool = pickOne(toolRaw, ["Lovable", "v0", "Bolt"]);
  const urlMatch = toolRaw ? /https?:\/\/[^\s|)]+/.exec(toolRaw)?.[0] ?? null : null;
  const url = urlMatch && !urlMatch.includes("…") ? urlMatch : null;
  const writtenAt = /\d{4}-\d{2}-\d{2}/.exec(field(pre, "정답지 작성자") ?? "")?.[0] ?? null;

  return {
    title,
    caseNo,
    pre: {
      door,
      intent: notPlaceholder(field(pre, "원래 의도")),
      differs: notPlaceholder(field(pre, "(b)(c) 지금 다른 점")),
      tool,
      url,
      expectedFailurePoint,
      expectedJudgment,
      expectedUserVerdict,
      writtenAt,
    },
    post: {
      failurePointMatch: pickOne(field(post, "실패 지점 일치 여부"), FAILURE_POINT_MATCHES),
      actualJudgmentNote: notPlaceholder(field(post, "실제 판정")),
      memo: notPlaceholder(field(post, "메모")),
    },
    preRaw: Object.fromEntries(pre),
    warnings,
  };
}

/** 기대 칸(실행 전 표)에서 바뀐 필드 이름들. */
export function diffPreFields(before, after) {
  const a = before?.preRaw ?? {};
  const b = after?.preRaw ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => (a[k] ?? null) !== (b[k] ?? null));
}

/**
 * 정답지 선기록 확인. commits는 최신순 [{sha, committedAt}] (git을 못 읽으면 null).
 * textAt(sha)는 그 커밋의 정답지 원문(못 읽으면 null).
 */
export function checkPreRegistration({ commits, dirty = null, firstRunCreatedAt, currentText, textAt }) {
  if (commits === null || commits === undefined) return { status: "unknown", committed: null, note: "git을 읽지 못함" };
  if (commits.length === 0) return { status: "not_committed", committed: false, dirty, note: "커밋 안 됨 — 선기록 증거 없음" };
  const earliest = commits[commits.length - 1];
  const base = { committed: true, sha: earliest.sha, committedAt: earliest.committedAt, dirty };
  const runMs = Date.parse(firstRunCreatedAt ?? "");
  if (!Number.isFinite(runMs)) return { ...base, status: "no_run", firstRunCreatedAt: null, note: "아직 런 없음" };
  const beforeFirstRun = Date.parse(earliest.committedAt) < runMs;
  const lastBefore = commits.find((c) => Date.parse(c.committedAt) < runMs) ?? null;
  let expectedChangedFields = null;
  if (lastBefore && typeof textAt === "function") {
    const baseText = textAt(lastBefore.sha);
    if (typeof baseText === "string") expectedChangedFields = diffPreFields(parseAnswerKey(baseText), parseAnswerKey(currentText));
  }
  return {
    ...base,
    status: beforeFirstRun ? "ok" : "late",
    firstRunCreatedAt,
    beforeFirstRun,
    commitsAfterRun: commits.filter((c) => Date.parse(c.committedAt) >= runMs).length,
    expectedChangedFields,
    // main은 스쿼시 머지라 main 이력의 첫 커밋 시각 = 머지 시각이다(PR #570 검증 P2). 브랜치에만
    // 선기록 커밋이 있으면 그 브랜치를 체크아웃해 다시 돌린다(RUNBOOK §1-2).
    note: beforeFirstRun
      ? null
      : "정답지 첫 커밋이 첫 런보다 늦음 — 선기록 아님(main의 스쿼시 머지 시각일 수 있음: 정답지 브랜치를 체크아웃해 다시 확인)",
  };
}

// ─── 원가 수기 시트 (docs/pilot-2026-10/cost-sheet.md) ──────────────────────────

function numOrNull(v) {
  const t = String(v ?? "").replace(/[$,\s분]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "예 — 한 줄" / "아니오" / yes / no → boolean. `\b`는 한글 뒤에서 경계가 안 생겨 쓰지 않는다. */
function yesNo(v) {
  const t = String(v ?? "").trim().toLowerCase();
  if (/^(예|yes|y)(?![a-z가-힣])/.test(t)) return true;
  if (/^(아니오|아니요|no|n)(?![a-z가-힣])/.test(t)) return false;
  return null;
}

/** 머리줄 이름으로 열을 찾는다(열 순서가 바뀌어도 된다). 건 번호가 없는 줄은 버린다. */
export function parseCostSheet(text) {
  const rows = tableRows(text);
  if (rows.length === 0) return new Map();
  const header = rows[0].map(unbold);
  const col = (name) => header.findIndex((h) => h.startsWith(name));
  const idx = {
    caseNo: col("건"),
    support: col("support_minutes"),
    dispute: col("이의"),
    rework: col("재작업"),
    intervention: col("개입"),
    spent: col("spent_usd"),
    build: col("빌드 결과"),
    memo: col("메모"),
  };
  const out = new Map();
  for (const cells of rows.slice(1)) {
    const n = numOrNull(cells[idx.caseNo]);
    if (n === null) continue;
    const at = (i) => (i >= 0 ? cells[i] ?? "" : "");
    const buildRaw = at(idx.build).trim();
    out.set(n, {
      caseNo: n,
      supportMinutes: numOrNull(at(idx.support)),
      dispute: yesNo(at(idx.dispute)),
      disputeText: at(idx.dispute).trim() || null,
      rework: numOrNull(at(idx.rework)),
      intervention: yesNo(at(idx.intervention)),
      spentUsd: numOrNull(at(idx.spent)),
      buildResult: buildRaw.startsWith("성공") ? "success" : buildRaw.startsWith("실패") ? "failure" : null,
      memo: at(idx.memo).trim() || null,
    });
  }
  return out;
}

// ─── ops-probe d1-readonly 집계 (서비스 전체, 파일럿 한정 아님) ──────────────────

/**
 * ops-probe `d1-readonly` 결과 → 행 배열. wrangler `--json` 출력([{results:[…]}]), 행 객체/배열,
 * 또는 job summary의 마크다운 표(apps/central-plane/scripts/d1-readonly-queries.mjs renderSummary)를 받는다.
 * 모양을 모르면 throw — "못 읽음"이 "0행"처럼 보이면 안 된다.
 */
export function parseOpsFill(text) {
  const src = String(text ?? "").trim();
  const query = /d1-readonly\s*·\s*([a-z0-9-]+)/.exec(src)?.[1] ?? null;
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch {
    parsed = undefined;
  }
  let rows;
  if (parsed !== undefined) {
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && typeof first === "object" && Array.isArray(first.results)) rows = first.results;
    else if (Array.isArray(parsed) && parsed.every((r) => r && typeof r === "object")) rows = parsed;
    else if (parsed && typeof parsed === "object") rows = [parsed];
  } else {
    const t = tableRows(src);
    if (t.length >= 2) {
      const head = t[0];
      rows = t.slice(1).map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? null])));
    }
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("ops-fill: 읽을 수 있는 행이 없어요(모양을 모름)");
  const num = (v) => (v === null || v === undefined || v === "NULL" ? null : Number.isFinite(Number(v)) ? Number(v) : v);
  return { query, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)]))) };
}

/** 집계 행 → 칸별 비율 [{column, filled, scanned}] (rows_scanned가 있는 질의만). */
export function opsFillRatios(ops) {
  const row = ops?.rows?.[0];
  if (!row || typeof row.rows_scanned !== "number") return [];
  return Object.entries(row)
    .filter(([k, v]) => k !== "rows_scanned" && typeof v === "number")
    .map(([column, v]) => ({ column, filled: v, scanned: row.rows_scanned }));
}

// ─── 합계·규칙 (RUNBOOK §5 사전 등록) ─────────────────────────────────────────

export function median(nums) {
  const xs = nums.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

const STATUS_KO = { triggered: "문턱 넘음", clear: "문턱 안 넘음", insufficient: "입력 부족" };
export function ruleStatusKo(s) {
  return STATUS_KO[s] ?? s;
}

/**
 * 규칙 5개의 **입력값**을 계산한다. 규칙을 넘었을 때 무엇을 할지는 회고(사람)가 정한다 — 이 함수는
 * 트레인을 시작하지 않는다.
 * @param {Array<any>} cases
 */
export function evaluateRules(cases) {
  const list = cases ?? [];
  const rules = [];

  // R1 — (b)(c) 중 마지막 user_verdict = as_intended ≤ 1건 → '고침 경로' 재설계.
  // 2026-10-04 Bae "너의 제안대로": 0건 → ≤ 1건(3건 중 2건이 만족 못 하면 이미 재설계 신호).
  const bc = list.filter((c) => c.door === "b" || c.door === "c");
  const bcVerdicts = bc.map((c) => c.axes?.user_verdict?.value ?? null);
  const asIntended = bcVerdicts.filter((v) => v === "as_intended").length;
  const bcUnlabeled = bcVerdicts.filter((v) => v === null).length;
  rules.push({
    id: "R1",
    measured: bc.length ? `as_intended ${asIntended}/${bc.length}건 (답 없음 ${bcUnlabeled})` : "(b)(c) 건 없음",
    threshold: "as_intended ≤ 1건",
    // 답 없는 건이 모두 as_intended여도 2건에 못 미치면 이미 넘은 것이다.
    status: bc.length === 0 ? "insufficient" : asIntended >= 2 ? "clear" : asIntended + bcUnlabeled >= 2 ? "insufficient" : "triggered",
  });

  // R2 — 기계 판정과 사람 라벨 불일치 ≥ 2건 → 판정 규칙 재검토. 기계 보류는 불일치가 아니다(§4.3) —
  // 대신 첫 런 보류 건수를 원문과 함께 보이게 따로 적는다(회고 입력).
  const dis = list.filter((c) => c.disagreement === true).length;
  const undecided = list.filter((c) => c.disagreement === null).length;
  const l1Abstain = list.filter((c) => c.l1?.sideRelation === "abstain_mismatch").length;
  // 2026-10-04 Bae "너의 제안대로": ①정반대(작동↔고장) 1건만 나와도 핵심 결함 ②보류는 불일치로 세지
  // 않으므로 전부 보류면 R2가 영원히 안 걸린다 → 보류 차이 ≥ 2/3도 '판정 불가' 신호로 넘음.
  const l1Opposite = list.filter((c) => c.l1?.sideRelation === "opposite").length;
  const abstainHeavy = list.length > 0 && l1Abstain * 3 >= list.length * 2;
  rules.push({
    id: "R2",
    measured: `불일치 ${dis}건 / 정반대 ${l1Opposite}건 / 판정 불가 ${undecided}건 / 전체 ${list.length}건 (첫 런 보류 차이 ${l1Abstain}건 — 불일치로 세지 않음)`,
    threshold: "정반대 ≥ 1건 또는 불일치 ≥ 2건 또는 보류 차이 ≥ 2/3",
    status:
      list.length === 0
        ? "insufficient"
        : l1Opposite >= 1 || dis >= 2 || abstainHeavy
          ? "triggered"
          : dis + undecided >= 2
            ? "insufficient"
            : "clear",
  });

  // R3 — support_minutes 중앙값 > 15분 → 셀프서브 개선 우선. 모든 건이 기입돼야 판정.
  const mins = list.map((c) => c.sheet?.supportMinutes ?? null);
  const filledMins = mins.filter((m) => m !== null);
  const med = median(filledMins);
  rules.push({
    id: "R3",
    measured: filledMins.length ? `중앙값 ${med}분 (${filledMins.length}/${list.length}건 기입)` : "기입 없음",
    threshold: "중앙값 > 15분",
    status:
      list.length === 0 || filledMins.length < list.length ? "insufficient" : med > 15 ? "triggered" : "clear",
  });

  // R4 — 6축 채움률 평균 < 5/6 → 캡처 배선 점검.
  const totalFilled = list.reduce((s, c) => s + (c.filledCount ?? 0), 0);
  const mean = list.length ? totalFilled / (AXES.length * list.length) : null;
  rules.push({
    id: "R4",
    measured: mean === null ? "건 없음" : `${totalFilled}/${AXES.length * list.length} (${(mean * 6).toFixed(2)}/6)`,
    threshold: "평균 < 5/6",
    status: mean === null ? "insufficient" : mean < 5 / 6 ? "triggered" : "clear",
  });

  // R5 — (a) 빌드 성공 ≤ 1/3 → S1 보류. 빌드 결과는 지금 수기(빌드 실행체 B5(b) 전).
  // 2026-10-04 Bae "너의 제안대로": 0건 → ≤ 1건(works-or-free에서 1/3 성공은 2/3 환불 — 경제성 불성립).
  const a = list.filter((c) => c.door === "a");
  const results = a.map((c) => c.sheet?.buildResult ?? null);
  const success = results.filter((r) => r === "success").length;
  const unknownBuild = results.filter((r) => r === null).length;
  rules.push({
    id: "R5",
    measured: a.length ? `빌드 성공 ${success}/${a.length}건 (미기입 ${unknownBuild})` : "(a) 건 없음 — P-5 뒤",
    threshold: "성공 ≤ 1건",
    status: a.length === 0 ? "insufficient" : success >= 2 ? "clear" : success + unknownBuild >= 2 ? "insufficient" : "triggered",
  });
  return rules;
}

export function summarize(cases) {
  const list = cases ?? [];
  const perAxis = Object.fromEntries(
    AXES.map((a) => [a, { filled: list.filter((c) => c.axes?.[a]?.state === "filled").length, total: list.length }]),
  );
  const l1 = list.map((c) => c.l1).filter((x) => x && x.exact !== null);
  const pairs = list.flatMap((c) => c.l2 ?? []);
  const decided = pairs.filter((p) => p.agree !== null);
  return {
    cases: list.length,
    byDoor: { a: list.filter((c) => c.door === "a").length, b: list.filter((c) => c.door === "b").length, c: list.filter((c) => c.door === "c").length, unknown: list.filter((c) => !c.door).length },
    perAxis,
    meanFill: list.length ? list.reduce((s, c) => s + (c.filledCount ?? 0), 0) / (AXES.length * list.length) : null,
    l1Exact: { agree: l1.filter((x) => x.exact).length, n: l1.length },
    l1Side: {
      agree: l1.filter((x) => x.sideRelation === "same").length,
      opposite: l1.filter((x) => x.sideRelation === "opposite").length,
      abstainMismatch: l1.filter((x) => x.sideRelation === "abstain_mismatch").length,
      n: l1.length,
    },
    l2: {
      agree: decided.filter((p) => p.agree).length,
      n: decided.length,
      machineAbstain: pairs.filter((p) => p.agree === null && p.machine === "abstain" && p.human !== null).length,
      unlabeled: pairs.filter((p) => p.human === null).length,
    },
    disagreementCases: list.filter((c) => c.disagreement === true).length,
  };
}

// ─── 비밀 값 보호 ────────────────────────────────────────────────────────────────

function containsSecret(text, secrets) {
  const t = String(text ?? "");
  for (const s of secrets ?? []) {
    if (typeof s !== "string" || s.length < 4) continue;
    if (t.includes(s) || t.includes(encodeURIComponent(s))) return true;
  }
  return false;
}

/**
 * 결과 객체에서 비밀 값이 들어 있는 위치(경로)를 찾는다 — 값은 돌려주지 않는다. 멈출 때 "어느 칸이
 * 새는가"를 알려 화이트리스트 회귀를 고칠 수 있게 한다. 키 이름 자체에 값이 있으면 키를 가린다.
 * @param {unknown} value @param {string[]} secrets @param {number} [limit]
 * @returns {string[]}
 */
export function secretPaths(value, secrets, limit = 5) {
  const out = [];
  const walk = (v, p) => {
    if (out.length >= limit) return;
    if (typeof v === "string") {
      if (containsSecret(v, secrets)) out.push(p || "(루트)");
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const key = containsSecret(k, secrets) ? "[키 가림]" : k;
        if (key !== k && out.length < limit) out.push(p ? `${p}.${key}` : key);
        walk(x, p ? `${p}.${key}` : key);
      }
    }
  };
  walk(value, "");
  return out;
}

/** 문자열 안의 비밀 값(원문·URL 인코딩)을 가린다. 출력 파일이 아니라 콘솔 오류 문구용이다. */
export function redact(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets ?? []) {
    if (typeof s !== "string" || s.length < 4) continue;
    for (const v of new Set([s, encodeURIComponent(s)])) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

/**
 * 출력 원문에 비밀 값이 있으면 throw — **가리기 전의 원문**에 대고 부른다(fail-closed). 가린 뒤에
 * 검사하면 절대 발동하지 않아 화이트리스트가 깨져도 조용히 [REDACTED]가 쓰인다(PR #570 검증 P2).
 * 메시지에 값을 넣지 않는다 — 위치(where)만.
 * @param {string} text @param {string[]} secrets @param {string[]} [where]
 */
export function assertNoSecret(text, secrets, where = []) {
  if (!containsSecret(text, secrets)) return;
  const at = where.length ? ` (위치: ${where.join(", ")})` : "";
  throw new Error(`pilot-metrics: userKey가 출력에 들어갈 뻔했어요${at} — 파일을 쓰지 않고 멈춥니다. 수집 화이트리스트를 고친 뒤 다시 돌리세요`);
}

// ─── 렌더 ────────────────────────────────────────────────────────────────────────

/**
 * 가림 모드의 런 표시 — 건 안의 생성 순번(런1, 런2 …). id의 어떤 부분도 남기지 않는다.
 * 런 id는 `wvc_` + ms 시각(base36 끝 6자) + 무작위 4자라(central-plane visual-check-db.ts randId),
 * 끝 4자리를 남기고 생성 시각(ms)을 함께 내면 id 전체가 복원된다(PR #570 검증 P2 — 서버 randId 모양
 * 2000개를 끝 4자리 + createdAt(±2ms 탐색)으로 2000/2000 복원, 2026-10-01 로컬 재현).
 * @param {Array<{ id?: string|null, createdAt?: string|null }>} runs
 * @returns {Map<string, string>}
 */
export function runLabels(runs) {
  const map = new Map();
  [...(runs ?? [])].sort(byCreated).forEach((r, i) => {
    if (typeof r?.id === "string" && r.id) map.set(r.id, `런${i + 1}`);
  });
  return map;
}

/**
 * 가림 모드의 시각 — 분 단위 UTC("2026-10-06 01:00 UTC"). 초·ms를 내지 않는다. 런 id 조각을 내지
 * 않으므로 분 단위 시각만으로는 id를 복원할 수 없다(분 안의 ms 6만 가지 × 무작위 36⁴).
 * @param {unknown} iso
 */
export function minuteUtc(iso) {
  const ms = Date.parse(typeof iso === "string" ? iso : "");
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function cell(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function fmtSec(s) {
  if (s === null || s === undefined) return "—";
  if (s < 90) return `${s}초`;
  const m = Math.floor(s / 60);
  return m < 90 ? `${m}분 ${s % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function axisCell(a, { hideValue = false } = {}) {
  if (!a) return "—";
  if (a.state === "filled") return hideValue ? "✓ 기록됨" : `✓ ${a.value}`;
  if (a.state === "recorded_empty") return `○ 빈 분류`;
  return `✗ ${a.reason ?? ""}`;
}

function judgmentText(run) {
  if (!run) return "—";
  const label = run.decision ? DECISION_LABEL_KO[run.decision] ?? run.decision : "—";
  return `${run.decision ?? "—"} · "${run.verdictText ?? label}"`;
}

/**
 * 결과 → 마크다운. 앱 주소·userKey·프로젝트 id는 넣지 않는다.
 * 가림 모드(기본, maskIds=true): 런 id → 건 안 순번(런1…), 시각 → 분 단위 UTC, region 값 → "기록됨".
 * 판정·user_verdict·resolved 값은 파일럿 결과 그 자체라 남긴다(RUNBOOK §7 '공개 저장소 주의').
 * @param {any} result @param {{ maskIds?: boolean }} [opts]
 */
export function renderMarkdown(result, { maskIds = true } = {}) {
  const idsFor = (c) => {
    const labels = runLabels(c.collected?.runs ?? []);
    return (v) => (v === null || v === undefined || v === "" ? "—" : maskIds ? labels.get(v) ?? "런?" : cell(v));
  };
  const when = (v) => (maskIds ? cell(minuteUtc(v)) : cell(v));
  const L = [];
  const cases = result.cases ?? [];
  const s = result.summary ?? summarize(cases);
  L.push(`# 파일럿 지표 — ${cell(result.generatedAt)}`);
  L.push("");
  L.push(
    `> 도구: tools/simsa-completion-loop-spike/pilot-metrics.mjs · 정의: docs/pilot-2026-10/RUNBOOK.md §4 · 건 ${s.cases} ((a) ${s.byDoor.a} · (b) ${s.byDoor.b} · (c) ${s.byDoor.c} · 문 미상 ${s.byDoor.unknown})`,
  );
  L.push(
    maskIds
      ? "> 가림 판: 런 id 대신 건 안 순번(런1 = 그 건의 첫 런) · 시각은 분 단위 UTC · region 값은 '기록됨'으로만. 전체 id·시각은 같은 이름의 JSON(로컬 전용)에 있다."
      : "> ★가리지 않은 판(--no-mask) — 런 id·초 단위 시각·국가 값이 있다. 공개 저장소에 붙이지 않는다.",
  );
  const src = result.sources ?? {};
  L.push(
    `> 데이터원: ${src.snapshotIn ? "스냅샷 파일(재계산)" : src.api ? "GET 상세 API" : "—"} · D1 행 ${src.d1Rows ? "있음(완료 시각·런 region)" : "없음(런별 소요 시간 미측정)"} · ops-probe 집계 ${src.opsFill ? "있음" : "없음"} · 원가 시트 ${src.sheet ? "있음" : "없음"} · userKey ${src.userKey === "provided" ? "제공됨(출력에 없음)" : "없음"}`,
  );
  L.push("");

  L.push("## 1. 판정 규칙 입력 (RUNBOOK §5 — 넘어도 자동 실행 아님, 회고에서 결정)");
  L.push("");
  L.push("| 규칙 | 측정값 | 문턱 | 상태 |");
  L.push("|---|---|---|---|");
  for (const r of result.rules ?? []) L.push(`| ${r.id} | ${cell(r.measured)} | ${cell(r.threshold)} | ${ruleStatusKo(r.status)} |`);
  L.push("");

  L.push("## 2. 6축 채움 (✓ 채움 · ○ 빈 분류(채움 아님) · ✗ 비어 있음 + 이유)");
  L.push("");
  L.push("| 건 | 문 | region | built_with | topic | finding_code | user_verdict | resolved | 채움 |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of cases) {
    L.push(
      `| ${cell(c.caseNo)} | ${cell(c.door)} | ${AXES.map((a) => cell(axisCell(c.axes?.[a], { hideValue: maskIds && a === "region" }))).join(" | ")} | ${c.filledCount}/6 |`,
    );
  }
  L.push("");
  L.push(
    `축별: ${AXES.map((a) => `${a} ${s.perAxis[a].filled}/${s.perAxis[a].total}`).join(" · ")} · 평균 ${s.meanFill === null ? "—" : `${(s.meanFill * 6).toFixed(2)}/6`}`,
  );
  L.push("");

  L.push("## 3. 기계 판정 vs 사람 라벨 (원문 함께)");
  L.push("");
  L.push("| 건 | 기대 판정(정답지) | 첫 런 판정(원문) | L1 정확·쪽 | 런별 기계 ↔ 사람 | 건 불일치 |");
  L.push("|---|---|---|---|---|---|");
  const RELATION_KO = { same: "같은 쪽", opposite: "반대 쪽", abstain_mismatch: "보류 차이(불일치 아님)" };
  for (const c of cases) {
    const id = idsFor(c);
    const runs = c.collected?.runs ?? [];
    const firstDone = runs.find((r) => r.id === c.l1?.firstRunId) ?? null;
    const l1 = c.l1 ?? {};
    const l1Text =
      l1.exact === null || l1.exact === undefined
        ? "—"
        : `${l1.exact ? "일치" : "다름"} · ${RELATION_KO[l1.sideRelation] ?? (l1.sideAgree ? "같은 쪽" : "다른 쪽")}`;
    const pairs = (c.l2 ?? [])
      .map((p) => `${id(p.runId)}: ${p.bucket ?? "—"} ↔ ${USER_VERDICT_LABEL_KO[p.userVerdict] ?? p.userVerdict} (${p.agree === null ? p.note : p.agree ? "일치" : "충돌"})`)
      .join("; ");
    L.push(
      `| ${cell(c.caseNo)} | ${cell(l1.expected)} | ${cell(firstDone ? `${l1.actual} ← ${judgmentText(firstDone)}` : null)} | ${cell(l1Text)} | ${cell(pairs || null)} | ${c.disagreement === null ? "판정 불가" : c.disagreement ? "예" : "아니오"} |`,
    );
  }
  L.push("");
  L.push(
    `L1 정확 일치 ${s.l1Exact.agree}/${s.l1Exact.n} · L1 같은 쪽 ${s.l1Side.agree}/${s.l1Side.n} (반대 쪽 ${s.l1Side.opposite ?? "—"} · 보류 차이 ${s.l1Side.abstainMismatch ?? "—"}) · L2 일치 ${s.l2.agree}/${s.l2.n} (기계 보류 ${s.l2.machineAbstain} · 라벨 아님 ${s.l2.unlabeled}) · 불일치 건 ${s.disagreementCases}`,
  );
  L.push("");

  L.push("## 4. 런별 원문 (판정 문구 · 발견 코드 · 발견 문장)");
  L.push("");
  L.push("| 건 | 런 | 생성 | 상태 | 판정(원문) | 한 줄 | 발견 (코드 · what) | 사람 답 | 수리 |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of cases) {
    const id = idsFor(c);
    for (const r of c.collected?.runs ?? []) {
      const findings = r.findings.length
        ? r.findings.map((f) => `${f.code ?? "코드 없음"} · ${f.what}`).join(" / ")
        : r.detailMissing
          ? "(상세 못 읽음)"
          : "[] 발견 0";
      const repair = r.repair ? `${r.repair.status ?? "—"}/${r.repair.mode ?? "—"} resolved=${r.repair.resolved ?? "—"}` : "—";
      L.push(
        `| ${cell(c.caseNo)} | ${id(r.id)}${r.sourceCheckId ? ` ⟵ ${id(r.sourceCheckId)}` : ""} | ${when(r.createdAt)} | ${cell(r.status)} | ${cell(judgmentText(r))} | ${cell(r.oneLine)} | ${cell(findings)} | ${cell(r.userVerdict ? `${r.userVerdict} (${USER_VERDICT_LABEL_KO[r.userVerdict]})` : null)} | ${cell(repair)} |`,
      );
    }
  }
  L.push("");

  L.push("## 5. 시간·재검수");
  L.push("");
  L.push("| 건 | 런 수 (끝남·실패·진행 중) | 재검수 (sourceCheckId) | 후속 런 (계보 없음) | 런별 생성→완료 | 첫 런→마지막 런 생성 | 첫 런→마지막 답 |");
  L.push("|---|---|---|---|---|---|---|");
  for (const c of cases) {
    const id = idsFor(c);
    const t = c.time ?? {};
    const per = (t.perRun ?? []).map((p) => `${id(p.runId)} ${fmtSec(p.durationSec)}`).join("; ");
    const follow = typeof t.followUpCount === "number" ? (t.followUpCount > 0 ? `${t.followUpCount}회` : "없음") : "—";
    L.push(
      `| ${cell(c.caseNo)} | ${t.runs ?? 0} (${t.doneRuns ?? 0}·${t.failedRuns ?? 0}·${t.activeRuns ?? 0}) | ${t.hasRecheck ? `예 ${t.recheckCount}회` : "아니오"} | ${follow} | ${cell(t.perRunDurationsMeasured ? per : "미측정 (API에 완료 시각 없음 — D1 행 입력 필요)")} | ${fmtSec(t.toFinalRunSec)} | ${fmtSec(t.toVerdictSec)} |`,
    );
  }
  L.push("");

  L.push("## 6. 예상 실패 지점 ↔ 기계 발견 (적중 여부는 사람이 적는다 — 자동 판정하지 않음)");
  L.push("");
  L.push("| 건 | 예상 실패 지점 (정답지 원문) | 기계 발견 (첫 끝난 런 · 코드 · what) | 적중 (사람 기입: 예측 적중 / 다른 곳 / 실패 없음) |");
  L.push("|---|---|---|---|");
  for (const c of cases) {
    const fp = c.failurePoint ?? {};
    const mf = (fp.machineFindings ?? []).map((f) => `${f.code ?? "코드 없음"} · ${f.what}`).join(" / ");
    L.push(`| ${cell(c.caseNo)} | ${cell(fp.expected)} | ${cell(mf || (fp.machineRunId ? "[] 발견 0" : null))} | ${cell(fp.humanJudgment ?? "(빈칸 — 사람이 정답지 '실행 후'에 기입)")} |`);
  }
  L.push("");

  L.push("## 7. 원가 수기 시트");
  L.push("");
  L.push("| 건 | support_minutes | 이의(생각과 다름) | 재작업 | 개입 | spent_usd | 빌드 결과 |");
  L.push("|---|---|---|---|---|---|---|");
  for (const c of cases) {
    const sh = c.sheet;
    L.push(
      sh
        ? `| ${cell(c.caseNo)} | ${cell(sh.supportMinutes)} | ${cell(sh.disputeText)} | ${cell(sh.rework)} | ${cell(sh.intervention === null ? null : sh.intervention ? "예" : "아니오")} | ${cell(sh.spentUsd)} | ${cell(sh.buildResult === "success" ? "성공" : sh.buildResult === "failure" ? "실패" : null)} |`
        : `| ${cell(c.caseNo)} | (시트 줄 없음) | | | | | |`,
    );
  }
  L.push("");

  L.push("## 8. 정답지 선기록 확인 (git)");
  L.push("");
  L.push("| 건 | 정답지 | 첫 커밋 | 커밋 시각 | 첫 런 생성 | 선기록 | 실행 뒤 기대 칸 변경 |");
  L.push("|---|---|---|---|---|---|---|");
  for (const c of cases) {
    const p = c.preRegistration ?? {};
    const verdict =
      p.status === "ok" ? "예" : p.status === "late" ? "아니오 (늦음)" : p.status === "not_committed" ? "아니오 (커밋 안 됨)" : p.status === "no_run" ? "런 전" : "확인 불가";
    const changed = Array.isArray(p.expectedChangedFields)
      ? p.expectedChangedFields.length ? `바뀜: ${p.expectedChangedFields.join(", ")}` : "없음"
      : "—";
    L.push(
      `| ${cell(c.caseNo)} | ${cell(c.answerKeyPath)} | ${cell(p.sha ? p.sha.slice(0, 7) : null)} | ${when(p.committedAt)} | ${when(p.firstRunCreatedAt)} | ${verdict}${p.dirty ? " · 작업 트리에 미커밋 변경" : ""} | ${cell(changed)} |`,
    );
  }
  L.push("");

  if (result.opsFill) {
    L.push(`## 9. 서비스 전체 채움 (ops-probe d1-readonly${result.opsFill.query ? ` · ${result.opsFill.query}` : ""} — 파일럿 한정 아님)`);
    L.push("");
    const ratios = opsFillRatios(result.opsFill);
    if (ratios.length) {
      L.push("| 칸 | 채움 / 훑은 행 |");
      L.push("|---|---|");
      for (const r of ratios) L.push(`| ${cell(r.column)} | ${r.filled}/${r.scanned} |`);
    } else {
      L.push("```");
      L.push(JSON.stringify(result.opsFill.rows, null, 0));
      L.push("```");
    }
    L.push("");
  }

  const problems = cases.flatMap((c) => [...(c.errors ?? []).map((e) => `건 ${c.caseNo ?? "?"}: ${e}`), ...(c.warnings ?? []).map((w) => `건 ${c.caseNo ?? "?"}: ${w}`)]);
  L.push("## 10. 오류·경고");
  L.push("");
  if (problems.length === 0) L.push("없음");
  else for (const p of problems) L.push(`- ${cell(p)}`);
  L.push("");
  return L.join("\n");
}

/**
 * 건 하나를 계산한다(순수). collected = { project, runs, errors } — errors는 **수집** 오류만(스냅샷에
 * 그대로 남아 재계산 때 다시 쓰인다). 정답지 읽기 오류 같은 이번 실행의 오류는 extraErrors로.
 * @param {{ caseNo?: number|null, projectId: string, answerKeyPath?: string|null, answerKey?: any, collected: any, sheetRow?: any, preRegistration?: any, extraErrors?: string[] }} input
 */
export function computeCase({ caseNo = null, projectId, answerKeyPath = null, answerKey = null, collected, sheetRow = null, preRegistration = null, extraErrors = [] }) {
  const project = collected?.project ?? null;
  const runs = [...(collected?.runs ?? [])].sort(byCreated);
  const { axes, filledCount, fillRate } = evaluateAxes(project, runs);
  const { l1, l2, disagreement } = evaluateAgreement(runs, answerKey?.pre?.expectedJudgment ?? null);
  const firstDone = runs.find((r) => r.status === "done") ?? null;
  const warnings = [...(answerKey?.warnings ?? [])];
  if (!answerKey) warnings.push("정답지 없음 — 기대 판정·문·예상 실패 지점을 비교하지 못함");
  if (runs.length === 0) warnings.push("런 없음");
  if (runs.some((r) => r.detailMissing)) warnings.push("상세를 못 읽은 런이 있어요 — 발견·판정 문구가 빠짐");
  if (preRegistration) {
    if (preRegistration.status === "late") {
      warnings.push("정답지 첫 커밋이 첫 런보다 늦어요 — 선기록 아님 (main의 스쿼시 머지 시각이면 정답지 브랜치를 체크아웃해 다시 돌리세요 — RUNBOOK §1-2)");
    }
    else if (preRegistration.status === "not_committed") warnings.push("정답지가 커밋되지 않았어요 — 선기록 증거 없음");
    else if (preRegistration.status === "unknown") warnings.push("정답지의 git 기록을 읽지 못했어요 — 선기록 확인 불가");
    if (Array.isArray(preRegistration.expectedChangedFields) && preRegistration.expectedChangedFields.length > 0) {
      warnings.push(`첫 런 뒤 기대 칸이 바뀌었어요: ${preRegistration.expectedChangedFields.join(", ")}`);
    }
  }
  return {
    caseNo: caseNo ?? answerKey?.caseNo ?? null,
    projectId,
    answerKeyPath,
    title: project?.title ?? answerKey?.title ?? null,
    door: answerKey?.pre?.door ?? null,
    answerKey: answerKey ? { pre: answerKey.pre, post: answerKey.post } : null,
    preRegistration,
    axes,
    filledCount,
    fillRate,
    l1,
    l2,
    disagreement,
    time: evaluateTime(runs),
    failurePoint: {
      expected: answerKey?.pre?.expectedFailurePoint ?? null,
      machineRunId: firstDone?.id ?? null,
      machineFindings: firstDone ? firstDone.findings : [],
      humanJudgment: answerKey?.post?.failurePointMatch ?? null,
    },
    sheet: sheetRow,
    errors: [...(collected?.errors ?? []), ...extraErrors],
    warnings,
    collected: { project, runs, errors: collected?.errors ?? [] },
  };
}
