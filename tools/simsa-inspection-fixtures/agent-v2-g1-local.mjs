#!/usr/bin/env node
/**
 * agent-v2-g1-local.mjs — 검사 엔진 v2 G1 로컬 측정: 미용실 6 + 파일럿 6(v0 제외) = 12앱 × N회 (2026-11-15).
 *
 * 대상·기준·정답 칸: g1-sets.mjs(근거 docs/pilot-2026-10/g1-prereg-2026-11-15.md). 채점: g1-score.mjs(순수, 테스트 있음).
 * 실행기: inspector-container/agent-v2-run.mjs(브랜치 코드) + 로컬 Playwright. 기준은 사전 등록 AC를 주입한다(묶음별).
 * 모델: OpenAI 직접(V2_MODEL, 기본 gpt-5.6-sol — 10-23 벤치 #1 v2와 같은 조건). 결과 파일에 모델을 적는다.
 * 비용 가드: 토큰을 보수 단가(입력 $5 · 출력 $25 /1M — llm-pricing CONSERVATIVE와 같은 값)로 합산해 --max-usd(기본 80)를
 *            넘으면 **새 앱을 시작하지 않고** 멈춘다(돌던 앱은 끝낸다). 결과에 stoppedByBudget 기록.
 * 시간: 실앱 측정은 KST 10~17시만(운영 규칙). 창 밖이면 시작하지 않는다(--force-window로만 무시, 기록됨).
 *
 * 사용: node tools/simsa-inspection-fixtures/agent-v2-g1-local.mjs [--sets=bench1,pilot1] [--only=s-claude,p-bolt]
 *        [--concurrency=3] [--repeat=3] [--max-usd=80] [--dry]
 *   --dry: LLM·브라우저 없이 대상·칸·분모만 출력(비용 0).
 * 필요: OPENAI_API_KEY(출력·기록 금지), apps/central-plane 빌드(dist), tools/simsa-completion-loop-spike의 playwright.
 * 결과: tools/simsa-inspection-fixtures/agent-v2-g1-result-<시각>-r<k>.json (+ 회차 합계 -aggregate.json)
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreG1App, summarizeG1 } from "./g1-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const flag = (name) => process.argv.includes(`--${name}`);

const MODEL = process.env.V2_MODEL ?? "gpt-5.6-sol";
const PRICE_IN = 5;
const PRICE_OUT = 25;
const usd = (u) => (u.in * PRICE_IN + u.out * PRICE_OUT) / 1_000_000;
const kstHour = () => Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }));
const kstNow = () => new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

const { G1_SETS } = await import("./g1-sets.mjs");
const setIds = arg("sets", "bench1,pilot1").split(",").filter(Boolean);
const only = arg("only", "").split(",").filter(Boolean);
const targets = G1_SETS.filter((s) => setIds.includes(s.id)).flatMap((s) =>
  s.apps.filter((a) => !only.length || only.includes(a.id)).map((app) => ({ set: s, app, mustIds: s.acs.filter((a) => a.priority === "must").map((a) => a.id) })),
);

if (flag("dry")) {
  for (const t of targets) {
    const cells = t.app.entryBroken ? ["ENTRY"] : t.app.mustFailed;
    console.log(`${t.set.id.padEnd(7)} ${t.app.id.padEnd(11)} 기대=${t.app.expected.padEnd(15)} 칸=${cells.join(",") || "-"}${t.app.timeDependent ? " (새벽 전용)" : ""}${t.app.mismatch ? ` 의도불일치=${t.app.mismatch.join(",")}` : ""}${t.app.baeCheck ? " [Bae 확인]" : ""}`);
  }
  const day = targets.reduce((n, t) => n + (t.app.entryBroken ? 1 : t.app.timeDependent ? 0 : t.app.mustFailed.length), 0);
  console.log(`앱 ${targets.length} · 낮 실행 분모 ${day}칸`);
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY가 셸 환경에 없습니다 — 측정하지 않고 멈춥니다.");
  process.exit(2);
}
const h = kstHour();
if ((h < 10 || h >= 17) && !flag("force-window")) {
  console.error(`지금 KST ${h}시 — 실앱 측정 창(10~17시) 밖이라 시작하지 않습니다(${kstNow()}).`);
  process.exit(3);
}

const cp = join(here, "..", "..", "apps", "central-plane");
const imp = (rel) => import(pathToFileURL(join(cp, rel)).href);
const { runAgentV2Inspection } = await imp("inspector-container/agent-v2-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");
const { chromium } = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"))("playwright");

function openAiLlm(usage) {
  return async ({ system, user, maxTokens }) => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_completion_tokens: Math.max(maxTokens ?? 900, 1500), messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`llm ${r.status} ${JSON.stringify(j.error ?? {}).slice(0, 120)}`);
    usage.calls += 1;
    usage.in += j.usage?.prompt_tokens ?? 0;
    usage.out += j.usage?.completion_tokens ?? 0;
    return j.choices?.[0]?.message?.content ?? "";
  };
}

async function runOne({ set, app, mustIds }) {
  const usage = { calls: 0, in: 0, out: 0 };
  const outDir = mkdtempSync(join(tmpdir(), `g1-${app.id}-`));
  const phases = [];
  const started = Date.now();
  const startedKst = kstNow();
  let driver = null;
  try {
    driver = await createPlaywrightDriver({ outDir, locale: "ko", isNoiseResource, chromium });
    const r = await runAgentV2Inspection({
      targetUrl: app.url, intent: set.intent, locale: "ko", acs: set.acs, llm: openAiLlm(usage), driver,
      budgetMs: 20 * 60_000, testDataSeed: 4242, onPhase: (l) => phases.push(l),
    });
    const score = scoreG1App(app, mustIds, r, kstHour());
    return {
      set: set.id, id: app.id, url: app.url, expected: app.expected, startedKst, decision: r.decision, score,
      verdicts: (r.verdicts ?? []).map((v) => ({ acId: v.acId, verdict: v.verdict, originalVerdict: v.originalVerdict, confirmed: v.confirmed, reasons: v.reasons, claim: v.claim, quotes: v.quotes, cause: v.cause })),
      entry: r.entry?.broken ?? null, defectGroups: r.defectGroups ?? [], intentMismatch: r.intentMismatch ?? [],
      fix: r.fix ? { attempted: r.fix.attempted, reason: r.fix.reason, error: r.fix.error, validated: r.fix.validated, stillFailing: r.fix.stillFailing, cannotFix: r.fix.cannotFix } : null,
      usage, usd: Number(usd(usage).toFixed(4)), seconds: Math.round((Date.now() - started) / 1000), phasesTail: phases.slice(-8),
    };
  } catch (err) {
    return { set: set.id, id: app.id, url: app.url, startedKst, error: String(err?.message ?? err).slice(0, 300), usage, usd: Number(usd(usage).toFixed(4)), phasesTail: phases.slice(-8) };
  } finally {
    await driver?.close().catch(() => {});
    rmSync(outDir, { recursive: true, force: true });
  }
}

const concurrency = Math.max(1, Number(arg("concurrency", "3")));
const repeat = Math.max(1, Number(arg("repeat", "3")));
const maxUsd = Number(arg("max-usd", "80"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let spent = 0;
let stoppedByBudget = false;
const perRun = [];

for (let k = 1; k <= repeat && !stoppedByBudget; k += 1) {
  const kstStart = kstNow();
  const queue = [...targets];
  const rows = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        if (spent >= maxUsd) {
          stoppedByBudget = true;
          rows.push({ set: t.set.id, id: t.app.id, error: "skipped_budget" });
          continue;
        }
        const row = await runOne(t);
        spent += row.usd ?? 0;
        rows.push(row);
        const s = row.score;
        console.log(
          `r${k} ${row.id} ${row.decision ?? "ERR"}${s && !s.okDecision ? "(×)" : ""} ` +
            `짚음=${s ? s.hits.map((x) => `${x.acId}:${x.cause ?? "-"}`).join(",") || "-" : "-"} 놓침=${s ? s.misses.map((m) => `${m.acId}:${m.verdict}`).join(",") || "-" : "-"} ` +
            `반대=${s?.opposite.join(",") || "-"} 없는결함=${s?.extra.map((e) => e.acId).join(",") || "-"} ` +
            `$${row.usd} 누적$${spent.toFixed(2)} ${row.seconds ?? "?"}s ${row.error ?? ""}`,
        );
      }
    }),
  );
  const order = targets.map((t) => t.app.id);
  rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const summary = { all: summarizeG1(rows), bySet: Object.fromEntries(setIds.map((id) => [id, summarizeG1(rows.filter((r) => r.set === id))])) };
  const runUsd = Number(rows.reduce((n, r) => n + (r.usd ?? 0), 0).toFixed(4));
  perRun.push({ k, kstStart, summary: summary.all, usd: runUsd });
  const file = join(here, `agent-v2-g1-result-${stamp}-r${k}.json`);
  writeFileSync(file, JSON.stringify({ label: `v2 G1 로컬(브랜치 코드) — 모델 ${MODEL}(OpenAI 직접) · 사전 등록 AC 주입 · 보수 단가`, kstStart, kstEnd: kstNow(), model: MODEL, usd: runUsd, stoppedByBudget, summary, rows }, null, 1));
  console.log(`r${k}`, JSON.stringify(summary.all), "→", file);
}

const agg = {
  model: MODEL, runs: perRun.length, spentUsd: Number(spent.toFixed(4)), maxUsd, stoppedByBudget,
  mean: perRun.length
    ? Object.fromEntries(["hitPct", "mismatchPct", "opposite", "extra", "citedPct", "decisionsOk", "errors"].map((key) => [key, Math.round((perRun.reduce((n, r) => n + (r.summary[key] ?? 0), 0) / perRun.length) * 10) / 10]))
    : null,
  gatePassAllRuns: perRun.length > 0 && perRun.every((r) => r.summary.gate.pass),
  perRun,
};
writeFileSync(join(here, `agent-v2-g1-aggregate-${stamp}.json`), JSON.stringify(agg, null, 1));
console.log("합계", JSON.stringify(agg));
process.exit(0);
