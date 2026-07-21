/**
 * workspace/evidence-live.ts — Train M-1a (2026-07-21, design locked).
 *
 * 해자 라이브 연결의 서버 절반: 검수가 이미 저장해 둔 사실들(프로젝트의
 * product_spec/items · 시각 검수 런의 intent/works/decision/report_json ·
 * 최신 PR 리뷰 런의 per-item 결과)을 acceptance-graph 노드로 **결정론적으로
 * 조립**해 deriveEvidencePack → classifyGateDecision까지 내린다.
 *
 * 원칙 (PRD §5 불변식):
 *   - 판정을 새로 만들지 않는다 — 이미 저장된 사실에 근거를 붙일 뿐.
 *   - 숫자 점수 없음(DECISION_STATES만) · 근거 없으면 Not Verified.
 *   - Browser Evidence ≠ AI Opinion: 시각 런의 관찰(콘솔에러·실패 인터랙션·
 *     스크린샷 수)은 visual 노드로, 리포트의 해석성 발견(what/why)은
 *     crossReview(reviewer="simsa-visual")의 findings로 분리해 나른다.
 *   - 저장 안 함 · 네트워크 없음 — GET 시점에 저장된 행에서 재도출(on-demand).
 *     같은 입력 → 같은 pack (derivation 로직이 업그레이드되면 결과도 최신).
 *
 * PURE: 이 모듈은 이미 로드된 행만 받는다. DB 로드·소유권 체크는 라우트 몫.
 */
import {
  createAcceptanceGraph,
  type AcceptanceGraph,
  type GateDecisionNode,
} from "../acceptance-graph.js";
import {
  deriveEvidencePack,
  classifyGateDecision,
  type EvidencePack,
} from "../evidence-pack.js";

/** 이 조립이 소비하는 최소 행 형태 (라우트가 실제 DB 타입에서 투영). */
export interface LiveEvidenceInput {
  projectId: string;
  entryPath?: string | null;
  /** workspace_projects.product_spec_json 파싱 결과 (없으면 null). */
  productSpec?: {
    productName?: string;
    oneLine?: string;
    problem?: string;
    targetUsers?: string[];
    included?: string[];
    excluded?: string[];
    userFlow?: string[];
    openQuestions?: string[];
  } | null;
  /** workspace_projects.items_json 파싱 결과. */
  items?: Array<{ id?: string; title?: string }> | null;
  /** 시각 검수 런 (근거를 붙일 대상). */
  run: {
    id: string;
    intent: string;
    decision: string;
    works: boolean | null;
    /** report_json 원문 — 관대하게 파싱, 실패해도 조립은 계속. */
    reportJson?: string | null;
  };
  /** 최신 PR 리뷰 런의 result_json 파싱 결과 (없으면 null). */
  latestReview?: {
    repoFullName?: string;
    prNumber?: number;
    results?: Array<{ itemId?: string; title?: string; status?: string }>;
  } | null;
}

export interface LiveEvidence {
  pack: EvidencePack;
  gate: GateDecisionNode;
  /** UI 3열 체인용: 기준 ↔ 관찰 사실 ↔ 판정. */
  criteria: Array<{
    id: string;
    text: string;
    status: "verified" | "broken" | "not_verified";
    /** 이 기준을 판정한 관찰 소스 (PR 리뷰 항목명 등). 없으면 빈 배열. */
    observedBy: string[];
  }>;
  /** Browser Evidence (사실만 — 해석 아님). */
  browserFacts: {
    works: boolean | null;
    decision: string;
    consoleErrors: string[];
    failedInteractions: string[];
    screenshotCount: number;
  };
  /** AI Opinion (해석 — "측정된 사실 아님" 라벨로 렌더할 것). */
  interpretations: string[];
}

const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/** report_json에서 관찰/해석을 관대하게 추출. 어떤 형태여도 throw하지 않는다. */
export function parseReportFacts(reportJson: string | null | undefined): {
  consoleErrors: string[];
  failedInteractions: string[];
  screenshotCount: number;
  interpretations: string[];
} {
  const out = {
    consoleErrors: [] as string[],
    failedInteractions: [] as string[],
    screenshotCount: 0,
    interpretations: [] as string[],
  };
  if (!reportJson) return out;
  let r: unknown;
  try {
    r = JSON.parse(reportJson);
  } catch {
    return out;
  }
  if (!r || typeof r !== "object") return out;
  const rec = r as Record<string, unknown>;

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  out.consoleErrors = strArr(rec["consoleErrors"]).slice(0, 20);
  // 스텝 관찰에서 실패성 사실 수집 (여러 리포트 버전에 관대).
  const steps = Array.isArray(rec["steps"]) ? rec["steps"] : [];
  for (const s of steps) {
    if (s && typeof s === "object") {
      const st = s as Record<string, unknown>;
      if (st["ok"] === false && typeof st["label"] === "string") {
        out.failedInteractions.push(st["label"]);
      }
      if (typeof st["screenshot"] === "string") out.screenshotCount++;
    }
  }
  const evidence = rec["evidence"];
  if (evidence && typeof evidence === "object") {
    const shots = (evidence as Record<string, unknown>)["screenshots"];
    if (Array.isArray(shots)) out.screenshotCount = Math.max(out.screenshotCount, shots.length);
  }
  // findings의 what/why는 해석(AI Opinion) — 사실과 분리해 나른다.
  const findings = Array.isArray(rec["findings"]) ? rec["findings"] : [];
  for (const f of findings) {
    if (f && typeof f === "object") {
      const fr = f as Record<string, unknown>;
      if (typeof fr["what"] === "string" && fr["what"]) out.interpretations.push(fr["what"]);
    }
  }
  return out;
}

/**
 * 저장된 사실 → acceptance graph → evidence pack → gate. 결정론.
 * 판정 원칙 매핑:
 *   - 스펙/items → prd 노드 (acceptanceCriteria = items)
 *   - PR 리뷰 per-item 결과 → implementation.tests (passed→pass, failed→fail,
 *     그 외→skipped; criteriaIds=[itemId]) — per-criterion verified/broken의 근거
 *   - 시각 런 → visual 노드 (notVerified = works가 null일 때만 — false는
 *     "실패를 확인함"이지 미검증이 아니다) + works=false의 해석 발견은
 *     crossReview(simsa-visual)의 unresolvedBlockers → gate가 Needs Fix로.
 */
export function assembleLiveEvidence(input: LiveEvidenceInput): LiveEvidence {
  const spec = input.productSpec ?? null;
  const items = arr(input.items).filter(
    (i): i is { id: string; title: string } =>
      !!i && typeof i.id === "string" && typeof i.title === "string",
  );
  const facts = parseReportFacts(input.run.reportJson);

  const review = input.latestReview ?? null;
  const reviewResults = arr(review?.results).filter(
    (r): r is { itemId: string; title?: string; status: string } =>
      !!r && typeof r.itemId === "string" && typeof r.status === "string",
  );

  const graph = createAcceptanceGraph({
    projectId: input.projectId,
    intent: {
      id: `run-${input.run.id}`,
      summary: input.run.intent || spec?.oneLine || "",
      targetFirstUser: arr(spec?.targetUsers)[0] ?? "",
      desiredBehaviorChange: spec?.problem || spec?.oneLine || "",
      sourceRefs: [`visual-check:${input.run.id}`],
    },
    prd: spec
      ? {
          summary: spec.oneLine ?? "",
          requirements: arr(spec.included),
          userFlows: arr(spec.userFlow),
          acceptanceCriteria: items.map((i) => ({ id: i.id, text: i.title })),
          outOfScope: arr(spec.excluded),
          unknowns: arr(spec.openQuestions),
          sourceRefs: [`project:${input.projectId}`],
        }
      : null,
    implementation: review
      ? {
          repo: review.repoFullName ?? null,
          prNumber: typeof review.prNumber === "number" ? review.prNumber : null,
          tests: reviewResults.map((r) => ({
            name: r.title || r.itemId,
            status: r.status === "passed" ? "pass" : r.status === "failed" ? "fail" : "skipped",
            criteriaIds: [r.itemId],
          })),
          sourceRefs: review.prNumber != null ? [`pr:${review.prNumber}`] : [],
        }
      : null,
    crossReviews:
      input.run.works === false && facts.interpretations.length > 0
        ? [
            {
              reviewer: "simsa-visual",
              role: "visual-inspection",
              findings: facts.interpretations,
              severity: "high",
              unresolvedBlockers: facts.interpretations,
            },
          ]
        : [],
    visual: {
      failedInteractions: facts.failedInteractions,
      screenshots: Array.from({ length: facts.screenshotCount }, (_, i) => `screenshot-${i + 1}`),
      consoleErrors: facts.consoleErrors,
      // works=null → 검증 불가(정직하게 notVerified). works=false는 "실패를
      // 눈으로 확인함" — 증거가 있으므로 notVerified가 아니다.
      notVerified: input.run.works === null,
    },
  });

  const pack = deriveEvidencePack(graph);
  const gate = classifyGateDecision(pack);

  // 3열 체인: 기준별 상태 + 그 상태를 만든 관찰 소스.
  const testByCriterion = new Map<string, string[]>();
  for (const r of reviewResults) {
    const list = testByCriterion.get(r.itemId) ?? [];
    list.push(r.title || r.itemId);
    testByCriterion.set(r.itemId, list);
  }
  const statusById = new Map<string, "verified" | "broken" | "not_verified">();
  for (const line of pack.verified) {
    const m = /^criterion ([^:]+):/.exec(line);
    if (m && m[1]) statusById.set(m[1], "verified");
  }
  for (const line of pack.broken) {
    const m = /^criterion ([^:]+):/.exec(line);
    if (m && m[1]) statusById.set(m[1], "broken");
  }
  const criteria = items.map((i) => ({
    id: i.id,
    text: i.title,
    status: statusById.get(i.id) ?? ("not_verified" as const),
    observedBy: testByCriterion.get(i.id) ?? [],
  }));

  return {
    pack,
    gate,
    criteria,
    browserFacts: {
      works: input.run.works,
      decision: input.run.decision,
      consoleErrors: facts.consoleErrors,
      failedInteractions: facts.failedInteractions,
      screenshotCount: facts.screenshotCount,
    },
    interpretations: facts.interpretations,
  };
}
