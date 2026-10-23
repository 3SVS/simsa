/**
 * dataset/machine-candidates.ts — v2 검수 리포트 → 라벨링 설계 v1의 **기계 후보** 라벨 (train L2, 2026-10-24).
 *
 * 설계 §7: 데이터셋의 정답은 라벨링 에이전트·사람 확정 라벨이고, 기계 판정은 같은 스키마에 나란히 두는 "후보"다.
 * 그래서 여기서는 **증거 사슬이 있는 것만** 옮긴다:
 *   - v2 리포트만(v1에는 증거물·재실행 확인이 없다)
 *   - 실패 사건(F)은 재실행으로 확인된(confirmed) fail·mismatch만
 *   - 원인 층(C)은 관찰 근거(정적 사실·콘솔)가 있을 때만, 판정 문장으로만 정한 원인이면 unknown(§3 C)
 *   - 재현성(R)은 단정하지 않는다 — 기계는 원래 실행 + 재실행 2회뿐이라 reproduced {k,n}에만 적는다(3회 규칙은 라벨러 몫)
 *   - 기계 전용 사유(not_reached·evidence_missing…)는 사람 H2 어휘로 옮기지 않고 machineReasons에 둔다(§7 대응표 밖)
 * 규칙은 결정론(LLM 없음) — 같은 리포트면 같은 후보.
 */
import { DEFECT_CLASSES, type DefectClass } from "../agent-inspection.js";
import { LABEL_VERSIONS, type AcLabel, type FailureEvent } from "./labels.js";

interface RowLike {
  id: string;
  priority?: string;
  status?: string;
  actions?: string[];
}
interface EvidenceLike {
  id?: string;
  kind?: string;
  summary?: string;
  excerpt?: string;
}
interface VerdictLike {
  acId: string;
  verdict: string;
  confirmed?: boolean;
  reasons?: string[];
  claim?: string;
  quotes?: string[];
  evidence?: EvidenceLike[];
  cause?: { cls?: string; basis?: string; location?: { file: string; line: number | null } | null };
}
interface ReportLike {
  engineVersion?: string;
  acTable?: RowLike[];
  v2?: {
    runnerRev?: string | null;
    entry?: { cause: string; status?: number | null } | null;
    verdicts?: VerdictLike[];
    defectGroups?: Array<{ key: string; acIds: string[] }>;
    fix?: { validated?: string[]; cannotFix?: string[] } | null;
  };
}
interface AcLike {
  id: string;
  title?: string;
  then?: string;
  priority?: string;
}

const RE = {
  admin: /관리|사장|admin|owner/i,
  modify: /취소|수정|삭제|cancel|edit|delete/i,
  share: /다른 (손님|방문자|사람|사용자|브라우저|기기)|새 브라우저|new browser|another (visitor|user|device)/i,
  persist: /새로고침|다시 열|reload|refresh/i,
  result: /완료 화면|결과|result|confirmation/i,
  clock: /새벽|0시 30분|00:30|early morning/i,
  potemkin: /완료|보이지만|나타나지만|잠시|나오지만|looks? (done|saved)|appears? but/i,
  setup: /설정|연결|config|connect/i,
};

const CAUSE_LAYER: Partial<Record<string, FailureEvent["c"]>> = {
  missing_backend_config: "backend_missing",
  client_only_storage: "browser_only_storage",
  not_shared_across_users: "backend_missing",
  data_not_persisted: "client_state",
  timezone_date: "timezone",
  runtime_error: "client_state",
  broken_action: "ui",
  needs_api_key: "external_integration",
  canned_result: "spec_not_implemented",
  intent_mismatch: "spec_not_implemented",
  route_404_missing_index: "routing_deploy",
  wrong_language: "encoding_locale",
  auth_gate: "auth",
};

function symptomOf(k: DefectClass, w1: FailureEvent["w1"], claim: string): FailureEvent["y"] {
  switch (k) {
    case "client_only_storage":
    case "not_shared_across_users":
      return w1 === "share" || w1 === "admin" ? "not_visible_to_others" : "not_saved";
    case "data_not_persisted":
      return "not_saved";
    case "missing_backend_config":
      return RE.setup.test(claim) ? "setup_required_message" : "not_saved";
    case "runtime_error":
    case "broken_action":
      return "no_response";
    case "timezone_date":
      return "wrong_date_time";
    case "canned_result":
      return "fake_result";
    case "needs_api_key":
      return "setup_required_message";
    case "route_404_missing_index":
      return "blank_screen";
    case "wrong_language":
      return "broken_text";
    default:
      return "other";
  }
}

function stageOf(text: string, actions: string[], evidence: EvidenceLike[]): FailureEvent["w1"] {
  const fresh = evidence.some((e) => /^fresh /.test(e.summary ?? ""));
  if (RE.admin.test(text)) return "admin";
  if (RE.modify.test(text)) return "modify";
  if (fresh || RE.share.test(text) || actions.some((a) => RE.share.test(a))) return "share";
  if (RE.persist.test(text) || actions.some((a) => RE.persist.test(a))) return "persist";
  if (RE.result.test(text)) return "result";
  const filled = actions.some((a) => /입력|fill/.test(a));
  if (filled && actions.some((a) => /누르기|click/.test(a))) return "submit";
  if (filled) return "input";
  return "navigate";
}

function actionOf(w1: FailureEvent["w1"], claim: string, actions: string[]): FailureEvent["w3"] {
  if (RE.clock.test(claim)) return "time_change";
  if (w1 === "share") return "new_browser";
  if (w1 === "persist") return "reload";
  const last = actions.at(-1) ?? "";
  if (/입력|fill/.test(last)) return "fill";
  if (/고르기|선택|select/.test(last)) return "select";
  if (/누르기|click/.test(last)) return "click";
  return "none";
}

function screenOf(evidence: EvidenceLike[]): string {
  for (const e of evidence) {
    const m = /^\w+ (\/[^\s:]*):/.exec(e.summary ?? "");
    if (m?.[1]) return m[1].replace(/\/\d+(?=\/|$)/g, "/:id").slice(0, 120);
  }
  return "/";
}

/** 우선순위는 닫힌 어휘만 옮긴다. */
function prio(r: RowLike): { priority?: "must" | "should" | "could" } {
  return r.priority === "must" || r.priority === "should" || r.priority === "could" ? { priority: r.priority } : {};
}

const isDefect = (x: unknown): x is DefectClass => typeof x === "string" && (DEFECT_CLASSES as readonly string[]).includes(x);

export function machineCandidatesFromV2Report(
  report: ReportLike,
  ctx: { runId: string; appId: string; createdAt: string; acs?: AcLike[] },
): { acLabels: AcLabel[]; failureEvents: FailureEvent[] } {
  if (report?.engineVersion !== "v2" || !report.v2) return { acLabels: [], failureEvents: [] };
  const v2 = report.v2;
  const rows = report.acTable ?? [];
  const acText = new Map((ctx.acs ?? []).map((a) => [a.id, `${a.title ?? ""} ${a.then ?? ""}`]));
  const base = {
    source: "machine" as const,
    producer: v2.runnerRev ?? "agent-v2",
    createdAt: ctx.createdAt,
    versions: { ...LABEL_VERSIONS },
  };
  const labelId = (acId: string) => `${ctx.runId}:${acId}:machine`;

  // 첫 화면 즉시 고장 — 기준은 전부 확인 못 함(app_down), 실패 사건은 앱 하나에 1개(entry).
  if (v2.entry) {
    const acLabels = rows.map((r) => ({
      ...base, labelId: labelId(r.id), runId: ctx.runId, appId: ctx.appId, acId: r.id,
      ...prio(r),
      h1: "cannot_verify" as const, h2: "app_down" as const, h3: "mostly" as const, h4: "full" as const, h5: [], h6: [],
    }));
    const k: DefectClass = /missing_index|not_found|deployment/.test(v2.entry.cause) ? "route_404_missing_index" : "other";
    const failureEvents: FailureEvent[] = [{
      ...base, failureId: `${ctx.runId}:entry:F1`, labelId: labelId("entry"), runId: ctx.runId, appId: ctx.appId, acId: "entry",
      w1: "entry", w2: "/", w3: "none", y: "blank_screen", c: k === "route_404_missing_index" ? "routing_deploy" : "unknown", k, s: "S1",
      r: null, a: "builder", p: false, memo: `entry ${v2.entry.cause}${v2.entry.status ? ` (${v2.entry.status})` : ""}`,
    }];
    return { acLabels, failureEvents };
  }

  const verdicts = new Map((v2.verdicts ?? []).map((v) => [v.acId, v]));
  const acLabels: AcLabel[] = [];
  const failureEvents: FailureEvent[] = [];
  for (const row of rows) {
    const v = verdicts.get(row.id);
    if (!v) continue;
    const evidence = v.evidence ?? [];
    const h1: AcLabel["h1"] = v.verdict === "pass" ? "pass" : v.verdict === "fail" || v.verdict === "mismatch" ? "fail" : "cannot_verify";
    const h5 = evidence.length
      ? evidence.slice(0, 10).map((e) => ({ ...(e.id && /^E[1-9]\d{0,4}$/.test(e.id) ? { artifactId: e.id } : {}), ...(e.kind ? { kind: e.kind } : {}), quote: String(e.excerpt ?? e.summary ?? "").slice(0, 300) }))
      : (v.quotes ?? []).slice(0, 10).map((q) => ({ quote: q.slice(0, 300) }));
    const actions = (row.actions ?? []).slice(0, 30).map((a) => a.slice(0, 200));
    acLabels.push({
      ...base, labelId: labelId(row.id), runId: ctx.runId, appId: ctx.appId, acId: row.id,
      ...prio(row),
      h1, h2: null, h3: v.confirmed === true && (v.reasons ?? []).length === 0 ? "mostly" : "unsure", h4: "full", h5, h6: actions,
      ...(v.claim ? { h8: v.claim.slice(0, 400) } : {}),
      ...(h1 === "cannot_verify" && (v.reasons ?? []).length ? { machineReasons: (v.reasons ?? []).slice(0, 10) } : {}),
    });

    if ((v.verdict !== "fail" && v.verdict !== "mismatch") || v.confirmed !== true) continue;
    const claim = v.claim ?? "";
    const text = `${acText.get(row.id) ?? ""} ${claim}`;
    const k: DefectClass = v.verdict === "mismatch" ? "intent_mismatch" : isDefect(v.cause?.cls) ? v.cause.cls : "other";
    const w1 = stageOf(text, actions, evidence);
    const w3 = actionOf(w1, claim, actions);
    const observed = v.cause?.basis === "static_fact" || v.cause?.basis === "console" || v.verdict === "mismatch";
    const s: FailureEvent["s"] = row.priority !== "must" ? "S3" : w1 === "share" || w1 === "admin" || w1 === "modify" || w1 === "persist" || w3 === "time_change" ? "S2" : "S1";
    const y = symptomOf(k, w1, claim);
    const fix = v2.fix;
    const x: FailureEvent["x"] = fix?.validated?.includes(row.id) ? "small_code" : (fix?.cannotFix ?? []).some((c) => c.startsWith(`${row.id}:`)) ? "structural" : "unknown";
    const group = (v2.defectGroups ?? []).find((g) => g.acIds.includes(row.id));
    failureEvents.push({
      ...base, failureId: `${ctx.runId}:${row.id}:F1`, labelId: labelId(row.id), runId: ctx.runId, appId: ctx.appId, acId: row.id,
      w1, w2: screenOf(evidence), w3, y, c: observed ? (CAUSE_LAYER[k] ?? "unknown") : "unknown", k, s,
      r: null, reproduced: { k: 2, n: 2 }, a: "builder",
      p: RE.potemkin.test(claim) && (y === "not_saved" || y === "not_visible_to_others" || y === "fake_result"),
      x, location: v.cause?.location ?? null, ...(group ? { defectGroup: group.key } : {}), memo: claim.slice(0, 400),
    });
  }
  return { acLabels, failureEvents };
}
