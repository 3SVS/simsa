/**
 * acceptance-plan.ts — T0 지시서의 테스트 계획 → 시각 검수 시나리오 (SI 티어 A5).
 *
 * 왜: 지금 검수는 "핵심 흐름 하나"만 본다. 지시서가 있으면 **수용 기준(AC)마다** 무엇을
 * 눌러 무엇이 보여야 하는지 이미 적혀 있다 — 그걸 검수의 자(尺)로 쓴다. 판정 어휘는
 * 그대로다(D-9): 시나리오가 무사히 끝나도 "확인 못 함"과 "문제 없음"을 구분할 뿐,
 * 사람 판단이 필요한 AC(human)는 애초에 시나리오로 만들지 않는다.
 *
 * Worker 전용(컨테이너에는 결과 JSON만 간다). 순수 함수 — 테스트 고정.
 */
import { validateDevSpec, type DevSpec } from "./workspace/dev-spec.js";
import { AGENT_MAX_ACS, orderAcs, type AcSource, type AgentAc } from "./agent-inspection.js";

/** 지시서 AC의 출처 라벨: 역추론(주소·저장소 문 + 확인) · 기획서 문 · 아이디어 인터뷰. */
export function devSpecAcSource(devSpec: unknown, entryPath: string | null | undefined): AcSource {
  const v = devSpec === null || devSpec === undefined ? null : validateDevSpec(devSpec);
  if (v && v.ok && v.spec.meta.source === "inferred") return "confirmed_inferred";
  if (entryPath === "spec" || (v && v.ok && v.spec.meta.source === "manual")) return "document";
  return "interview";
}

export type AcceptanceScenario = {
  acceptanceId: string;
  featureId: string;
  featureTitle: string;
  priority: "must" | "should" | "could";
  /** 기대 결과(Then) — 리포트에 그대로 보인다. */
  then: string;
  /** 사람이 따라 할 수 있는 단계. 첫 단계는 어느 화면을 여는지. */
  steps: string[];
  /** 결정론 플래너(planVisualFlow)에 주는 의도 앵커 — then + steps. */
  anchor: string;
};

export const DEFAULT_MAX_SCENARIOS = 4;
const PRIORITY_RANK = { must: 0, should: 1, could: 2 } as const;

/**
 * 유효한 DevSpec의 browser 테스트 계획을 우선순위(must→should→could, 같은 순위는 AC id)로
 * 골라 최대 `max`개. DevSpec이 없거나 깨졌으면 빈 배열(검수는 종전대로 핵심 흐름만).
 */
export function acceptancePlanFromDevSpec(devSpec: unknown, opts: { max?: number } = {}): AcceptanceScenario[] {
  if (devSpec === null || devSpec === undefined) return [];
  const v = validateDevSpec(devSpec);
  if (!v.ok) return [];
  return scenariosFrom(v.spec, opts.max ?? DEFAULT_MAX_SCENARIOS);
}

function scenariosFrom(spec: DevSpec, max: number): AcceptanceScenario[] {
  const featureById = new Map(spec.features.map((f) => [f.id, f]));
  const acById = new Map(spec.acceptance.map((a) => [a.id, a]));
  const out: AcceptanceScenario[] = [];
  for (const t of spec.testPlan) {
    if (t.kind !== "browser") continue;
    const ac = acById.get(t.acceptanceId);
    if (!ac || ac.verifiedBy === "human") continue;
    const f = featureById.get(ac.featureId);
    if (!f) continue;
    out.push({
      acceptanceId: ac.id,
      featureId: f.id,
      featureTitle: f.title,
      priority: f.priority,
      then: ac.then,
      steps: t.steps,
      anchor: `${ac.then}. ${t.steps.join(" → ")}`.slice(0, 600),
    });
  }
  out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.acceptanceId.localeCompare(b.acceptanceId));
  return out.slice(0, Math.max(0, max));
}

/**
 * agent 엔진(2026-10-05): 지시서의 수용 기준 → 실행기 AC. human만 사람이 보는 것이라 뺀다(build·test·browser는
 * 실제 앱에서 결과가 보이므로 실행기가 해 본다). confirmed = 정본 지시서(source ≠ inferred)이거나 유저가
 * "맞나요?"에서 확인한 AC(userConfirmedAcIds). priority는 기능(FR)의 것을 물려받는다(scenariosFrom과 같은 규칙).
 */
export function agentAcsFromDevSpec(devSpec: unknown, opts: { max?: number } = {}): AgentAc[] {
  if (devSpec === null || devSpec === undefined) return [];
  const v = validateDevSpec(devSpec);
  if (!v.ok) return [];
  const spec = v.spec;
  const featureById = new Map(spec.features.map((f) => [f.id, f]));
  const stepsByAc = new Map<string, string[]>();
  for (const t of spec.testPlan) if (t.kind === "browser") stepsByAc.set(t.acceptanceId, t.steps);
  const inferred = spec.meta.source === "inferred";
  const confirmedIds = new Set(spec.meta.provenance?.userConfirmedAcIds ?? []);
  // 2026-10-06: 역추론 지시서에서 사용자가 자기 말로 적지 않은(추론만으로 생긴) 기준은 must여도 should로 — 그 실패가
  // "고쳐야 해요"를 만들면 안 된다(지어낸 요구로 고침 지시를 만든다). userTextAcIds가 없는 옛 지시서는 종전대로.
  const userText = spec.meta.provenance?.userTextAcIds;
  const userTextIds = userText ? new Set(userText) : null;
  const out: AgentAc[] = [];
  // 2026-10-18(문 (b) 격차 §1-2): 상한에 잘릴 때 **사용자가 직접 적은 것 > 직접 체크한 것 > 정본 > 추론** 순으로 남기고,
  // 같은 출처 안에서는 기능마다 첫 AC를 먼저(라운드로빈) — 체크한 기능 6개가 AC 2개씩으로 10칸을 다 써서 사용자가
  // "빠진 것"에 적은 항목이 전부 잘리던 결함. 정렬은 안정(저장 순서 보존)이고 orderAcs도 안정 정렬이라 컨테이너까지 유지된다.
  const nthOfFeature = new Map<string, number>();
  const keyed: Array<{ ac: AgentAc; originRank: number; nth: number; index: number }> = [];
  for (const a of spec.acceptance) {
    if (a.verifiedBy === "human") continue;
    const f = featureById.get(a.featureId);
    if (!f) continue;
    const steps = stepsByAc.get(a.id);
    const origin: NonNullable<AgentAc["origin"]> = !inferred ? "spec" : userTextIds?.has(a.id) ? "user_text" : confirmedIds.has(a.id) ? "user_checked" : "inferred";
    const nth = nthOfFeature.get(a.featureId) ?? 0;
    nthOfFeature.set(a.featureId, nth + 1);
    keyed.push({
      ac: {
        id: a.id,
        title: f.title,
        given: a.given,
        when: a.when,
        then: a.then,
        // 2026-10-06 Bae 결정("기본 체크 해제"): 카드의 추론 항목은 체크 해제로 시작하므로, 확인 목록(userConfirmedAcIds)은
        //  사용자가 **직접 체크한** 것이다. must = 직접 체크 + 직접 적은 것. 그 밖(추론만)의 must는 should로.
        priority: inferred && !confirmedIds.has(a.id) && !userTextIds?.has(a.id) && f.priority === "must" ? "should" : f.priority,
        confirmed: !inferred || confirmedIds.has(a.id),
        origin,
        ...(steps ? { steps } : {}),
      },
      originRank: AC_ORIGIN_RANK[origin],
      nth,
      index: keyed.length,
    });
  }
  keyed.sort(
    (x, y) =>
      PRIORITY_RANK[x.ac.priority] - PRIORITY_RANK[y.ac.priority] || x.originRank - y.originRank || x.nth - y.nth || x.index - y.index,
  );
  for (const k of keyed) out.push(k.ac);
  return orderAcs(out, opts.max ?? AGENT_MAX_ACS);
}

/** 상한에 잘릴 때 남기는 순서 — 사용자가 직접 적은 것이 맨 앞. */
const AC_ORIGIN_RANK: Record<NonNullable<AgentAc["origin"]>, number> = { user_text: 0, user_checked: 1, spec: 2, inferred: 3 };

/** 제목+결과를 정규화한 열쇠 — AC-nnn id는 생성마다 LLM이 새로 매기므로 id로는 "같은 기준"을 알 수 없다. */
function acKey(a: Pick<AgentAc, "title" | "then">): string {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
  return `${norm(a.title)}\u0000${norm(a.then)}`;
}

export type AcDiff = {
  added: Array<{ id: string; title: string; then: string }>;
  removed: Array<{ id: string; title: string; then: string }>;
  kept: Array<{ prevId: string; nextId: string; title: string }>;
};

/**
 * 2026-10-18 HANDOFF §3-3: 사용자가 "기획을 바꿨다"고 명시해 지시서를 다시 뽑을 때, 이전 AC와의 차이를 기록한다.
 * 같은 기준 = 정규화한 제목+결과가 같은 것(id 무관). 순수 함수 — 테스트 고정.
 */
export function diffAcs(prev: readonly AgentAc[], next: readonly AgentAc[]): AcDiff {
  const prevByKey = new Map<string, AgentAc>();
  for (const a of prev) if (!prevByKey.has(acKey(a))) prevByKey.set(acKey(a), a);
  const matchedPrev = new Set<string>();
  const added: AcDiff["added"] = [];
  const kept: AcDiff["kept"] = [];
  for (const n of next) {
    const p = prevByKey.get(acKey(n));
    if (p && !matchedPrev.has(p.id)) {
      matchedPrev.add(p.id);
      kept.push({ prevId: p.id, nextId: n.id, title: n.title });
    } else added.push({ id: n.id, title: n.title, then: n.then });
  }
  const removed = prev.filter((p) => !matchedPrev.has(p.id)).map((p) => ({ id: p.id, title: p.title, then: p.then }));
  return { added, removed, kept };
}
