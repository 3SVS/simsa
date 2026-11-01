/**
 * labeler-local.mjs — 라벨링 에이전트 로컬 실측 (train L2, 2026-10-27).
 *
 * 라벨링 설계 §0.0: 라벨러 = Simsa 라벨링 에이전트 — 검수 엔진과 분리된 모드(블라인드·고치기 없음·실패 재현 3회),
 * **서로 다른 벤더 두 패스**, 정확도는 **사전 등록 정답지로만**. 이 하네스는 픽스처 F1~F14(v2-targets.mjs, 정답은 런 전에 기록됨)에
 *   패스 A = OpenAI(기본 gpt-5.6-sol, LABELER_A_MODEL) · 패스 B = Anthropic(기본 claude-opus-5-5, LABELER_B_MODEL, effort high)
 * 를 각각 돌려 ① 패스별 정답지 일치(H1·S, 자격 문턱 §6 [PILOT]) ② 두 패스 일치도(κ, §6) ③ 다툼 목록을 낸다.
 * 검수 엔진 판정은 어디에도 넣지 않는다(블라인드) — 엔진과의 일치율은 정확도가 아니다.
 *
 * 사용: node tools/simsa-inspection-fixtures/labeler-local.mjs [--only=F3,F1] [--passes=A,B] [--steps=24]
 * 필요: OPENAI_API_KEY · ANTHROPIC_API_KEY(없으면 tools/simsa-completion-loop-spike/.env.staff.local에서 읽는다 — 출력하지 않는다)
 *       · playwright(simsa-completion-loop-spike) · central-plane dist 빌드. F9~F14는 FIXTURES_BASE(로컬 wrangler dev)로.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { V2_TARGETS } from "./v2-targets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const cp = join(repo, "apps", "central-plane");
const imp = (rel) => import(pathToFileURL(join(cp, rel)).href);
const { runAgentV2Inspection } = await imp("inspector-container/agent-v2-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");
const { buildV2Report } = await imp("dist/v2-report.js");
const { labelerRowsFromV2Report, refineEventsWithLabeler } = await imp("dist/dataset/labeler.js");
const { comparePasses } = await imp("dist/dataset/agreement.js");
const { scoreAgainstGold } = await imp("dist/dataset/gold.js");
const { appIdFor } = await imp("dist/dataset/record.js");
const { chromium } = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"))("playwright");
const { default: Anthropic } = await import(pathToFileURL(createRequire(join(repo, "packages", "agent-claude", "package.json")).resolve("@anthropic-ai/sdk")).href);

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}
/**
 * 키: 장비 키 파일(.env.staff.local — SIMSA_STAFF_ENV로 경로 지정, worktree에는 없으니) 값이 있으면 그것, 없으면 환경변수.
 * 파일을 먼저 본다 — 셸 환경변수에 남은 옛 키(크레딧 없는 조직)가 새 키를 가리던 일(2026-10-26).
 */
function envFromStaffFile(key) {
  const f = process.env.SIMSA_STAFF_ENV ?? join(here, "..", "simsa-completion-loop-spike", ".env.staff.local");
  const fromFile = existsSync(f) ? new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]+)`, "m").exec(readFileSync(f, "utf8"))?.[1]?.trim() : undefined;
  return fromFile || process.env[key];
}

const PASSES = {
  A: { passId: "A", vendor: "openai", model: process.env.LABELER_A_MODEL ?? "gpt-5.6-sol" },
  B: { passId: "B", vendor: "anthropic", model: process.env.LABELER_B_MODEL ?? "claude-opus-5-5" },
};

function openAiLlm(model, usage) {
  const key = envFromStaffFile("OPENAI_API_KEY");
  return async ({ system, user, maxTokens }) => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_completion_tokens: Math.max(maxTokens ?? 900, 1500), messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`llm ${r.status} ${JSON.stringify(j.error ?? {}).slice(0, 120)}`);
    usage.in += j.usage?.prompt_tokens ?? 0;
    usage.out += j.usage?.completion_tokens ?? 0;
    return j.choices?.[0]?.message?.content ?? "";
  };
}

function anthropicLlm(model, usage) {
  const client = new Anthropic({ apiKey: envFromStaffFile("ANTHROPIC_API_KEY") });
  return async ({ system, user, maxTokens }) => {
    // Opus 5.5: 생각은 늘 켜져 있다(끄면 400) — 깊이는 effort로. 라벨러는 "강한 모델·예산 넉넉"(설계 §0.0) → high.
    // 생각 토큰도 max_tokens에 들어가므로 답 길이보다 넉넉히.
    const msg = await client.messages.create({
      model,
      max_tokens: Math.max((maxTokens ?? 900) * 4, 8000),
      output_config: { effort: "high" },
      system,
      messages: [{ role: "user", content: user }],
    });
    usage.in += msg.usage?.input_tokens ?? 0;
    usage.out += msg.usage?.output_tokens ?? 0;
    if (msg.stop_reason === "refusal") throw new Error("llm refusal");
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  };
}

/**
 * 정답지(사전 등록): v2-targets.mjs의 expected를 라벨 어휘로 옮긴다 — 규칙은 런 전에 여기 고정한다.
 *   broken → fail(S1: 기준 하나뿐이고 그것이 핵심 일) · working → pass · nullOk → cannot_verify도 허용
 *   첫 화면이 안 열리는 픽스처(F9 404 · F14 index 없음) → cannot_verify/app_down도 허용(§2 H2 app_down)
 *   앱 키가 필요한 픽스처(F13) → cannot_verify는 needs_own_api_key일 때만
 *   [개정 2026-11-02 Bae 결정] F5(빈 화면)도 첫 화면 고장과 같은 규칙 — fail·cannot_verify/app_down 둘 다 정답.
 *     사후 개정이므로 결과 문서에 개정 전(13/14)·후 기록을 함께 남긴다.
 */
const ENTRY_FIXTURES = new Set(["F5", "F9", "F14"]);
function goldFor(t) {
  const base = { appKey: t.id, acId: "CORE-1", source: "tools/simsa-inspection-fixtures/v2-targets.mjs (expected, 2026-10-21 이전 기록)" };
  if (t.expected === "broken") {
    if (ENTRY_FIXTURES.has(t.id)) return { ...base, h1: ["fail", "cannot_verify"], h2: ["app_down"], s: "S1" };
    if (t.id === "F13") return { ...base, h1: ["fail", "cannot_verify"], h2: ["needs_own_api_key"], s: "S1" };
    return { ...base, h1: t.nullOk ? ["fail", "cannot_verify"] : ["fail"], s: "S1" };
  }
  return { ...base, h1: t.nullOk ? ["pass", "cannot_verify"] : ["pass"] };
}

const only = arg("only", "").split(",").filter(Boolean);
const passIds = arg("passes", "A,B").split(",").filter((p) => PASSES[p]);
const steps = Number(arg("steps", "24"));
const targets = only.length ? V2_TARGETS.filter((t) => only.includes(t.id)) : V2_TARGETS;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const kstStart = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
console.log(`labeler-local KST ${kstStart} · passes ${passIds.map((p) => `${p}=${PASSES[p].vendor}:${PASSES[p].model}`).join(" ")} · targets ${targets.map((t) => t.id).join(",")}`);

const perPass = {};
const runs = [];
for (const pid of passIds) {
  const pass = PASSES[pid];
  perPass[pid] = { passId: pid, vendor: pass.vendor, acLabels: [], failureEvents: [], gold: [] };
  for (const t of targets) {
    const usage = { in: 0, out: 0 };
    const llm = pass.vendor === "anthropic" ? anthropicLlm(pass.model, usage) : openAiLlm(pass.model, usage);
    const outDir = mkdtempSync(join(tmpdir(), `lab-${pid}-${t.id}-`));
    const ac = { id: "CORE-1", title: t.intent, given: "앱을 처음 연다", when: "앱의 핵심 일을 처음부터 끝까지 해 본다", then: t.intent, priority: "must", confirmed: true };
    const started = Date.now();
    const phases = [];
    let driver = null;
    let row;
    try {
      driver = await createPlaywrightDriver({ outDir, locale: "ko", isNoiseResource, chromium });
      const r = await runAgentV2Inspection({
        targetUrl: t.url, intent: t.intent, locale: "ko", acs: [ac], llm, driver, profile: "labeler", reproRuns: 3,
        budgetMs: 9 * 60_000, maxStepsPerAc: steps, testDataSeed: 4242, onPhase: (l) => phases.push(l),
      });
      const report = buildV2Report(r, { targetUrl: t.url, intent: t.intent, acs: [ac], acSource: "confirmed_inferred" }).report;
      const runId = `lab_${stamp}_${pid}_${t.id}`;
      const appId = await appIdFor(t.url);
      const rows = labelerRowsFromV2Report(report, { runId, appId, createdAt: new Date().toISOString(), acs: [ac] }, pass);
      const refined = await refineEventsWithLabeler(rows.failureEvents, report, [ac], llm);
      perPass[pid].acLabels.push(...rows.acLabels);
      perPass[pid].failureEvents.push(...refined.events);
      const label = rows.acLabels.find((l) => l.acId === "CORE-1") ?? null;
      perPass[pid].gold.push({ gold: goldFor(t), label, events: refined.events });
      const v = r.verdicts?.[0];
      row = {
        pass: pid, id: t.id, expected: t.expected, h1: label?.h1 ?? null, h2: label?.h2 ?? null, h3: label?.h3 ?? null,
        verdict: v?.verdict ?? (r.entry?.broken ? "entry_broken" : null), reasons: v?.reasons ?? [], repro: v?.repro ?? null,
        event: refined.events[0] ? { w1: refined.events[0].w1, y: refined.events[0].y, c: refined.events[0].c, k: refined.events[0].k, s: refined.events[0].s, r: refined.events[0].r, a: refined.events[0].a, p: refined.events[0].p, memo: refined.events[0].memo } : null,
        claim: v?.claim ?? null, llmCalls: (r.llmCalls?.n ?? 0) + refined.calls, tokens: usage, seconds: Math.round((Date.now() - started) / 1000), phases,
      };
    } catch (err) {
      await driver?.close?.().catch(() => {});
      perPass[pid].gold.push({ gold: goldFor(t), label: null, events: [] });
      row = { pass: pid, id: t.id, expected: t.expected, error: String(err?.message ?? err).slice(0, 200), tokens: usage, phases };
    }
    runs.push(row);
    console.log(`${pid} ${t.id} expected=${t.expected} h1=${row.h1 ?? "ERR"}${row.h2 ? `(${row.h2})` : ""} repro=${row.repro ? `${row.repro.k}/${row.repro.n}` : "-"} ev=${row.event ? `${row.event.w1}/${row.event.y}/${row.event.s}/${row.event.c}` : "-"} tokens=${usage.in}/${usage.out} ${row.seconds ?? "?"}s ${row.error ?? ""}`);
  }
}

const gold = Object.fromEntries(Object.entries(perPass).map(([pid, p]) => [pid, scoreAgainstGold(p.gold)]));
const agreement = passIds.length >= 2 && perPass.A && perPass.B ? comparePasses(perPass.A, perPass.B) : null;
const summary = {
  gold: Object.fromEntries(Object.entries(gold).map(([pid, g]) => [pid, { n: g.n, h1Rate: g.h1Rate, sRate: g.sRate, falsePass: g.falsePass, falseFail: g.falseFail, gate: g.gate }])),
  agreement: agreement ? { pairedAcs: agreement.pairedAcs, h1Kappa: agreement.h1.kappa, h1Po: agreement.h1.po, w1: agreement.w1, sKappa: agreement.s.kappa, yKappa: agreement.y.kappa, aKappa: agreement.a.kappa, meetsTargets: agreement.meetsTargets, disputes: agreement.disputes.length } : null,
  tokens: Object.fromEntries(passIds.map((pid) => [pid, runs.filter((r) => r.pass === pid).reduce((s, r) => ({ in: s.in + (r.tokens?.in ?? 0), out: s.out + (r.tokens?.out ?? 0) }), { in: 0, out: 0 })])),
  errors: runs.filter((r) => r.error).length,
};
const file = join(here, `labeler-local-result-${stamp}.json`);
writeFileSync(file, JSON.stringify({ label: "라벨링 에이전트 로컬 실측(train L2) — 픽스처 정답지 대조 · 두 벤더 패스 일치도", kstStart, passes: passIds.map((p) => PASSES[p]), steps, summary, gold, agreement, runs, perPass }, null, 1));
console.log(JSON.stringify(summary), "→", file);
process.exit(0);
