/**
 * v2-report.ts — 검사 엔진 v2 S7b: v2 결과 → 기존 agent 리포트 모양 (2026-10-23).
 *
 * 대시보드는 `engine:"agent"` 리포트(기준 표·한 줄·메모)를 그린다. v2 판정을 같은 기준 표로 옮기고 결정도 기존 규칙
 * (decideAgentVerdict)으로 내서 화면과 결정이 어긋나지 않게 한다. v2만의 것(원인 분류·위치·코드 조각, 결함 묶음, 고친 파일,
 * 가정·한계, 인용 증거물 요약)은 `report.v2`에 따로 싣는다 — 데이터(실패 사건 라벨)의 원천이 이 블록이다.
 * pass는 v2에서 상태 변화 증거물 + 실행기 재실행 확인을 거쳤으므로 exercised = { stateChange, verified: confirmed }.
 */
import { buildAgentReport, type AcResult, type AcSource, type AgentAc, type AgentReport, type AgentSignals } from "./agent-inspection.js";
import type { ReportLocale } from "./nondev-report.js";

interface V2ArtifactLike {
  id: string;
  kind: string;
  summary: string;
  raw: string;
}

interface V2CauseLike {
  cls: string;
  basis: string;
  evidenceIds: string[];
  sourceIds: string[];
  location: { file: string; line: number | null } | null;
}

interface V2VerdictLike {
  acId: string;
  verdict: string;
  originalVerdict?: string;
  claim: string;
  artifactIds: string[];
  reproArtifactIds?: string[];
  quotes: string[];
  reasons: string[];
  confirmed?: boolean;
  cause?: V2CauseLike;
}

export interface V2ResultLike {
  runnerRev?: string;
  decision?: string;
  intentMismatch?: string[];
  entry?: { broken?: { cause: string; status?: number | null } | null } | null;
  verdicts?: V2VerdictLike[];
  defectGroups?: Array<{ key: string; cls: string; hypothesisId: string | null; acIds: string[]; rootAcId: string }>;
  fix?: {
    attempted?: boolean;
    reason?: string;
    error?: string;
    validated?: string[];
    stillFailing?: string[];
    cannotFix?: string[];
    assumptions?: string[];
    diff?: string;
    correctedHtml?: string;
  } | null;
  actions?: Record<string, string[]>;
  artifacts?: { artifacts: V2ArtifactLike[]; truncated?: boolean };
}

const EXCERPT_MAX = 300;
const MISMATCH_PREFIX = { ko: "생각과 달라요: ", en: "Not what you meant: " } as const;
const ASSUMPTION_NOTE = { ko: (a: string) => `고친 파일 참고: ${a}`, en: (a: string) => `About the corrected file: ${a}` } as const;

function rowFor(v: V2VerdictLike, actions: string[] | undefined, L: ReportLocale): AcResult {
  const status: AcResult["status"] = v.verdict === "pass" ? "pass" : v.verdict === "fail" || v.verdict === "mismatch" ? "fail" : "not_verified";
  const reason = v.verdict === "mismatch" ? `${MISMATCH_PREFIX[L]}${v.claim}` : v.claim;
  const row: AcResult = { id: v.acId, status, reason, evidence: v.quotes.slice(0, 6), steps: actions?.length ?? 0 };
  if (status === "not_verified") row.reasonCode = v.reasons.includes("budget") ? "budget" : "evidence_missing";
  if (actions?.length) row.actions = actions.slice(0, 20);
  if (status === "pass") row.exercised = { stateChange: true, verified: v.confirmed === true };
  return row;
}

/** 첫 화면 즉시 고장 → 기존 리포트의 "앱 없음" 신호. */
function signalsFor(r: V2ResultLike): AgentSignals {
  const b = r.entry?.broken;
  if (!b) return {};
  return { pageNotFound: true, missingIndexFile: b.cause === "missing_index_file", loadStatus: b.status ?? null };
}

export function buildV2Report(
  r: V2ResultLike,
  ctx: { targetUrl: string; intent: string; acs: AgentAc[]; acSource: AcSource },
  locale: ReportLocale = "ko",
): { decision: string; works: boolean | null; report: AgentReport & { engineVersion: "v2"; v2: Record<string, unknown> } } {
  const L: ReportLocale = locale === "en" ? "en" : "ko";
  const verdicts = r.verdicts ?? [];
  const arts = new Map((r.artifacts?.artifacts ?? []).map((a) => [a.id, a]));
  const results = verdicts.map((v) => rowFor(v, r.actions?.[v.acId], L));
  const base = buildAgentReport(
    { targetUrl: ctx.targetUrl, intent: ctx.intent, acs: ctx.acs, acSource: ctx.acSource, results, sweep: null, signals: signalsFor(r), loginDepth: "L1", loginMethod: "none" },
    L,
  );
  const excerpt = (id: string) => {
    const a = arts.get(id);
    return a ? { id, kind: a.kind, summary: a.summary.slice(0, 200), excerpt: a.raw.slice(0, EXCERPT_MAX) } : null;
  };
  const fix = r.fix ?? null;
  const validated = (fix?.validated ?? []).length > 0;
  const v2 = {
    runnerRev: r.runnerRev ?? null,
    decision: r.decision ?? null,
    entry: r.entry?.broken ?? null,
    intentMismatch: r.intentMismatch ?? [],
    defectGroups: r.defectGroups ?? [],
    verdicts: verdicts.map((v) => ({
      acId: v.acId,
      verdict: v.verdict,
      ...(v.originalVerdict ? { originalVerdict: v.originalVerdict } : {}),
      confirmed: v.confirmed === true,
      reasons: v.reasons,
      claim: v.claim,
      quotes: v.quotes,
      evidence: [...new Set([...v.artifactIds, ...(v.reproArtifactIds ?? [])])].map(excerpt).filter((x): x is NonNullable<typeof x> => x !== null),
      ...(v.cause
        ? {
            cause: {
              cls: v.cause.cls,
              basis: v.cause.basis,
              location: v.cause.location,
              source: v.cause.sourceIds.map((id) => arts.get(id)?.raw.slice(0, EXCERPT_MAX)).filter((x): x is string => Boolean(x)),
              seen: v.cause.evidenceIds.map((id) => arts.get(id)?.raw.slice(0, EXCERPT_MAX)).filter((x): x is string => Boolean(x)),
            },
          }
        : {}),
    })),
    fix: fix
      ? {
          attempted: fix.attempted === true,
          ...(fix.reason ? { reason: fix.reason } : {}),
          ...(fix.error ? { error: fix.error } : {}),
          validated: fix.validated ?? [],
          stillFailing: fix.stillFailing ?? [],
          cannotFix: fix.cannotFix ?? [],
          assumptions: fix.assumptions ?? [],
          ...(fix.diff ? { diff: fix.diff } : {}),
          ...(validated && fix.correctedHtml ? { correctedHtml: fix.correctedHtml } : {}),
        }
      : null,
    artifactsTruncated: r.artifacts?.truncated === true,
  };
  // 고친 파일을 내줄 때 그 가정·한계(이 브라우저에만 저장, 자리표시자 값)는 사용자가 반드시 읽어야 한다.
  const notes = validated ? [...base.notes, ...(fix?.assumptions ?? []).map((a) => ASSUMPTION_NOTE[L](a))] : base.notes;
  return { decision: decisionOf(base), works: base.works, report: { ...base, notes, engineVersion: "v2", v2 } };
}

/** 기존 리포트가 낸 결정(라벨이 아니라 값). buildAgentReport는 basis·works를 싣는다 — 같은 규칙을 다시 부른다. */
function decisionOf(report: AgentReport): string {
  const basis = report.agent.basis;
  if (basis === "app_missing" || basis === "must_failed" || basis === "sweep_broken") return "Needs Fix";
  if (basis === "all_must_passed_confirmed") return "Ready";
  if (basis === "all_must_passed_inferred" || basis === "public_scope_only") return "Conditionally Ready";
  return "Not Verified";
}
