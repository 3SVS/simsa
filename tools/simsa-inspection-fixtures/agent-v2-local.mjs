#!/usr/bin/env node
/**
 * agent-v2-local.mjs — 검사 엔진 v2를 **프로덕션과 같은 구성**으로 로컬에서 돌린다(설계 §4 측정 장비 규칙).
 *
 *   같은 것: 실행기(inspector-container/agent-v2-run.mjs) · 드라이버(agent-driver.mjs, 실 Chromium) · 순수 규칙(dist/agent-v2.js) ·
 *            요청 본문(buildV2ResponsesBody) · 모델/추론 강도(inspectAgentV2Model/Effort — 같은 env 규칙) · 도구 상한(AGENT_V2_CAPS) ·
 *            런 예산(v2RunBudgetUsd — 넘으면 budget_exhausted, 프로덕션 402와 같게) · 단가(priceTokens).
 *   다른 것: Worker 프록시 대신 OpenAI Responses 직행(셸의 OPENAI_API_KEY — 출력·기록하지 않는다).
 *
 * 키: 셸 → 없으면 tools/simsa-completion-loop-spike/.env.staff.local(gitignore). 주 모델이 Claude인데 키가 없으면 멈춘다.
 * 사용(스모크): node tools/simsa-inspection-fixtures/agent-v2-local.mjs --fixtures=working-todo,potemkin-crm,optimistic-ghost
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CP = join(here, "..", "..", "apps", "central-plane");
const imp = (p) => import(pathToFileURL(join(CP, p)).href);

const v2 = await imp("dist/agent-v2.js");
const { inspectAgentV2Route, inspectAgentV2Effort } = await imp("dist/workspace/inspection-agent.js");
const { priceTokens } = await imp("dist/workspace/llm-pricing.js");
const { AGENT_V2_CAPS } = await imp("dist/routes/workspace-visual-check-runs.js");
const { runAgentV2 } = await imp("inspector-container/agent-v2-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");

const require = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"));
const { chromium } = require("playwright");

const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";

/** 키 파일: 셸에 없으면 tools/simsa-completion-loop-spike/.env.staff.local(gitignore)에서 읽는다 — 값은 출력하지 않는다. */
function loadLocalEnv() {
  // 워크트리에는 gitignore 파일이 없다 — SIMSA_STAFF_ENV_FILE로 본 체크아웃의 파일을 가리킬 수 있다.
  const file = [process.env.SIMSA_STAFF_ENV_FILE, join(here, "..", "simsa-completion-loop-spike", ".env.staff.local")].find((f) => f && existsSync(f));
  if (!file) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (!["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "V2_TEST_USERNAME", "V2_TEST_PASSWORD", "V2_TEST_LOGIN_URL", "INSPECT_AGENT_V2_MODEL", "INSPECT_AGENT_V2_FALLBACK_MODEL", "INSPECT_AGENT_V2_ANTHROPIC"].includes(k)) continue;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();
// 로컬 하네스는 프로덕션 wrangler.toml과 같게 v2 전용 Anthropic 스위치를 켠다(키가 있을 때만 실제로 쓰인다).
if (!process.env.INSPECT_AGENT_V2_ANTHROPIC) process.env.INSPECT_AGENT_V2_ANTHROPIC = "on";

/**
 * Worker 프록시(/internal/inspect-llm/v2/responses)의 로컬 대역 — 같은 경로 함수(inspectAgentV2Route)·같은 본문 함수·
 * 같은 어댑터·런 예산. 다른 점: 게이트웨이 대신 벤더 직행.
 */
export function localResponses(events, { budgetUsd = v2.v2RunBudgetUsd(process.env.INSPECT_AGENT_V2_BUDGET_USD) } = {}) {
  let spent = 0;
  const fn = async (req) => {
    if (spent >= budgetUsd) throw new Error("budget_exhausted");
    const route = inspectAgentV2Route(process.env);
    if (route.length === 0) throw new Error("llm_unavailable");
    let lastErr = null;
    for (const { vendor, model } of route) {
      const url = vendor === "anthropic" ? "https://api.anthropic.com/v1/messages" : OPENAI_RESPONSES;
      const headers =
        vendor === "anthropic"
          ? { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }
          : { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" };
      const body = vendor === "anthropic" ? v2.toAnthropicRequest(req, model) : v2.buildV2ResponsesBody(req, { model, effort: inspectAgentV2Effort(process.env) });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const t0 = Date.now();
        let r;
        try {
          r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
        } catch (err) {
          lastErr = err;
          await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
          continue;
        }
        if (!r.ok) {
          lastErr = new Error(`${vendor}_${r.status}:${(await r.text().catch(() => "")).slice(0, 300)}`);
          if (r.status === 429 || r.status >= 500 || r.status === 529) {
            await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
            continue;
          }
          break;
        }
        const j = await r.json();
        const conv = vendor === "anthropic" ? v2.fromAnthropicResponse(j) : { output: j.output ?? [], model: j.model ?? null, tokens: v2.usageFromResponses(j.usage) };
        const modelActual = conv.model || model;
        const cost = priceTokens(modelActual, conv.tokens).costUsd;
        spent += cost;
        events.push({ vendor, modelActual, ...conv.tokens, costUsd: cost, latencyMs: Date.now() - t0, fallback: route[0].model !== model });
        return { output: conv.output, usage: conv.tokens, model: modelActual };
      }
    }
    throw lastErr ?? new Error("responses_failed");
  };
  fn.spent = () => spent;
  return fn;
}

/** 픽스처 워커(src/index.mjs)를 로컬 HTTP로 띄운다(배포 없이). */
export async function serveFixtures(port = 0) {
  const worker = (await import(pathToFileURL(join(here, "src", "index.mjs")).href)).default;
  const server = createServer(async (req, res) => {
    const url = `http://127.0.0.1:${server.address().port}${req.url}`;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, ...(chunks.length && req.method !== "GET" ? { body: Buffer.concat(chunks) } : {}) }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

/** v2 한 런(프로덕션과 같은 상한). */
export async function runV2Local({ url, intent, acs = [], acSource, locale = "ko", priorPlan = null, onPhase, credentials = null }) {
  const events = [];
  const outDir = mkdtempSync(join(tmpdir(), "v2-local-"));
  const phases = [];
  const t0 = Date.now();
  try {
    const driver = await createPlaywrightDriver({ outDir, locale, isNoiseResource, chromium });
    const llm = localResponses(events);
    const r = await runAgentV2({
      targetUrl: url,
      intent,
      locale,
      budgetMs: AGENT_V2_CAPS.maxMinutes * 60_000,
      caps: { maxAcs: 11, maxToolCalls: AGENT_V2_CAPS.maxToolCalls },
      acs,
      acSource: acSource ?? (acs.length ? "confirmed_inferred" : "inferred_at_run"),
      priorPlan,
      loginMode: credentials ? "credentials" : "none",
      ...(credentials ? { credentials } : {}),
      llm,
      driver,
      onPhase: (l) => {
        phases.push(l);
        onPhase?.(l);
      },
    });
    const costUsd = Number(events.reduce((s, e) => s + e.costUsd, 0).toFixed(4));
    return { ...r, costUsd, llmCalls: events.length, models: [...new Set(events.map((e) => e.modelActual))], durationSec: Math.round((Date.now() - t0) / 1000), phasesTail: phases.slice(-8), chargeEstimate: v2.chargeEstimate(costUsd, process.env.INSPECTION_CHARGE_MARKUP) };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** 주 모델이 Claude인데 키가 없으면 대체 모델로 몰래 돌리지 않고 멈춘다(Bae 2026-10-07). */
export function assertModelKeys() {
  const primary = process.env.INSPECT_AGENT_V2_MODEL || "claude-fable-5-1";
  if (/^claude-/.test(primary) && !process.env.ANTHROPIC_API_KEY) {
    console.error(`주 모델이 Claude(${primary})인데 ANTHROPIC_API_KEY가 없습니다 — 다른 모델로 대신 돌리지 않고 멈춥니다. tools/simsa-completion-loop-spike/.env.staff.local에 ANTHROPIC_API_KEY=… 한 줄을 넣어 주세요.`);
    process.exit(2);
  }
  const route = inspectAgentV2Route(process.env);
  if (route.length === 0) {
    console.error("쓸 수 있는 모델 키가 없습니다 — 멈춥니다.");
    process.exit(2);
  }
  console.log("route:", route.map((r) => r.model).join(" → "));
}

const ac = (id, title, given, when, then, priority = "must") => ({ id, title, given, when, then, priority, confirmed: true, origin: "user_checked" });

/** 스모크용 픽스처(정답은 픽스처 설계 문서 그대로 — F1 작동 · F3 Potemkin · F6 화면만 추가). */
export const SMOKE = {
  "working-todo": { expect: "works", intent: "오늘 할 일을 적어 두고, 다시 열어도 남아 있는 할 일 목록", acs: [ac("AC-001", "할 일을 추가하면 목록에 남는다", "할 일 목록 화면", "할 일을 적고 추가를 누른다", "목록에 그 할 일이 보이고, 페이지를 다시 열어도 남아 있다")] },
  "potemkin-crm": { expect: "broken", intent: "고객 정보를 저장해 두는 간단한 고객 관리", acs: [ac("AC-001", "고객을 저장하면 목록에 남는다", "고객 관리 화면", "고객 이름을 넣고 저장한다", "저장한 고객이 목록에 보이고 다시 열어도 남아 있다")] },
  "optimistic-ghost": { expect: "broken", intent: "할 일을 적어 두고 다시 열어도 남아 있는 할 일 목록", acs: [ac("AC-001", "할 일을 추가하면 다시 열어도 남는다", "할 일 화면", "할 일을 추가한다", "다시 열어도 그 할 일이 남아 있다")] },
};

async function main() {
  assertModelKeys();
  const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
  const names = arg("fixtures", Object.keys(SMOKE).join(",")).split(",").filter((x) => SMOKE[x]);
  const srv = await serveFixtures();
  const out = [];
  try {
    for (const name of names) {
      const f = SMOKE[name];
      console.log(`▶ ${name}`);
      const r = await runV2Local({ url: `${srv.base}/${name}`, intent: f.intent, acs: f.acs, onPhase: (l) => process.env.V2_VERBOSE && console.log("  ", l) });
      const row = { fixture: name, expect: f.expect, decision: r.decision, oneLine: r.report.oneLine, acTable: r.report.acTable.map((x) => ({ id: x.id, status: x.status, reasonCode: x.reasonCode, reason: x.reason, evidence: x.evidence })), v2: { citation: r.report.agent.v2.citation, toolCalls: r.report.agent.v2.toolCalls, judgments: r.report.agent.v2.judgments }, costUsd: r.costUsd, llmCalls: r.llmCalls, models: r.models, durationSec: r.durationSec, phasesTail: r.phasesTail };
      out.push(row);
      console.log(`  ${name}: ${r.decision} (기대 ${f.expect}) $${r.costUsd} ${r.durationSec}s calls=${r.llmCalls} tools=${r.report.agent.v2.toolCalls} cite=${r.report.agent.v2.citation.pct}%`);
      for (const x of row.acTable) console.log(`    ${x.id} ${x.status}${x.reasonCode ? `(${x.reasonCode})` : ""} — ${String(x.reason).slice(0, 160)}`);
    }
  } finally {
    await srv.close();
  }
  const file = join(here, `agent-v2-smoke-result-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`saved: ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
