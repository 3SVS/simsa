#!/usr/bin/env node
/**
 * agent-v2-bench1-local.mjs — 검사 엔진 v2 S7: 벤치마크 #1(동네 미용실 6앱)을 **v2 실행기**로 로컬에서 잰다 (2026-10-23).
 *
 * 같은 대상·같은 질문·같은 정답지: agent-bench1-local.mjs의 APPS(사전 등록 정답지 must 실패 13칸) · BENCH1_PREREG_ACS(A1~A10 주입) ·
 * BENCH1_INTENT를 그대로 가져온다(정답지를 이 파일에서 고치지 않는다).
 * 모델: 로컬엔 Anthropic 키가 없어 OpenAI(기본 gpt-5.6-sol, V2_MODEL)로 직접 부른다 — 프로덕션 V-5 후보와 다르다(결과에 기록).
 * 채점(설계 §4 G1, 칸 단위):
 *   - 짚음 = 정답지 must 실패 칸에서 v2가 fail(검증·재실행 확인 통과) — 원인 분류(cause)도 함께 적는다
 *   - 반대 = 정답지 must 실패 칸을 pass로 판정(0이어야 한다)
 *   - 없는 결함 = 정답지 ✅ 칸을 fail로 판정. 같은 결함 묶음(defectGroups)에 짚음 칸이 있으면 "파생"으로 따로 센다(S5c 첫 지점 규칙)
 *   - 앱 결정 = expected(broken → Needs Fix · broken_or_hold → Needs Fix/Not Verified · works → Ready/Not Verified)
 * 사용: node tools/simsa-inspection-fixtures/agent-v2-bench1-local.mjs [--only=claude,gemini] [--concurrency=2] [--repeat=1]
 * 결과: tools/simsa-inspection-fixtures/agent-v2-bench1-result-<시각>-r<k>.json
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APPS, BENCH1_PREREG_ACS, BENCH1_INTENT } from "./agent-bench1-local.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cp = join(here, "..", "..", "apps", "central-plane");
const imp = (rel) => import(pathToFileURL(join(cp, rel)).href);
const { runAgentV2Inspection } = await imp("inspector-container/agent-v2-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");
const { chromium } = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"))("playwright");

const MODEL = process.env.V2_MODEL ?? "gpt-5.6-sol";
const MUST = BENCH1_PREREG_ACS.filter((a) => a.priority === "must").map((a) => a.id);

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}

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

/** 앱 하나의 칸 채점(정답지 대조). */
export function scoreApp(app, r) {
  const byAc = new Map((r.verdicts ?? []).map((v) => [v.acId, v]));
  const keyFail = new Set(app.mustFailed);
  const hits = [];
  const misses = [];
  const opposite = [];
  const extra = [];
  const derived = [];
  for (const id of MUST) {
    const v = byAc.get(id);
    const said = v?.verdict ?? "missing";
    if (keyFail.has(id)) {
      if (said === "fail" || said === "mismatch") hits.push({ acId: id, cause: v.cause?.cls ?? null, basis: v.cause?.basis ?? null });
      else if (said === "pass") opposite.push(id);
      else misses.push({ acId: id, verdict: said, reasons: v?.reasons ?? [] });
    } else if (said === "fail" || said === "mismatch") {
      const group = (r.defectGroups ?? []).find((g) => g.acIds.includes(id));
      const sharesWithHit = group && group.acIds.some((x) => keyFail.has(x));
      (sharesWithHit ? derived : extra).push({ acId: id, cause: v.cause?.cls ?? null, claim: v.claim });
    }
  }
  const okDecision =
    app.expected === "broken" ? r.decision === "Needs Fix"
      : app.expected === "broken_or_hold" ? r.decision === "Needs Fix" || r.decision === "Not Verified"
        : r.decision === "Ready" || r.decision === "Not Verified";
  return { hits, misses, opposite, extra, derived, okDecision };
}

const only = arg("only", "").split(",").filter(Boolean);
const concurrency = Math.max(1, Number(arg("concurrency", "2")));
const repeat = Math.max(1, Number(arg("repeat", "1")));
const apps = only.length ? APPS.filter((a) => only.includes(a.id)) : APPS;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

async function runApp(app) {
  const usage = { calls: 0, in: 0, out: 0 };
  const outDir = mkdtempSync(join(tmpdir(), `v2b-${app.id}-`));
  const phases = [];
  const started = Date.now();
  let driver = null;
  try {
    driver = await createPlaywrightDriver({ outDir, locale: "ko", isNoiseResource, chromium });
    const r = await runAgentV2Inspection({
      targetUrl: app.url, intent: BENCH1_INTENT, locale: "ko", acs: BENCH1_PREREG_ACS, llm: openAiLlm(usage), driver,
      budgetMs: 20 * 60_000, testDataSeed: 4242, onPhase: (l) => phases.push(l),
    });
    const score = scoreApp(app, r);
    return {
      id: app.id, expected: app.expected, keyMustFailed: app.mustFailed, decision: r.decision, ...score,
      verdicts: r.verdicts.map((v) => ({ acId: v.acId, verdict: v.verdict, originalVerdict: v.originalVerdict, confirmed: v.confirmed, reasons: v.reasons, claim: v.claim, quotes: v.quotes, cause: v.cause })),
      facts: (r.facts ?? []).map((f) => `${f.rule}:${f.cls}`), hypotheses: (r.plan?.hypotheses ?? []).map((h) => `${h.id}:${h.cls}`),
      defectGroups: r.defectGroups ?? [], intentMismatch: r.intentMismatch ?? [], entry: r.entry?.broken ?? null,
      fix: r.fix ? { attempted: r.fix.attempted, reason: r.fix.reason, error: r.fix.error, validated: r.fix.validated, stillFailing: r.fix.stillFailing, cannotFix: r.fix.cannotFix, diff: r.fix.diff } : null,
      usage, seconds: Math.round((Date.now() - started) / 1000), phases,
    };
  } catch (err) {
    return { id: app.id, error: String(err?.message ?? err).slice(0, 300), usage, phases };
  } finally {
    await driver?.close().catch(() => {});
    rmSync(outDir, { recursive: true, force: true });
  }
}

for (let k = 1; k <= repeat; k += 1) {
  const kstStart = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const queue = [...apps];
  const rows = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let app = queue.shift(); app; app = queue.shift()) {
        const row = await runApp(app);
        rows.push(row);
        console.log(
          `r${k} ${row.id} decision=${row.decision ?? "ERR"}${row.okDecision === false ? "(×)" : ""} hits=${(row.hits ?? []).map((h) => `${h.acId}:${h.cause}`).join(",") || "-"} ` +
            `miss=${(row.misses ?? []).map((m) => `${m.acId}:${m.verdict}`).join(",") || "-"} opposite=${(row.opposite ?? []).join(",") || "-"} ` +
            `extra=${(row.extra ?? []).map((e) => e.acId).join(",") || "-"} derived=${(row.derived ?? []).map((e) => e.acId).join(",") || "-"} ` +
            `fix=${row.fix ? (row.fix.attempted ? `v${(row.fix.validated ?? []).length}${row.fix.reason ? `/${row.fix.reason}` : ""}` : row.fix.reason) : "-"} ` +
            `calls=${row.usage.calls} tok=${row.usage.in}/${row.usage.out} ${row.seconds ?? "?"}s ${row.error ?? ""}`,
        );
      }
    }),
  );
  rows.sort((a, b) => apps.findIndex((x) => x.id === a.id) - apps.findIndex((x) => x.id === b.id));
  const totalKeyCells = apps.reduce((n, a) => n + a.mustFailed.length, 0);
  const summary = {
    keyCells: totalKeyCells,
    hits: rows.reduce((n, r) => n + (r.hits?.length ?? 0), 0),
    opposite: rows.reduce((n, r) => n + (r.opposite?.length ?? 0), 0),
    extra: rows.reduce((n, r) => n + (r.extra?.length ?? 0), 0),
    derived: rows.reduce((n, r) => n + (r.derived?.length ?? 0), 0),
    decisionsOk: rows.filter((r) => r.okDecision).length,
    errors: rows.filter((r) => r.error).length,
    tokens: rows.reduce((s, r) => ({ in: s.in + (r.usage?.in ?? 0), out: s.out + (r.usage?.out ?? 0) }), { in: 0, out: 0 }),
  };
  const file = join(here, `agent-v2-bench1-result-${stamp}-r${k}.json`);
  writeFileSync(file, JSON.stringify({ label: `v2 벤치 #1 로컬(브랜치 코드) — 모델 ${MODEL}(OpenAI 직접, 프로덕션 V-5 후보 아님) · A1~A10 주입`, kstStart, model: MODEL, summary, rows }, null, 1));
  console.log(`r${k}`, JSON.stringify(summary), "→", file);
}
process.exit(0);
