#!/usr/bin/env node
/**
 * agent-v2-eval13.mjs — 설계 §4 관문 G1(로컬): 미용실 6 + 파일럿 7 = 13앱을 검사 엔진 v2로 **순차** 실행(메모리).
 *
 *   앱마다 주소만 문: 의도 추론 → "맞나요?" 흉내(빌더에 넣은 프롬프트 원문만 앎 — 체크 해제 시작, 근거 있는 것만 체크 + 빠진 것 적기)
 *   → 역추론 지시서 → v2(프로덕션과 같은 모델 경로·도구·상한, agent-v2-local.mjs).
 *   정답지는 **채점에만** 쓴다(이 스크립트는 정답을 읽지 않는다 — 결과 JSON을 사람이 정답지와 대조해 문서로 채점).
 *
 * 사용: SIMSA_STAFF_ENV_FILE=<.env.staff.local> node tools/simsa-inspection-fixtures/agent-v2-eval13.mjs [--only=chatgpt,bolt] [--set=salon|pilot]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runV2Local, assertModelKeys } from "./agent-v2-local.mjs";
import { REGISTERED_PROMPT, APPS as SALON_APPS, confirmFromPrompt } from "./agent-bench1-local.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CP = join(here, "..", "..", "apps", "central-plane");
const imp = (p) => import(pathToFileURL(join(CP, p)).href);
const { evidenceFromWebsite, composeIdeaFromEvidence } = await imp("dist/workspace/source-evidence.js");
const { generateIdeaToSpecDraft } = await imp("dist/workspace/generate.js");
const { generateDevSpec, makeDevSpecLlmCaller } = await imp("dist/workspace/generate-dev-spec.js");
const { agentAcsFromDevSpec } = await imp("dist/acceptance-plan.js");
const require = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"));
const { chromium } = require("playwright");

/** 파일럿 1차 사전 등록 프롬프트(agent-pilot1-prod-result-2026-10-06…json의 prompt와 같은 원문). */
export const PILOT_PROMPT =
  "영어를 사용하지 않는 한국인 바이브코딩/노코드 코딩 AI 유저들에게 본인들이 AI 에이전트를 이용해서 만든 제품/서비스가 실제로 작동하는지 검토와 만약 어딘가가 고장나서 작동하지 않는다면 정확한 진단과 수정을 통해 작동하는결과물을 내놓거나 다른 에이전트에게 전달할 수 있는 개발지시서의 형태로 나오는 플랫폼을 만들고 싶어.";

export const PILOT_APPS = [
  { id: "lovable", url: "https://agent-fix-korea.lovable.app/" },
  { id: "v0", url: "https://verifiy-sigma.vercel.app/" },
  { id: "bolt", url: "https://korean-ai-agent-revi-bg0l.bolt.host/" },
  { id: "gemini1", url: "https://stellar-mandazi-2a81dc.netlify.app/" },
  { id: "gemini2", url: "https://incandescent-sorbet-62ee76.netlify.app/" },
  { id: "chatgpt", url: "https://roaring-bombolone-cb0580.netlify.app/" },
  { id: "claude", url: "https://beamish-capybara-2bf1d8.netlify.app/" },
];

const KEY_SLOT = process.env.ANTHROPIC_API_KEY || "local-anthropic-skipped";
const fallback = () => (process.env.OPENAI_API_KEY ? { openaiApiKey: process.env.OPENAI_API_KEY, preferFallback: true } : undefined);
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;

async function renderedText(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" })).newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);
    return { title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 6000) };
  } finally {
    await browser.close();
  }
}

/** 주소만 문의 기준 만들기. 추론이 안 되면(404 등) 기준 없이 v2로 — 정찰이 스스로 고장을 판정한다(v1 하네스처럼 멈추지 않는다). */
async function criteriaFor(url, prompt, locale = "ko") {
  const out = { inference: null, confirm: null, acs: [], intent: "" };
  try {
    const ev = await evidenceFromWebsite(url, fetch).catch(() => null);
    let idea = ev ? composeIdeaFromEvidence(ev, locale) : "";
    if (!idea || (ev?.text?.length ?? 0) < 400) {
      const r = await renderedText(url).catch(() => null);
      if (r?.text) idea = composeIdeaFromEvidence({ kind: "website", reference: url, text: r.text, title: r.title, stack: ev?.stack ?? {}, readSources: ["rendered"] }, locale);
    }
    if (!idea) {
      out.inference = { error: "no_evidence" };
      return out;
    }
    const draft = await generateIdeaToSpecDraft({ idea, locale }, KEY_SLOT, undefined, fallback(), () => {});
    if (!draft || draft.ok === false || !Array.isArray(draft.items)) {
      out.inference = { error: "inference_failed" };
      return out;
    }
    out.inference = { summary: draft.understood?.summary ?? null, items: draft.items.length };
    const card = await confirmFromPrompt(draft.items, [], prompt);
    out.confirm = card;
    const confirmedItemIds = [...card.items.filter((a) => a.confirmed).map((a) => a.id), ...card.added.map((a) => a.id)];
    const allItems = [...draft.items, ...card.added.map(({ why: _w, ...rest }) => ({ ...rest, status: "not_started" }))];
    const oneLine = card.oneLine || draft.productSpec?.oneLine || "";
    const call = makeDevSpecLlmCaller(KEY_SLOT, undefined, fallback(), undefined, () => {});
    const gen = await generateDevSpec({ brief: { ...(draft.productSpec ?? {}), oneLine }, items: allItems, idea, locale, source: "inferred", confirmedItemIds }, call);
    out.acs = gen.ok ? agentAcsFromDevSpec(gen.devSpec) : [];
    out.intent = oneLine || draft.understood?.summary || "";
  } catch (err) {
    out.inference = { error: String(err?.message ?? err).slice(0, 200) };
  }
  return out;
}

async function main() {
  assertModelKeys();
  const set = arg("set", "all");
  const only = arg("only", "").split(",").filter(Boolean);
  const apps = [
    ...(set === "pilot" ? [] : SALON_APPS.map((a) => ({ ...a, id: `salon-${a.id}`, prompt: REGISTERED_PROMPT }))),
    ...(set === "salon" ? [] : PILOT_APPS.map((a) => ({ ...a, id: `pilot-${a.id}`, prompt: PILOT_PROMPT }))),
  ].filter((a) => !only.length || only.includes(a.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(here, "eval13", stamp);
  mkdirSync(outDir, { recursive: true });
  const summary = [];
  for (const app of apps) {
    console.log(`▶ ${app.id} ${app.url}`);
    const t0 = Date.now();
    const crit = await criteriaFor(app.url, app.prompt);
    let row;
    try {
      const r = await runV2Local({ url: app.url, intent: crit.intent || app.prompt, acs: crit.acs, acSource: crit.acs.length ? "confirmed_inferred" : "inferred_at_run", onPhase: (l) => process.env.V2_VERBOSE && console.log("  ", l) });
      row = {
        app: app.id, url: app.url, model: process.env.INSPECT_AGENT_V2_MODEL || "claude-fable-5-1",
        criteria: crit, decision: r.decision, verdict: r.report.verdict, oneLine: r.report.oneLine,
        acTable: r.report.acTable.map((x) => ({ id: x.id, priority: x.priority, confirmed: x.confirmed, title: x.title, then: x.then, status: x.status, reasonCode: x.reasonCode, reason: x.reason, evidence: x.evidence })),
        findings: r.report.findings, builderPack: r.agentPrompt, singleFileFix: r.report.agent.singleFileFix ? { ...r.report.agent.singleFileFix, correctedHtml: r.report.agent.singleFileFix.correctedHtml ? "(present)" : undefined } : null,
        v2: { ...r.report.agent.v2, artifacts: r.report.agent.v2.artifacts }, costUsd: r.costUsd, llmCalls: r.llmCalls, models: r.models, durationSec: Math.round((Date.now() - t0) / 1000),
      };
    } catch (err) {
      row = { app: app.id, url: app.url, criteria: crit, error: String(err?.message ?? err).slice(0, 300), durationSec: Math.round((Date.now() - t0) / 1000) };
    }
    writeFileSync(join(outDir, `${app.id}.json`), JSON.stringify(row, null, 2));
    const brief = { app: app.id, decision: row.decision ?? row.error, mismatch: row.v2?.judgments?.some((j) => j.acId === "INTENT" && j.verdict === "mismatch") ?? false, fails: (row.acTable ?? []).filter((x) => x.status === "fail").map((x) => x.id), cite: row.v2?.citation?.pct, costUsd: row.costUsd, durationSec: row.durationSec };
    summary.push(brief);
    console.log("  ", JSON.stringify(brief));
  }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`saved: ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
