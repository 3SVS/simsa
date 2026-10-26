/**
 * dataset/gold.ts — 라벨링 에이전트 정확도 = 사전 등록 정답지 대조 (train L2, 2026-10-27).
 *
 * 설계 §0.0 [LOCKED 완화 규칙]: 라벨링 에이전트의 정확도는 **런 전에 기록된 정답지로만** 잰다(검수 엔진과의 일치율은 정확도가
 * 아니다). §6 [PILOT]: 캘리브레이션에서 H1 일치 ≥ 90% · S 일치 ≥ 80%인 라벨러 버전만 실데이터에 쓴다.
 * 정답 하나가 여러 답을 허용할 수 있다(예: 앱 키가 필요한 앱 = fail 또는 cannot_verify/needs_own_api_key) — 정답지에 적힌 그대로.
 */
import type { AcLabel, FailureEvent } from "./labels.js";

/** [PILOT] 설계 §6 라벨러 자격 문턱. */
export const GOLD_GATE = Object.freeze({ h1: 0.9, s: 0.8 });

export interface GoldAc {
  /** 정답지 안의 앱 표지(예 F3, bench1:claude) */
  appKey: string;
  acId: string;
  /** 허용 판정들 */
  h1: ReadonlyArray<AcLabel["h1"]>;
  /** h1이 cannot_verify일 때 허용 사유(없으면 사유는 보지 않는다) */
  h2?: ReadonlyArray<NonNullable<AcLabel["h2"]>>;
  /** fail일 때의 심각도 정답(없으면 S는 채점하지 않는다) */
  s?: FailureEvent["s"];
  /** 정답지 출처(파일·기록 시각) — 사전 등록 증명 */
  source: string;
}

export interface GoldItem {
  gold: GoldAc;
  /** 라벨러가 이 기준에 단 라벨(못 달았으면 null — 오답으로 센다) */
  label: AcLabel | null;
  events: FailureEvent[];
}

export interface GoldScore {
  n: number;
  h1Correct: number;
  h1Rate: number | null;
  sN: number;
  sCorrect: number;
  sRate: number | null;
  /** 정답 fail을 pass로 본 것 — 가장 위험한 오답(거짓 통과) */
  falsePass: number;
  /** 정답 pass를 fail로 본 것 */
  falseFail: number;
  gate: { h1: boolean; s: boolean; pass: boolean };
  misses: Array<{ appKey: string; acId: string; expected: string; got: string; field: "h1" | "s" }>;
}

export function scoreAgainstGold(items: readonly GoldItem[]): GoldScore {
  let h1Correct = 0;
  let sN = 0;
  let sCorrect = 0;
  let falsePass = 0;
  let falseFail = 0;
  const misses: GoldScore["misses"] = [];
  for (const { gold, label, events } of items) {
    const got = label?.h1 ?? "none";
    const h1ok =
      label !== null &&
      gold.h1.includes(label.h1) &&
      (label.h1 !== "cannot_verify" || !gold.h2 || (label.h2 !== null && gold.h2.includes(label.h2)));
    if (h1ok) h1Correct += 1;
    else misses.push({ appKey: gold.appKey, acId: gold.acId, expected: gold.h1.join("|") + (gold.h2 ? `(${gold.h2.join("|")})` : ""), got: label?.h1 === "cannot_verify" ? `cannot_verify(${label.h2 ?? "-"})` : got, field: "h1" });
    if (label?.h1 === "pass" && !gold.h1.includes("pass") && gold.h1.includes("fail")) falsePass += 1;
    if (label?.h1 === "fail" && !gold.h1.includes("fail") && gold.h1.includes("pass")) falseFail += 1;
    if (gold.s && label?.h1 === "fail") {
      const e = events.find((x) => x.acId === gold.acId) ?? events[0];
      sN += 1;
      if (e?.s === gold.s) sCorrect += 1;
      else misses.push({ appKey: gold.appKey, acId: gold.acId, expected: gold.s, got: e?.s ?? "none", field: "s" });
    }
  }
  const n = items.length;
  const h1Rate = n ? h1Correct / n : null;
  const sRate = sN ? sCorrect / sN : null;
  const gate = { h1: h1Rate !== null && h1Rate >= GOLD_GATE.h1, s: sRate === null || sRate >= GOLD_GATE.s, pass: false };
  // 거짓 통과가 하나라도 있으면 자격 없음 — 지수 발표 문턱과 같은 원칙(반대 판정 0, 설계 §7).
  gate.pass = gate.h1 && gate.s && falsePass === 0 && n > 0;
  return { n, h1Correct, h1Rate, sN, sCorrect, sRate, falsePass, falseFail, gate, misses };
}
