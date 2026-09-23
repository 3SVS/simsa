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
