// 문 (a) 라이브 실증 3종 — 순수 부분(build-proof.mjs가 쓰고 test/build-proof.test.mjs가 고정한다).
//
// docs/simsa-door-done-definitions-2026-09-30.md 문 (a) 완료 증거 ②, HANDOFF-2026-10-01 §5-2:
//   A 고의로 깨진 기획 → 잡이 failed(building)으로 끝나고 배포되지 않는다(deployedUrl 없음)
//   B 정상 기획       → done · https://<slug>.simsa.page 가 200(/api/health ok:true + 페이지 <script src>)
//   C 예산 $0.5      → failed(budget) — 예산 정지(B-6). 예산 재정의는 서버가 **장비 티어만** 받는다.
//
// 판정은 서버 응답의 사실만 본다(추측하지 않는다). 하나라도 입력이 모자라면 pass=false + 이유.

/** 실증용 정상 기획 — central-plane 테스트(train-b-b5b-s1)의 최소 지시서와 같은 모양(Rule 6: 한글 이름·문구). */
export function goodSpec(productName = "(주)테스트 동네빵집 예약") {
  return {
    meta: { version: 1, source: "generated", locale: "ko", generatedAt: new Date(0).toISOString() },
    brief: {
      productName,
      oneLine: "동네 빵집 소금빵 예약",
      targetUsers: ["동네 손님"],
      problem: "빵이 다 팔려 헛걸음한다",
      included: ["예약"],
      excluded: ["결제"],
      userFlow: [],
      decisions: [],
      openQuestions: [],
    },
    features: [{ id: "FR-001", title: "예약", description: "빵을 고르고 예약한다", priority: "must" }],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "빵 목록이 보인다", when: "'예약하기'를 누른다", then: "예약 확인 화면이 보인다", verifiedBy: "browser" },
    ],
    screens: [
      { id: "SCR-001", route: "/", purpose: "예약", components: ["빵 목록", "예약하기 버튼"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] },
    ],
    dataModel: [{ name: "reservations", fields: [{ name: "id", type: "text", required: true }], relations: [], ownership: "unknown" }],
    apis: [],
    nonFunctional: [],
    workBreakdown: [
      { id: "WBS-001", title: "예약 저장 (D1 테이블)", order: 1, dependsOn: [], acceptanceIds: ["AC-001"] },
      { id: "WBS-002", title: "예약 화면 — 한글 버튼 '예약하기'", order: 2, dependsOn: ["WBS-001"], acceptanceIds: ["AC-001"] },
    ],
    testPlan: [{ kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "'예약하기' 누르기"] }],
    assumptions: [],
    openQuestions: [],
  };
}

/** 실증 A용 — 형식은 유효하지만 must 작업이 빌드될 수 없게 만든 기획(존재하지 않는 패키지를 반드시 import). */
export const MISSING_PACKAGE = "simsa-intentionally-missing-package-0000";
export function brokenSpec(productName = "(주)테스트 깨진 기획") {
  const s = goodSpec(productName);
  s.brief.oneLine = "의도적으로 빌드가 실패하는 기획(실증 A)";
  s.workBreakdown = [
    {
      id: "WBS-001",
      title: `모든 화면 파일은 npm 패키지 '${MISSING_PACKAGE}'를 import해서 써야 한다(대체 금지)`,
      order: 1,
      dependsOn: [],
      acceptanceIds: ["AC-001"],
    },
  ];
  s.assumptions = [`'${MISSING_PACKAGE}'는 npm에 없다 — 이 기획은 빌드 실패를 확인하기 위한 것이다`];
  return s;
}

export const TERMINAL = new Set(["done", "failed"]);
export const isTerminal = (job) => Boolean(job && TERMINAL.has(job.status));

/**
 * @param {"A"|"B"|"C"} kind
 * @param {{ status?: string, failedStage?: string|null, error?: string|null, deployedUrl?: string|null, spentUsd?: number, budgetUsd?: number } | null} job
 * @param {{ healthOk?: boolean, pageStatus?: number, pageHasScript?: boolean } | null} [site] B에서만
 * @returns {{ pass: boolean, reason: string }}
 */
export function evaluateProof(kind, job, site = null) {
  if (!job) return { pass: false, reason: "no_job" };
  if (!isTerminal(job)) return { pass: false, reason: `not_terminal:${job.status ?? "?"}` };
  if (kind === "A") {
    if (job.status !== "failed") return { pass: false, reason: `expected_failed_got_${job.status}` };
    if (job.deployedUrl) return { pass: false, reason: "deployed_despite_failure" };
    if (job.failedStage !== "building") return { pass: false, reason: `failed_at_${job.failedStage ?? "unknown"}_not_building` };
    return { pass: true, reason: "failed(building) · no deploy" };
  }
  if (kind === "C") {
    if (job.status !== "failed") return { pass: false, reason: `expected_failed_got_${job.status}` };
    const budgetStop = job.failedStage === "budget" || /\bbudget\b/i.test(job.error ?? "");
    if (!budgetStop) return { pass: false, reason: `failed_but_not_budget:${job.failedStage ?? "?"}:${String(job.error ?? "").slice(0, 60)}` };
    if (job.deployedUrl) return { pass: false, reason: "deployed_despite_budget_stop" };
    return { pass: true, reason: `failed(budget) · spent ${job.spentUsd ?? "?"} / budget ${job.budgetUsd ?? "?"}` };
  }
  // B
  if (job.status !== "done") return { pass: false, reason: `expected_done_got_${job.status}:${job.failedStage ?? ""}:${String(job.error ?? "").slice(0, 60)}` };
  if (!job.deployedUrl) return { pass: false, reason: "done_without_url" };
  if (!site) return { pass: false, reason: "site_not_checked" };
  if (site.healthOk !== true) return { pass: false, reason: "health_not_ok" };
  if (site.pageStatus !== 200) return { pass: false, reason: `page_status_${site.pageStatus}` };
  if (site.pageHasScript !== true) return { pass: false, reason: "page_marker_missing" };
  return { pass: true, reason: `done · ${job.deployedUrl} 200` };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] ?? null : null;
  };
  const only = (get("--only") ?? "ABC").toUpperCase().split("").filter((k) => "ABC".includes(k));
  return {
    base: (get("--base") ?? "https://conclave-ai.seunghunbae.workers.dev").replace(/\/+$/, ""),
    only: [...new Set(only)],
    keep: argv.includes("--keep"),
    out: get("--out") ?? "build-proof-result.json",
    budgetC: Number(get("--budget") ?? "0.5"),
    timeoutMin: Number(get("--timeout-min") ?? "50"),
  };
}

/** @param {Array<{ kind: string, pass: boolean, reason: string }>} results */
export function summaryLine(results) {
  const passed = results.filter((r) => r.pass).length;
  return `build-proof: ${passed}/${results.length} 통과 — ` + results.map((r) => `${r.kind} ${r.pass ? "✅" : "❌"} ${r.reason}`).join(" · ");
}
