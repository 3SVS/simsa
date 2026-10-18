/**
 * agent-bench-aggregate.mjs — 벤치 하네스(로컬 agent-bench1-local.mjs · 프로덕션 agent-bench1.mjs) 공용 순수 집계.
 * 순수 함수만(파일·네트워크 없음). 테스트: apps/central-plane/test/agent-bench-aggregate.test.mjs.
 *
 * (H4) summarize/aggregate — 런 하나의 지표, 여러 런의 평균·최소·최대.
 * (2026-10-18 HANDOFF §3-3) compareRuns — "3회 판정 동일"을 두 층으로 센다:
 *   ① 질문 동일성: 같은 앱의 AC 목록(id·제목·then·순서)이 런마다 같은가
 *   ② 판정 동일성: 같은 AC의 판정(status)이 런마다 같은가 — ①이 깨진 앱은 id가 전 런에 있는 AC만 비교하고 나머지는 '비교 불가'
 */

/** 런 하나의 비용 — 프로덕션 결과는 숫자(costUsd), 로컬 결과는 {generation, agent}. */
export function costOfResult(r) {
  const c = r?.costUsd;
  if (typeof c === "number") return c;
  if (c && typeof c === "object") return (Number(c.generation) || 0) + (Number(c.agent) || 0);
  return null;
}

/** 런 하나의 지표(사전 등록 기준과 같은 셈). */
export function summarize(apps, results) {
  const scored = results.filter((r) => r.decision);
  const totalMust = apps.reduce((s, a) => s + a.mustFailed.length, 0);
  const costs = results.map(costOfResult).filter((c) => typeof c === "number");
  return {
    oppositeErrors: scored.filter((r) => r.opposite).length,
    appMatch: scored.filter((r) => r.match).length,
    apps: apps.length,
    mustIdentified: results.reduce((s, r) => s + (r.mustIdentified?.length ?? 0), 0),
    mustTotal: totalMust,
    costPerRunMean: costs.length ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)) : null,
    costPerRunMax: costs.length ? Math.max(...costs) : null,
    errors: results.filter((r) => r.error).length,
  };
}

/** 여러 런의 평균·최소·최대. */
export function aggregate(runs) {
  const keys = ["oppositeErrors", "appMatch", "mustIdentified", "costPerRunMean", "costPerRunMax", "errors"];
  const out = {};
  for (const k of keys) {
    const v = runs.map((r) => r[k]).filter((x) => typeof x === "number");
    out[k] = v.length ? { mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)), min: Math.min(...v), max: Math.max(...v) } : null;
  }
  out.runs = runs.length;
  return out;
}

const acKey = (x) => `${x.id}\u0000${x.title ?? ""}\u0000${x.then ?? ""}`;
const allSame = (xs) => xs.every((x) => x === xs[0]);

/**
 * 여러 런의 전체 결과를 앱·AC 단위로 맞대어 본다.
 * @param {Array<{results: Array<{app:string, decision?:string, error?:string, acTable?: Array<{id:string,title?:string,then?:string,status?:string}>}>}>} runs
 */
export function compareRuns(runs) {
  const appIds = [];
  for (const run of runs) for (const r of run.results ?? []) if (r?.app && !appIds.includes(r.app)) appIds.push(r.app);
  const apps = [];
  const rows = [];
  let acCellsCompared = 0;
  let acCellsDisagreeing = 0;
  let acCellsIncomparable = 0;
  for (const app of appIds) {
    const per = runs.map((run) => (run.results ?? []).find((r) => r?.app === app) ?? null);
    const lists = per.map((r) => (Array.isArray(r?.acTable) ? r.acTable.map((x) => ({ id: x.id, title: x.title ?? "", then: x.then ?? "" })) : null));
    const questionIdentical = lists.every((l) => l !== null) && allSame(lists.map((l) => JSON.stringify(l.map(acKey))));
    const decisions = per.map((r) => r?.decision ?? (r?.error ? `error:${String(r.error).slice(0, 40)}` : null));
    const decisionIdentical = allSame(decisions);
    // AC 비교 — 질문이 같으면 자리마다, 다르면 id가 모든 런에 있는 것만.
    const idsInAll = lists.every((l) => l !== null)
      ? lists[0].map((x) => x.id).filter((id) => lists.every((l) => l.some((x) => x.id === id)))
      : [];
    const idsAny = [...new Set(lists.flatMap((l) => (l ?? []).map((x) => x.id)))];
    const acs = [];
    for (const id of idsAny) {
      const comparable = idsInAll.includes(id);
      const statuses = per.map((r) => (Array.isArray(r?.acTable) ? (r.acTable.find((x) => x.id === id)?.status ?? null) : null));
      const title = lists.map((l) => l?.find((x) => x.id === id)?.title).find(Boolean) ?? "";
      const identical = comparable ? allSame(statuses) : null;
      if (comparable) {
        acCellsCompared += 1;
        if (!identical) acCellsDisagreeing += 1;
      } else acCellsIncomparable += 1;
      const row = { app, acId: id, title, comparable, statuses, identical };
      acs.push(row);
      rows.push(row);
    }
    apps.push({ app, questionIdentical, acCounts: lists.map((l) => l?.length ?? null), decisions, decisionIdentical, acs });
  }
  return {
    runs: runs.length,
    apps,
    rows,
    totals: {
      appsQuestionIdentical: apps.filter((a) => a.questionIdentical).length,
      appsDecisionIdentical: apps.filter((a) => a.decisionIdentical).length,
      apps: apps.length,
      acCellsCompared,
      acCellsDisagreeing,
      acCellsIncomparable,
    },
  };
}
