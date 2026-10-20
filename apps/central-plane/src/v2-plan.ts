/**
 * v2-plan.ts — 검사 엔진 v2 S3: 가설 · 계획 (2026-10-21).
 *
 * 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.2-2(가설: 정적 사실 + 확인된 의도에서 위험 목록, 가설마다 "무엇을 하면
 * 무엇이 관찰되어야 참/거짓인가") · §2.2-3(계획: must 기준마다 끝까지 해 보는 경로 + 가설마다 확인 실험, **계획도 증거물로 남긴다** —
 * 재검사 때 그대로 재사용).
 *
 * 결정론 — 알려진 사실 분류(S2 R1~R5)마다 가설·실험 틀이 정해져 있다. LLM 0. 같은 입력이면 같은 계획.
 * 근거 없는 가설은 만들지 않는다(증거물 id가 없는 사실·모르는 분류는 건너뜀). 의도와 다른 기능(V-7 의도 불일치)은 S5에서 다룬다.
 * 순수 — 의존성은 같은 패키지 모듈만.
 */
import type { AgentAc } from "./agent-inspection.js";
import { classifyPrecondition } from "./ac-semantics.js";
import type { EvidenceStore } from "./evidence-chain.js";
import type { StaticFact, StaticFactClass } from "./recon.js";

export const PLAN_VERSION = "v2-plan-1";

export type ExperimentKind =
  | "submit_and_probe"
  | "fresh_browser_lookup"
  | "clock_early_morning_kst"
  | "real_time_window_kst"
  | "human_key_required";

export interface Experiment {
  kind: ExperimentKind;
  steps: string[];
  /** 이것이 관찰되면 가설이 참(결함) */
  confirmsIf: string;
  /** 이것이 관찰되면 가설이 거짓(결함 아님) */
  refutesIf: string;
  /** 실제 KST 시각 창 [시작, 끝) — 기기 시계로 바꿀 수 없는 서버 쪽 시각 */
  windowKst?: [number, number];
}

export interface Hypothesis {
  id: string;
  cls: StaticFactClass;
  statement: string;
  basisArtifactIds: string[];
  coversAcIds: string[];
  experiment: Experiment;
  /** 지금 실행할 수 있는가(시각 조건) */
  runnableNow: boolean;
}

export interface AcPlan {
  acId: string;
  priority: AgentAc["priority"];
  hypothesisIds: string[];
}

export interface V2Plan {
  version: typeof PLAN_VERSION;
  hypotheses: Hypothesis[];
  acPlans: AcPlan[];
  generatedFrom: { factArtifactIds: string[]; acIds: string[]; nowKstHour: number };
}

type PlanAc = Pick<AgentAc, "id" | "title" | "given" | "when" | "then" | "priority">;

/** 기록을 실제로 만들어야 성립하는 기준: 전제가 기록 · 또는 제출해서 긍정 결과를 본다(형식 거절 확인 같은 부정 결과는 제외). */
const RE_SUBMIT = /예약한다|예약을 한다|신청한다|제출|저장한다|등록한다|submit|book it|save/i;
const RE_NEGATIVE_OUTCOME = /되지 않|안 된|않고|막는|막힌|거절|not (?:booked|saved|accepted)|rejected/i;
/** 날짜·시간 목록을 보는 기준(UTC 날짜면 지난 시간·하루 전 날짜가 보인다). */
const RE_DATE_LIST = /시간 목록|날짜 목록|달력|time slots?|calendar/i;
const RE_TODAY = /오늘|today/i;

function createsRecord(ac: PlanAc): boolean {
  if (classifyPrecondition(ac).needsRecord) return true;
  return RE_SUBMIT.test(ac.when) && !RE_NEGATIVE_OUTCOME.test(ac.then);
}

function dateSensitive(ac: PlanAc): boolean {
  const p = classifyPrecondition(ac);
  return RE_TODAY.test(`${ac.given} ${ac.then}`) || p.adminScreen || RE_DATE_LIST.test(`${ac.when} ${ac.then}`);
}

interface Template {
  statement: string;
  covers: (ac: PlanAc) => boolean;
  experiment: Experiment;
}

const TEMPLATES: Partial<Record<StaticFactClass, Template>> = {
  missing_backend_config: {
    statement: "앱이 서버(데이터베이스)에 연결되지 않아 예약 같은 결과가 저장되지 않는다",
    covers: createsRecord,
    experiment: {
      kind: "submit_and_probe",
      steps: ["유효한 시험 데이터로 핵심 흐름을 끝까지 제출한다", "제출 직후 서버 쓰기 요청과 화면 안내를 기록한다"],
      confirmsIf: "서버 쓰기 0건이고 연결·설정이 필요하다는 안내만 보인다",
      refutesIf: "서버 쓰기 요청이 2xx로 성공하고 결과(완료·목록)가 보인다",
    },
  },
  client_only_storage: {
    statement: "기록이 그 브라우저(기기)에만 저장돼 다른 손님·사장님 화면에서는 보이지 않는다",
    covers: (ac) => {
      const p = classifyPrecondition(ac);
      return p.otherSession || p.adminScreen;
    },
    experiment: {
      kind: "fresh_browser_lookup",
      steps: ["같은 브라우저에서 기록 1건을 만든다", "새 브라우저(다른 손님)로 같은 날짜·시간을 본다", "새 브라우저로 관리 화면을 연다"],
      confirmsIf: "새 브라우저에서 그 시간이 열려 있거나 관리 화면에 그 기록이 없다",
      refutesIf: "새 브라우저에서도 그 시간이 막혀 있고 관리 화면에 그 기록이 있다",
    },
  },
  timezone_date: {
    statement: "앱이 '오늘'을 UTC 날짜로 계산해 한국 새벽(00~09시)에는 하루 전 날짜·목록을 보여 준다",
    covers: dateSensitive,
    experiment: {
      kind: "clock_early_morning_kst",
      steps: ["실행기가 기기 시계를 KST 00:30으로 옮긴다(에이전트가 아니라 실행기 — 시계 이동 pass 불인정 규칙)", "날짜 선택의 첫 날짜와 관리 화면의 '오늘'을 본다"],
      confirmsIf: "보이는 '오늘'이 한국 날짜보다 하루 전이거나 오늘 예약이 목록에 없다",
      refutesIf: "KST 00:30에도 '오늘'이 한국 날짜와 같고 오늘 예약이 보인다",
    },
  },
  server_rendered_dates: {
    statement: "서버가 '오늘'을 서버 시간대(UTC)로 계산해 한국 새벽에는 관리 화면 '오늘'이 하루 전이다",
    covers: dateSensitive,
    experiment: {
      kind: "real_time_window_kst",
      steps: ["실제 KST 00:00~09:00에 관리 화면 '오늘'의 날짜와 목록을 본다(기기 시계로는 서버를 속일 수 없다)"],
      confirmsIf: "관리 화면 '오늘' 날짜가 한국 날짜보다 하루 전이다",
      refutesIf: "그 시각에도 '오늘'이 한국 날짜와 같다",
      windowKst: [0, 9],
    },
  },
  needs_api_key: {
    statement: "사용자가 자기 API 키를 넣어야 시작할 수 있어 비개발자는 첫 단계에서 막힌다",
    covers: (ac) => ac.priority === "must",
    experiment: {
      kind: "human_key_required",
      steps: ["첫 화면에서 키 입력 요구와 키 없이 진행 가능한지 본다"],
      confirmsIf: "키 없이는 핵심 흐름을 시작할 수 없다",
      refutesIf: "키 없이도 핵심 흐름이 끝까지 된다",
    },
  },
};

function runnable(exp: Experiment, nowKstHour: number): boolean {
  if (!exp.windowKst) return true;
  const [from, to] = exp.windowKst;
  return nowKstHour >= from && nowKstHour < to;
}

/** 정적 사실(증거물 id 포함)과 확인된 기준으로 가설·계획을 만든다(결정론). */
export function buildPlan(input: {
  acs: readonly PlanAc[];
  facts: ReadonlyArray<{ fact: Pick<StaticFact, "cls"> & Partial<StaticFact>; artifactId: string | null }>;
  nowKstHour: number;
}): V2Plan {
  const { acs, facts, nowKstHour } = input;
  const byCls = new Map<StaticFactClass, string[]>();
  for (const { fact, artifactId } of facts) {
    const cls = fact.cls as StaticFactClass;
    if (!artifactId || !TEMPLATES[cls]) continue;
    byCls.set(cls, [...(byCls.get(cls) ?? []), artifactId]);
  }
  const hypotheses: Hypothesis[] = [];
  for (const [cls, basis] of byCls) {
    const t = TEMPLATES[cls]!;
    hypotheses.push({
      id: `H${hypotheses.length + 1}`,
      cls,
      statement: t.statement,
      basisArtifactIds: [...new Set(basis)],
      coversAcIds: acs.filter(t.covers).map((a) => a.id),
      experiment: { ...t.experiment, steps: [...t.experiment.steps], ...(t.experiment.windowKst ? { windowKst: [...t.experiment.windowKst] as [number, number] } : {}) },
      runnableNow: runnable(t.experiment, nowKstHour),
    });
  }
  const acPlans: AcPlan[] = acs.map((a) => ({
    acId: a.id,
    priority: a.priority,
    hypothesisIds: hypotheses.filter((h) => h.coversAcIds.includes(a.id)).map((h) => h.id),
  }));
  return {
    version: PLAN_VERSION,
    hypotheses,
    acPlans,
    generatedFrom: { factArtifactIds: [...byCls.values()].flat(), acIds: acs.map((a) => a.id), nowKstHour },
  };
}

/** 계획 원문이 증거물 원문 상한(기본 4000자)을 넘으면 잘려서 되읽을 수 없다 — 조용히 자르지 않고 실패시킨다. */
const PLAN_RAW_LIMIT = 3900;

/** 계획을 증거물(kind context)로 남긴다 — 재검사가 같은 계획을 다시 쓴다(설계 §2.2-3). */
export function recordPlan(store: Pick<EvidenceStore, "add">, plan: V2Plan): string | null {
  const raw = JSON.stringify(plan);
  if (raw.length > PLAN_RAW_LIMIT) throw new Error(`plan_too_large:${raw.length}`);
  return store.add("context", `계획 ${plan.version} — 가설 ${plan.hypotheses.length}개 · 기준 ${plan.acPlans.length}개`, raw);
}

/** 저장된 계획을 되읽는다. 형식이 깨졌으면 null(재검사는 새로 만든다). */
export function parseRecordedPlan(raw: string): V2Plan | null {
  try {
    const p = JSON.parse(raw) as V2Plan;
    if (p?.version !== PLAN_VERSION || !Array.isArray(p.hypotheses) || !Array.isArray(p.acPlans)) return null;
    return p;
  } catch {
    return null;
  }
}
