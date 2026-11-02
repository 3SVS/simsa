/**
 * dataset/agreement.ts — 두 라벨러 패스의 일치도와 합치기 (train L2, 2026-10-27).
 *
 * 설계 §0.0: 이중 라벨 = **서로 다른 벤더** 두 패스의 독립 라벨. §6: 일치도는 필드마다 잰다 —
 *   H1 Cohen's κ ≥ 0.7 · W1 일치율 ≥ 0.7 · Y κ ≥ 0.6 · S 가중 κ ≥ 0.6 · A κ ≥ 0.6 · C는 보고만 (수치 [PILOT], 첫 100행 전에만 조정)
 * 합치기: 두 패스가 같은 판정이면 합의 라벨, 다르면 "다툼"으로 남긴다 — 다툼은 사용자 질문(§8.5) → 세 번째 패스(다른 벤더)
 * → 그래도면 "미확정" 보관. 여기서는 다툼 목록과 그다음 할 일만 정한다(누가 이겼는지 고르지 않는다).
 */
import type { AcLabel, FailureEvent } from "./labels.js";
import { S_SEVERITY } from "./labels.js";

/** [PILOT] 설계 §6 목표 — 첫 100행 전에만 조정. */
export const AGREEMENT_TARGETS = Object.freeze({ h1Kappa: 0.7, w1Agree: 0.7, yKappa: 0.6, sWeightedKappa: 0.6, aKappa: 0.6 });

export interface KappaResult {
  n: number;
  /** 관찰 일치율 */
  po: number;
  /** κ — 표본이 0이면 null. 기대 일치가 1(두 패스가 늘 같은 값 하나만)이면 po가 1일 때 1, 아니면 0 */
  kappa: number | null;
}

/** Cohen's κ (명목). a·b는 같은 순서의 짝. */
export function cohenKappa(a: readonly string[], b: readonly string[]): KappaResult {
  const n = Math.min(a.length, b.length);
  if (n === 0) return { n: 0, po: 0, kappa: null };
  const cats = [...new Set([...a.slice(0, n), ...b.slice(0, n)])];
  let agree = 0;
  for (let i = 0; i < n; i += 1) if (a[i] === b[i]) agree += 1;
  const po = agree / n;
  let pe = 0;
  for (const c of cats) {
    const pa = a.slice(0, n).filter((x) => x === c).length / n;
    const pb = b.slice(0, n).filter((x) => x === c).length / n;
    pe += pa * pb;
  }
  if (pe >= 1) return { n, po, kappa: po === 1 ? 1 : 0 };
  return { n, po, kappa: (po - pe) / (1 - pe) };
}

/** 가중 κ (순서형, 선형 가중) — 심각도 S처럼 S1과 S2의 어긋남이 S1과 S4보다 가벼운 칸. */
export function weightedKappa(a: readonly string[], b: readonly string[], order: readonly string[]): KappaResult {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = order.indexOf(a[i] ?? "");
    const y = order.indexOf(b[i] ?? "");
    if (x >= 0 && y >= 0) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n === 0) return { n: 0, po: 0, kappa: null };
  const k = order.length;
  const w = (i: number, j: number) => (k <= 1 ? 1 : 1 - Math.abs(i - j) / (k - 1));
  const ra = new Array<number>(k).fill(0);
  const rb = new Array<number>(k).fill(0);
  let obs = 0;
  let exact = 0;
  for (const [x, y] of pairs) {
    ra[x] = (ra[x] ?? 0) + 1 / n;
    rb[y] = (rb[y] ?? 0) + 1 / n;
    obs += w(x, y) / n;
    if (x === y) exact += 1;
  }
  let exp = 0;
  for (let i = 0; i < k; i += 1) for (let j = 0; j < k; j += 1) exp += (ra[i] ?? 0) * (rb[j] ?? 0) * w(i, j);
  const po = exact / n;
  if (exp >= 1) return { n, po, kappa: obs >= 1 ? 1 : 0 };
  return { n, po, kappa: (obs - exp) / (1 - exp) };
}

export interface PassLabels {
  passId: string;
  vendor: string;
  acLabels: AcLabel[];
  failureEvents: FailureEvent[];
}

/** 짝 지을 열쇠 — 앱 × 기준. 같은 앱을 두 패스가 각자 다른 런으로 돌므로 runId가 아니라 appId로 맞춘다. */
const keyOf = (x: { appId: string; acId: string }) => `${x.appId}::${x.acId}`;
const firstEvent = (events: FailureEvent[]) => {
  const m = new Map<string, FailureEvent>();
  for (const e of events) if (!m.has(keyOf(e))) m.set(keyOf(e), e);
  return m;
};

export interface Dispute {
  appId: string;
  acId: string;
  field: "h1" | "w1" | "y" | "s" | "a";
  values: Record<string, string>;
  /** 다음 할 일(설계 §0.0): 판정이 갈리면 사용자에게 묻고, 사용자 답이 없으면 세 번째 패스(다른 벤더) */
  next: "ask_user" | "third_pass";
}

export interface AgreementReport {
  passes: Array<{ passId: string; vendor: string }>;
  sameVendor: boolean;
  pairedAcs: number;
  h1: KappaResult;
  /** 두 패스가 모두 fail로 본 기준의 실패 사건 칸 */
  w1: { n: number; agree: number; rate: number | null };
  y: KappaResult;
  s: KappaResult;
  a: KappaResult;
  c: KappaResult;
  meetsTargets: { h1: boolean; w1: boolean; y: boolean; s: boolean; a: boolean };
  consensus: Array<{ appId: string; acId: string; h1: AcLabel["h1"] }>;
  disputes: Dispute[];
}

/**
 * 두 패스 비교. 같은 벤더 두 패스는 이중 라벨이 아니다(설계 §0.0) — 계산은 하되 sameVendor로 표시하고 목표 충족을 모두 false로 둔다.
 */
export function comparePasses(p: PassLabels, q: PassLabels): AgreementReport {
  const sameVendor = p.vendor.trim().toLowerCase() === q.vendor.trim().toLowerCase();
  const qa = new Map(q.acLabels.map((l) => [keyOf(l), l]));
  const pairs = p.acLabels.map((l) => [l, qa.get(keyOf(l))] as const).filter((x): x is readonly [AcLabel, AcLabel] => x[1] !== undefined);
  const h1 = cohenKappa(pairs.map(([x]) => x.h1), pairs.map(([, y]) => y.h1));

  const pe = firstEvent(p.failureEvents);
  const qe = firstEvent(q.failureEvents);
  const evPairs = pairs
    .filter(([x, y]) => x.h1 === "fail" && y.h1 === "fail")
    .map(([x]) => [pe.get(keyOf(x)), qe.get(keyOf(x))] as const)
    .filter((x): x is readonly [FailureEvent, FailureEvent] => x[0] !== undefined && x[1] !== undefined);
  const w1Agree = evPairs.filter(([x, y]) => x.w1 === y.w1).length;
  const w1 = { n: evPairs.length, agree: w1Agree, rate: evPairs.length ? w1Agree / evPairs.length : null };
  const y = cohenKappa(evPairs.map(([x]) => x.y), evPairs.map(([, b]) => b.y));
  const s = weightedKappa(evPairs.map(([x]) => x.s), evPairs.map(([, b]) => b.s), S_SEVERITY);
  const a = cohenKappa(evPairs.map(([x]) => x.a), evPairs.map(([, b]) => b.a));
  const c = cohenKappa(evPairs.map(([x]) => x.c), evPairs.map(([, b]) => b.c));

  const ok = (r: KappaResult, t: number) => !sameVendor && r.kappa !== null && r.kappa >= t;
  const meetsTargets = {
    h1: ok(h1, AGREEMENT_TARGETS.h1Kappa),
    w1: !sameVendor && w1.rate !== null && w1.rate >= AGREEMENT_TARGETS.w1Agree,
    y: ok(y, AGREEMENT_TARGETS.yKappa),
    s: ok(s, AGREEMENT_TARGETS.sWeightedKappa),
    a: ok(a, AGREEMENT_TARGETS.aKappa),
  };

  const consensus: AgreementReport["consensus"] = [];
  const disputes: Dispute[] = [];
  const vals = (x: string, yv: string) => ({ [p.passId]: x, [q.passId]: yv });
  for (const [x, yl] of pairs) {
    if (x.h1 !== yl.h1) {
      disputes.push({ appId: x.appId, acId: x.acId, field: "h1", values: vals(x.h1, yl.h1), next: "ask_user" });
      continue;
    }
    consensus.push({ appId: x.appId, acId: x.acId, h1: x.h1 });
  }
  for (const [x, yv] of evPairs) {
    for (const f of ["w1", "y", "s", "a"] as const) {
      if (x[f] !== yv[f]) disputes.push({ appId: x.appId, acId: x.acId, field: f, values: vals(String(x[f]), String(yv[f])), next: "third_pass" });
    }
  }
  return {
    passes: [{ passId: p.passId, vendor: p.vendor }, { passId: q.passId, vendor: q.vendor }],
    sameVendor,
    pairedAcs: pairs.length,
    h1, w1, y, s, a, c,
    meetsTargets,
    consensus,
    disputes,
  };
}
