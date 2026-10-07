#!/usr/bin/env node
/**
 * agent-v2-bakeoff.mjs — 검사 엔진 v2 모델 비교(Bae 2026-10-08): 같은 주소·같은 의도·같은 기준으로 모델만 바꿔 N회씩.
 *
 *   주소만 문(door b): 의도·기준은 **한 번만** 추론해 모든 런이 공유한다(프로덕션 함수 그대로 — 의도 추론 → 역추론 지시서).
 *   "맞나요?" 흉내: 등록된 프롬프트가 없으므로 **아무것도 체크하지 않는다**(정당화할 근거 없음) → 기준은 전부 추론 = should.
 *   모델은 INSPECT_AGENT_V2_MODEL 한 변수만 바꾼다. 대체 모델은 같은 모델로 고정(비교 오염 방지 — 대체가 일어나면 런 실패로 기록).
 *   채점은 사람이 실브라우저로 주장마다 확인한다(이 스크립트는 정답을 모른다). 런마다 JSON: 판정·기준 표·고칠 것·빌더팩·증거물 목록·비용·시간.
 *
 * 실서비스 안전: 시험 데이터 이름 '심사테스트'만 · 결제·발송·초대·탈퇴·삭제 금지(실행기 규칙) · 가입은 일회용 계정 경로만(로컬에선 꺼짐 → 로그인 뒤는 확인 못 함).
 *
 * 사용: SIMSA_STAFF_ENV_FILE=<.env.staff.local> node tools/simsa-inspection-fixtures/agent-v2-bakeoff.mjs --url=https://daehwa-ai.com --models=claude-fable-5-1,claude-opus-5-5 --n=2
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { runV2Local, assertModelKeys } from "./agent-v2-local.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CP = join(here, "..", "..", "apps", "central-plane");
const imp = (p) => import(pathToFileURL(join(CP, p)).href);
const { evidenceFromWebsite, composeIdeaFromEvidence } = await imp("dist/workspace/source-evidence.js");
const { generateIdeaToSpecDraft } = await imp("dist/workspace/generate.js");
const { generateDevSpec, makeDevSpecLlmCaller } = await imp("dist/workspace/generate-dev-spec.js");
const { agentAcsFromDevSpec } = await imp("dist/acceptance-plan.js");
const require = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"));
const { chromium } = require("playwright");

const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const KEY_SLOT = process.env.ANTHROPIC_API_KEY || "local-anthropic-skipped";
const fallback = () => (process.env.OPENAI_API_KEY ? { openaiApiKey: process.env.OPENAI_API_KEY, preferFallback: true } : undefined);

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

/** 의도·기준 추론(한 번) — 프로덕션 생성 함수(생성 경로는 프로덕션처럼 OpenAI 폴백). 아무것도 체크하지 않은 카드. */
async function inferOnce(url, locale = "ko") {
  const ev = await evidenceFromWebsite(url, fetch).catch(() => null);
  let idea = ev ? composeIdeaFromEvidence(ev, locale) : "";
  let usedRendered = false;
  if (!idea || (ev?.text?.length ?? 0) < 400) {
    const r = await renderedText(url).catch(() => null);
    if (r?.text) {
      idea = composeIdeaFromEvidence({ kind: "website", reference: url, text: r.text, title: r.title, stack: ev?.stack ?? {}, readSources: ["rendered"] }, locale);
      usedRendered = true;
    }
  }
  if (!idea) throw new Error("no_evidence");
  const draft = await generateIdeaToSpecDraft({ idea, locale }, KEY_SLOT, undefined, fallback(), () => {});
  if (!draft || draft.ok === false || !Array.isArray(draft.items)) throw new Error("inference_failed");
  const call = makeDevSpecLlmCaller(KEY_SLOT, undefined, fallback(), undefined, () => {});
  const gen = await generateDevSpec({ brief: draft.productSpec ?? {}, items: draft.items, idea, locale, source: "inferred", confirmedItemIds: [] }, call);
  const acs = gen.ok ? agentAcsFromDevSpec(gen.devSpec) : [];
  return {
    url,
    usedRendered,
    registeredPrompt: null,
    confirmNote: "등록된 프롬프트 없음 — 흉내 사용자는 아무 항목도 체크하지 않음(근거 없음). 기준은 전부 추론(should).",
    intent: draft.understood?.summary ?? idea.slice(0, 300),
    items: draft.items.map((i) => ({ id: i.id, title: i.title })),
    acs,
  };
}

async function main() {
  const url = arg("url", "");
  if (!url) throw new Error("--url 필요");
  const models = arg("models", "claude-fable-5-1,claude-opus-5-5").split(",").filter(Boolean);
  const n = Math.max(1, Math.min(5, Number(arg("n", "2")) || 2));
  const outDir = join(here, "bakeoff", new URL(url).host);
  mkdirSync(outDir, { recursive: true });
  const specFile = join(outDir, "shared-intent-acs.json");
  const shared = existsSync(specFile) ? JSON.parse(readFileSync(specFile, "utf8")) : await inferOnce(url);
  writeFileSync(specFile, JSON.stringify(shared, null, 2));
  console.log(`intent: ${shared.intent}\nacs: ${shared.acs.length} (${shared.acs.map((a) => `${a.id}:${a.priority}`).join(" ")})`);
  const summary = [];
  for (const model of models) {
    for (let k = 1; k <= n; k += 1) {
      process.env.INSPECT_AGENT_V2_MODEL = model;
      process.env.INSPECT_AGENT_V2_FALLBACK_MODEL = model; // 대체 없음 — 비교 오염 방지
      assertModelKeys();
      console.log(`▶ ${model} run ${k}/${n}`);
      const t0 = Date.now();
      let row;
      try {
        const r = await runV2Local({ url, intent: shared.intent, acs: shared.acs, acSource: "confirmed_inferred", onPhase: (l) => process.env.V2_VERBOSE && console.log("  ", l) });
        row = {
          model,
          run: k,
          url,
          decision: r.decision,
          verdict: r.report.verdict,
          oneLine: r.report.oneLine,
          acTable: r.report.acTable.map((x) => ({ id: x.id, priority: x.priority, status: x.status, reasonCode: x.reasonCode, reason: x.reason, evidence: x.evidence })),
          findings: r.report.findings,
          builderPack: r.agentPrompt,
          v2: r.report.agent.v2,
          costUsd: r.costUsd,
          chargeEstimate: r.chargeEstimate,
          llmCalls: r.llmCalls,
          models: r.models,
          durationSec: r.durationSec,
          phasesTail: r.phasesTail,
        };
      } catch (err) {
        row = { model, run: k, url, error: String(err?.message ?? err).slice(0, 400), durationSec: Math.round((Date.now() - t0) / 1000) };
      }
      const file = join(outDir, `${model}-r${k}.json`);
      writeFileSync(file, JSON.stringify(row, null, 2));
      const brief = { model, run: k, decision: row.decision ?? row.error, fails: (row.acTable ?? []).filter((x) => x.status === "fail").length, mismatch: row.v2?.judgments?.some((j) => j.acId === "INTENT" && j.verdict === "mismatch") ?? false, cite: row.v2?.citation?.pct, toolCalls: row.v2?.toolCalls, costUsd: row.costUsd, durationSec: row.durationSec, models: row.models };
      summary.push(brief);
      console.log("  ", JSON.stringify(brief));
    }
  }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`saved: ${outDir}`);
}

await main();
