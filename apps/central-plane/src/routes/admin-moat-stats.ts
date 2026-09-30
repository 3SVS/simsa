/**
 * routes/admin-moat-stats.ts — Train C · C-4b GET /admin/moat-stats (재정렬 D-21 ⓪ "나라·도구·유형별 실패 지도",
 * D-8 amend 봉투, D-19 amend 북극성 = user_verdict as_intended).
 *
 * 0069 봉투 컬럼을 교차 집계한다 — **개수만**, JSON 한 개(관리자 집계 UI는 범위 밖, 재정렬 §5):
 *
 *   checks    검수 런 단위: region × built_with × topic × finding_code × user_verdict × resolved 셀 개수
 *             + 6축 채움률(비어 있지 않은 비율, 분모 명시) + 축별 한계 합계 + 첫 확인/재검수 수
 *   repairs   수리 잡 단위: region × resolved 셀 + region·verify 연결·resolved 채움률
 *   projects  프로젝트 단위: region_at_create × built_with × topic 셀 + 채움률
 *
 *   GET /admin/moat-stats?since=<ISO>&until=<ISO>   (기본: 최근 7일, since 포함·until 제외)
 *   인증: Bearer INTERNAL_CALLBACK_TOKEN — /admin/usage-stats(원장)와 같은 규칙(admin-internal.ts, 상수 시간 비교).
 *
 * ★출력하지 않는 것: 식별·내용 컬럼(user_key · intent · target_url · report_json · agent_prompt · title · idea ·
 *   repo_full_name · branch_name · pr_url · error …)은 **SELECT에 없다**(참조조차 하지 않는다). 읽는 JSON 컬럼
 *   (envelope_json · built_with_json · topic_tags_json · finding_codes_json)에서 나오는 값은 **닫힌 어휘**로만
 *   내보낸다 — built_with.other·modelNote 같은 자유 텍스트, 모르는 코드, 국가 코드처럼 생기지 않은 region은
 *   other / unrecorded로 접힌다. 행 시각·id도 나가지 않는다(기간 경계만).
 *
 * 의미:
 *   - 셀 개수는 런 수다. 발견 코드가 여럿인 런은 코드마다 한 번씩 센다(finding_code 축만 펼친다) — 그래서 셀 합은
 *     런 수보다 클 수 있다. 런 수는 checks.rows, 축별 런 수는 marginals.
 *   - finding_code: [] = 측정된 "발견 0" → none, NULL = 옛 컨테이너(기록 안 됨) → unrecorded.
 *   - resolved(런): 그 런의 **가장 최근 완료(done) 수리 잡**의 재검수 결과 — works=true면 resolved, false면
 *     not_resolved, 판정 전이면 unverified. 완료된 수리가 없으면: 진행 중인 잡이 있으면 repair_in_progress,
 *     실패만 했으면 repair_failed(고친 것이 없어 영원히 검증될 수 없다), 수리가 없으면 no_repair.
 *     채움률 분모 = 완료된 수리가 있는 런. (PR #572 검증 [7]: 종전 MAX(resolved)는 뒤 수리에서 되돌아간 런을
 *     resolved로 부풀렸고, 실패 잡을 unverified로 세어 분모를 키웠다.)
 *   - resolved(수리 잡): 같은 규칙을 잡 하나에 — done이면 resolved/not_resolved/unverified, failed면 repair_failed,
 *     queued·running이면 repair_in_progress. 재검수 연결·해결 채움률 분모 = 완료 잡.
 *   - 재검수 런(source_check_id 있음)도 자기 봉투·판정을 가진 한 런으로 센다(marginals.runKind로 구분).
 *
 * 상한: 절마다 가장 **최근** 행부터 최대 50,000행. 넘치면 truncated:true, 경계 타임스탬프 행을 버린
 *   [coveredSince, until)의 정확한 집계(usage-stats와 같은 규칙) — 더 오래된 구간은 until=coveredSince로 다시 부른다.
 * 조회 실패(0069 미적용 D1 등)는 500으로 숨기지 않고 503 stats_unavailable.
 * 인덱스: visual_checks·repair_jobs·projects에는 created_at 인덱스가 없다(이번 배치는 마이그레이션 없음) — 운영자가
 *   가끔 부르는 집계라 전체 스캔을 받아들이고, 인덱스는 다음 배치 후보로 PR에 적는다.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { FINDING_CODES } from "../nondev-report.js";
import { KNOWN_BUILT_WITH_TOOLS } from "../workspace/built-with.js";
import { TOPIC_DOMAINS } from "../workspace/topic-tags.js";
import { USER_VERDICTS } from "../workspace/visual-check-db.js";
import { coveredWindow, internalBearerRejection, parseStatsWindow } from "./admin-internal.js";

/** 절마다 한 번에 읽는 최대 행 수. */
export const MOAT_STATS_ROW_LIMIT = 50_000;
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 검수 런 + 그 런에 달린 수리 잡의 개수(전체·완료·실패)와 **가장 최근 완료 수리**의 재검수 결과.
 * 바인딩: since(포함), until(제외), limit.
 */
export const MOAT_CHECKS_SQL = `SELECT v.created_at, v.region, v.envelope_json, v.finding_codes_json, v.user_verdict,
       (v.source_check_id IS NOT NULL) AS is_recheck,
       (SELECT COUNT(*) FROM workspace_repair_jobs r WHERE r.visual_check_id = v.id) AS repair_count,
       (SELECT COUNT(*) FROM workspace_repair_jobs r WHERE r.visual_check_id = v.id AND r.status = 'done') AS repair_done_count,
       (SELECT COUNT(*) FROM workspace_repair_jobs r WHERE r.visual_check_id = v.id AND r.status = 'failed') AS repair_failed_count,
       (SELECT r.resolved FROM workspace_repair_jobs r WHERE r.visual_check_id = v.id AND r.status = 'done'
         ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS repair_resolved
  FROM workspace_visual_checks v
 WHERE v.created_at >= ? AND v.created_at < ?
 ORDER BY v.created_at DESC
 LIMIT ?`;

/** 수리 잡. status는 끝나지 못한 잡(failed·queued·running)을 가르는 데만 쓴다. 바인딩: since, until, limit. */
export const MOAT_REPAIRS_SQL = `SELECT created_at, region, status, (verify_check_id IS NOT NULL) AS verify_linked, resolved
  FROM workspace_repair_jobs
 WHERE created_at >= ? AND created_at < ?
 ORDER BY created_at DESC
 LIMIT ?`;

/** 프로젝트. built_with_json·topic_tags_json은 닫힌 어휘로 접어서만 내보낸다. 바인딩: since, until, limit. */
export const MOAT_PROJECTS_SQL = `SELECT created_at, region_at_create, built_with_json, topic_tags_json
  FROM workspace_projects
 WHERE created_at >= ? AND created_at < ?
 ORDER BY created_at DESC
 LIMIT ?`;

// ─── 닫힌 어휘 ─────────────────────────────────────────────────────────────────

const UNRECORDED = "unrecorded";
const RESOLVED_VALUES = ["resolved", "not_resolved", "unverified", "repair_failed", "repair_in_progress", "no_repair"] as const;
type ResolvedAxis = (typeof RESOLVED_VALUES)[number];

const KNOWN_TOOLS: ReadonlySet<string> = new Set<string>(KNOWN_BUILT_WITH_TOOLS);
const KNOWN_DOMAINS: ReadonlySet<string> = new Set<string>(TOPIC_DOMAINS);
const KNOWN_CODES: ReadonlySet<string> = new Set<string>(FINDING_CODES);
const KNOWN_VERDICTS: ReadonlySet<string> = new Set<string>(USER_VERDICTS);
const REGION_RE = /^[A-Z0-9]{2}$/;

/** 응답에 싣는 값 범례 — 모든 셀 값은 이 안에 있다(region은 ISO-3166 alpha-2 또는 unrecorded). */
export const MOAT_AXES = {
  region: "ISO-3166 alpha-2 (Cloudflare cf.country) | unrecorded",
  builtWith: [...KNOWN_BUILT_WITH_TOOLS, "multiple", UNRECORDED],
  topic: [...TOPIC_DOMAINS, "unclassified", UNRECORDED],
  findingCode: [...FINDING_CODES, "other", "none", UNRECORDED],
  userVerdict: [...USER_VERDICTS, UNRECORDED],
  resolved: [...RESOLVED_VALUES],
} as const;

// ─── D1 행 → 축 값 (명시 가드 + Zod, 외부 경계) ──────────────────────────────────

function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function int(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

function parseJson(raw: unknown): unknown {
  const s = text(raw);
  if (s === null) return undefined;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

const BuiltWithShape = z.object({ tools: z.array(z.unknown()).optional(), primary: z.unknown().optional() }).passthrough();
const TopicShape = z.object({ domain: z.unknown().optional() }).passthrough();
const EnvelopeShape = z.object({ builtWith: z.unknown().optional(), topicTags: z.unknown().optional() }).passthrough();

export function regionAxis(v: unknown): string {
  const s = text(v);
  return s !== null && REGION_RE.test(s) ? s : UNRECORDED;
}

/** primary(알려진 도구) → 알려진 도구 하나 → 여럿이면 multiple → 없으면 unrecorded. other 자유 텍스트는 보지 않는다. */
export function builtWithAxis(raw: unknown): string {
  const p = BuiltWithShape.safeParse(raw);
  if (!p.success) return UNRECORDED;
  const tools = [...new Set((p.data.tools ?? []).filter((t): t is string => typeof t === "string" && KNOWN_TOOLS.has(t)))];
  const primary = p.data.primary;
  if (typeof primary === "string" && tools.includes(primary)) return primary;
  if (tools.length === 1) return tools[0] ?? UNRECORDED;
  if (tools.length > 1) return "multiple";
  return UNRECORDED;
}

/** 태그가 기록됐으면 domain(닫힌 목록) 또는 unclassified, 기록 안 됐으면 unrecorded. */
export function topicAxis(raw: unknown): string {
  const p = TopicShape.safeParse(raw);
  if (!p.success) return UNRECORDED;
  const d = p.data.domain;
  return typeof d === "string" && KNOWN_DOMAINS.has(d) ? d : "unclassified";
}

/** 런 하나의 finding_code 축 값들(중복 제거). [] → none, 기록 안 됨·깨짐 → unrecorded, 모르는 코드 → other. */
export function findingCodeAxes(raw: unknown): string[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [UNRECORDED];
  if (parsed.length === 0) return ["none"];
  return [...new Set(parsed.map((c) => (typeof c === "string" && KNOWN_CODES.has(c) ? c : "other")))];
}

export function userVerdictAxis(v: unknown): string {
  const s = text(v);
  return s !== null && KNOWN_VERDICTS.has(s) ? s : UNRECORDED;
}

function resolvedFromFlag(v: unknown): ResolvedAxis {
  const n = int(v);
  return n === 1 ? "resolved" : n === 0 ? "not_resolved" : "unverified";
}

/**
 * 런 하나의 resolved 축. 완료된 수리가 있으면 가장 최근 완료 수리의 값(SQL이 골라 준다). 없으면 끝나지 못한
 * 수리를 따로 접는다 — 진행 중인 잡이 하나라도 있으면 repair_in_progress, 실패만 했으면 repair_failed.
 */
function runResolvedAxis(row: MoatCheckRow): { axis: ResolvedAxis; verifiable: boolean } {
  const total = int(row["repair_count"]) ?? 0;
  if (total <= 0) return { axis: "no_repair", verifiable: false };
  const done = int(row["repair_done_count"]) ?? 0;
  if (done > 0) return { axis: resolvedFromFlag(row["repair_resolved"]), verifiable: true };
  const failed = int(row["repair_failed_count"]) ?? 0;
  return { axis: total - failed > 0 ? "repair_in_progress" : "repair_failed", verifiable: false };
}

/** 수리 잡 하나의 resolved 축. 완료 잡만 재검수로 이어질 수 있다. */
function jobResolvedAxis(row: MoatCheckRow): { axis: ResolvedAxis; verifiable: boolean } {
  const status = text(row["status"]);
  if (status === "done") return { axis: resolvedFromFlag(row["resolved"]), verifiable: true };
  if (status === "failed") return { axis: "repair_failed", verifiable: false };
  return { axis: "repair_in_progress", verifiable: false };
}

// ─── 집계 ─────────────────────────────────────────────────────────────────────

export type Fill = { filled: number; total: number; rate: number | null };
type Counter = Record<string, number>;

function fill(filled: number, total: number): Fill {
  return { filled, total, rate: total > 0 ? Math.round((filled / total) * 1e4) / 1e4 : null };
}

function bump(counter: Counter, key: string, by = 1): void {
  counter[key] = (counter[key] ?? 0) + by;
}

/** 셀 Map → 배열: 개수 큰 순, 같으면 키(축 순서대로 "|" 연결) 사전순 — 결정적. */
function sortedCells<K extends string>(cells: Map<string, { key: Record<K, string>; count: number }>): Array<Record<K, string> & { count: number }> {
  return [...cells.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, c]) => ({ ...c.key, count: c.count }));
}

function addCell<K extends string>(cells: Map<string, { key: Record<K, string>; count: number }>, order: readonly K[], key: Record<K, string>): void {
  const id = order.map((k) => key[k]).join("|");
  const prev = cells.get(id);
  if (prev) prev.count += 1;
  else cells.set(id, { key, count: 1 });
}

const CHECK_AXES = ["region", "builtWith", "topic", "findingCode", "userVerdict", "resolved"] as const;
type CheckAxis = (typeof CHECK_AXES)[number];

export type MoatCheckRow = Record<string, unknown> & { created_at?: string | null };

/** 검수 런 교차 집계. 순수 — 라우트와 테스트가 같은 함수를 쓴다. */
export function aggregateMoatChecks(rows: readonly MoatCheckRow[]) {
  const cells = new Map<string, { key: Record<CheckAxis, string>; count: number }>();
  const marginals = {
    region: {} as Counter,
    builtWith: {} as Counter,
    topic: {} as Counter,
    findingCode: {} as Counter,
    userVerdict: {} as Counter,
    resolved: {} as Counter,
    runKind: {} as Counter,
  };
  const filled = { region: 0, builtWith: 0, topic: 0, findingCodes: 0, userVerdict: 0, resolved: 0 };
  /** 완료된 수리가 있는 런 — resolved 채움률의 분모(검증될 수 있는 런만). */
  let withDoneRepair = 0;

  for (const row of rows) {
    const env = EnvelopeShape.safeParse(parseJson(row["envelope_json"]));
    const region = regionAxis(row["region"]);
    const builtWith = env.success ? builtWithAxis(env.data.builtWith) : UNRECORDED;
    const topic = env.success ? topicAxis(env.data.topicTags) : UNRECORDED;
    const codes = findingCodeAxes(row["finding_codes_json"]);
    const userVerdict = userVerdictAxis(row["user_verdict"]);
    const { axis: resolved, verifiable } = runResolvedAxis(row);

    if (region !== UNRECORDED) filled.region += 1;
    if (builtWith !== UNRECORDED) filled.builtWith += 1;
    if (topic !== UNRECORDED) filled.topic += 1;
    if (codes[0] !== UNRECORDED) filled.findingCodes += 1;
    if (userVerdict !== UNRECORDED) filled.userVerdict += 1;
    if (verifiable) {
      withDoneRepair += 1;
      if (resolved !== "unverified") filled.resolved += 1;
    }

    bump(marginals.region, region);
    bump(marginals.builtWith, builtWith);
    bump(marginals.topic, topic);
    for (const c of codes) bump(marginals.findingCode, c);
    bump(marginals.userVerdict, userVerdict);
    bump(marginals.resolved, resolved);
    bump(marginals.runKind, int(row["is_recheck"]) === 1 ? "recheck" : "first");

    for (const findingCode of codes) addCell(cells, CHECK_AXES, { region, builtWith, topic, findingCode, userVerdict, resolved });
  }

  const total = rows.length;
  return {
    fill: {
      region: fill(filled.region, total),
      builtWith: fill(filled.builtWith, total),
      topic: fill(filled.topic, total),
      findingCodes: fill(filled.findingCodes, total),
      userVerdict: fill(filled.userVerdict, total),
      resolved: fill(filled.resolved, withDoneRepair),
    },
    marginals,
    cells: sortedCells(cells),
  };
}

const REPAIR_AXES = ["region", "resolved"] as const;

/** 수리 잡 집계: region × resolved + 채움률(region은 모든 잡, 재검수 연결·해결은 완료 잡이 분모). */
export function aggregateMoatRepairs(rows: readonly MoatCheckRow[]) {
  const cells = new Map<string, { key: Record<(typeof REPAIR_AXES)[number], string>; count: number }>();
  let region = 0;
  let done = 0;
  let verifyLinked = 0;
  let resolvedFilled = 0;
  for (const row of rows) {
    const r = regionAxis(row["region"]);
    const { axis: resolved, verifiable } = jobResolvedAxis(row);
    if (r !== UNRECORDED) region += 1;
    if (verifiable) {
      done += 1;
      if (int(row["verify_linked"]) === 1) verifyLinked += 1;
      if (resolved !== "unverified") resolvedFilled += 1;
    }
    addCell(cells, REPAIR_AXES, { region: r, resolved });
  }
  return {
    fill: { region: fill(region, rows.length), verifyLinked: fill(verifyLinked, done), resolved: fill(resolvedFilled, done) },
    cells: sortedCells(cells),
  };
}

const PROJECT_AXES = ["region", "builtWith", "topic"] as const;

/** 프로젝트 집계: region_at_create × built_with × topic + 채움률. */
export function aggregateMoatProjects(rows: readonly MoatCheckRow[]) {
  const cells = new Map<string, { key: Record<(typeof PROJECT_AXES)[number], string>; count: number }>();
  let region = 0;
  let builtWith = 0;
  let topic = 0;
  for (const row of rows) {
    const r = regionAxis(row["region_at_create"]);
    const b = builtWithAxis(parseJson(row["built_with_json"]));
    const t = topicAxis(parseJson(row["topic_tags_json"]));
    if (r !== UNRECORDED) region += 1;
    if (b !== UNRECORDED) builtWith += 1;
    if (t !== UNRECORDED) topic += 1;
    addCell(cells, PROJECT_AXES, { region: r, builtWith: b, topic: t });
  }
  const total = rows.length;
  return {
    fill: { region: fill(region, total), builtWith: fill(builtWith, total), topic: fill(topic, total) },
    cells: sortedCells(cells),
  };
}

// ─── 라우트 ───────────────────────────────────────────────────────────────────

async function readSection(env: Env, sql: string, sinceIso: string, untilIso: string) {
  const res = await env.DB.prepare(sql).bind(sinceIso, untilIso, MOAT_STATS_ROW_LIMIT).all<MoatCheckRow>();
  return coveredWindow(res.results ?? [], sinceIso, MOAT_STATS_ROW_LIMIT);
}

export function createAdminMoatStatsRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/admin/moat-stats", async (c) => {
    const rejected = internalBearerRejection(c);
    if (rejected) return rejected;

    const win = parseStatsWindow(c.req.query("since"), c.req.query("until"), DEFAULT_WINDOW_MS);
    if (!win.ok) return c.json({ ok: false, error: "invalid_range", detail: win.detail }, 400);
    const { sinceIso, untilIso } = win;

    let checks: Awaited<ReturnType<typeof readSection>>;
    let repairs: Awaited<ReturnType<typeof readSection>>;
    let projects: Awaited<ReturnType<typeof readSection>>;
    try {
      [checks, repairs, projects] = await Promise.all([
        readSection(c.env, MOAT_CHECKS_SQL, sinceIso, untilIso),
        readSection(c.env, MOAT_REPAIRS_SQL, sinceIso, untilIso),
        readSection(c.env, MOAT_PROJECTS_SQL, sinceIso, untilIso),
      ]);
    } catch (err) {
      console.error(JSON.stringify({ event: "moat_stats_query_failed", reason: String((err as Error)?.message ?? err).slice(0, 200) }));
      return c.json({ ok: false, error: "stats_unavailable" }, 503);
    }

    const section = (w: typeof checks) => ({ rows: w.rows.length, truncated: w.truncated, coveredSince: w.coveredSince });
    return c.json({
      ok: true,
      since: sinceIso,
      until: untilIso,
      checks: { ...section(checks), ...aggregateMoatChecks(checks.rows) },
      repairs: { ...section(repairs), ...aggregateMoatRepairs(repairs.rows) },
      projects: { ...section(projects), ...aggregateMoatProjects(projects.rows) },
      axes: MOAT_AXES,
    });
  });

  return app;
}
