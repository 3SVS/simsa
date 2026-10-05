#!/usr/bin/env node
/**
 * agent-bench1-local.mjs — 벤치마크 #1(동네 미용실 6앱)을 **브랜치 코드의 agent 엔진**으로 로컬에서 잰다.
 * 로컬 실행(브랜치 코드) — 프로덕션 아님. 프로덕션 측정은 agent-bench1.mjs(머지·배포 뒤).
 *
 * 앱마다 문 (2) "주소만" 실제 사용자 흐름:
 *   1) 의도 추론 — 프로덕션 infer-intent와 같은 함수(evidenceFromWebsite → composeIdeaFromEvidence → generateIdeaToSpecDraft)
 *   2) "맞나요?" 확인 — **사전 등록 프롬프트 원문만** 보고 답하는 사용자 흉내(항목마다 예/아니오, 기록 남김)
 *   3) 역추론 지시서 — 프로덕션 generateDevSpec(source inferred, 확인 id 동봉) → agentAcsFromDevSpec
 *   4) agent 엔진 — inspector-container/agent-run.mjs + agent-driver.mjs(로컬 Playwright), 로그인 없음
 *      (Lovable /admin 비밀번호는 쓰지 않는다 — "로그인 필요"로 끝나야 정답)
 * LLM은 Worker 프록시 대신 **같은 anthropicMessages(벤더 폴백 포함)** 를 셸 환경의 키로 부른다(키는 출력·기록하지 않는다).
 *
 * 사용: node tools/simsa-inspection-fixtures/agent-bench1-local.mjs [--only=claude,gemini] [--concurrency=2]
 *   필요: apps/central-plane 빌드(dist), tools/simsa-completion-loop-spike의 playwright(npm install --no-save),
 *         ANTHROPIC_API_KEY 또는 OPENAI_API_KEY.
 * 결과: tools/simsa-inspection-fixtures/agent-bench1-local-result.json (+ 표준 출력 요약)
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CP = join(here, "..", "..", "apps", "central-plane");
const imp = (p) => import(pathToFileURL(join(CP, p)).href);

const { evidenceFromWebsite, composeIdeaFromEvidence } = await imp("dist/workspace/source-evidence.js");
const { generateIdeaToSpecDraft } = await imp("dist/workspace/generate.js");
const { generateDevSpec, makeDevSpecLlmCaller } = await imp("dist/workspace/generate-dev-spec.js");
const { anthropicMessages, OPENAI_FALLBACK_MODEL } = await imp("dist/workspace/anthropic-fetch.js");
const { priceTokens } = await imp("dist/workspace/llm-pricing.js");
const { agentAcsFromDevSpec } = await imp("dist/acceptance-plan.js");
const { runAgentInspection } = await imp("inspector-container/agent-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");

const require = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"));
const { chromium } = require("playwright");

/** 사전 등록 프롬프트 원문(docs/pilot-2026-10/benchmark-salon-2026-10-05.md §1). */
export const REGISTERED_PROMPT =
  "우리 동네 1인 미용실 예약 웹사이트를 만들어줘. 손님이 날짜와 시간(오전 10시부터 오후 7시까지, 30분 단위)을 고르고 이름과 휴대폰 번호를 넣으면 예약이 돼. 이미 예약된 시간은 다른 손님이 고를 수 없어야 해. 예약하면 예약 완료 화면에 예약 내용이 보이고, 새로고침해도 예약이 사라지지 않아야 해. 사장님은 관리 화면에서 오늘 예약 목록을 시간순으로 보고 예약을 취소할 수 있어. 가격은 커트 15,000원, 펌 60,000원처럼 원 단위로 보여줘. 휴대폰으로 보기 편하게, 모든 글은 한국어로 해줘.";

/**
 * 사전 등록 정답지(bench1-answer-key-*.md, Simsa 실행 전 커밋)의 기대 판정과 must 실패.
 * expected: broken = "안 돼요"만 정답 · broken_or_hold = 안 돼요/사람 확인 필요 · works = 작동 편.
 * timeDependent: 00~09 KST에만 드러나는 결함(실행 시각 기록, 안 보이면 '놓침' 아님).
 */
export const APPS = [
  { id: "chatgpt", url: "https://cosmic-crostata-7c1265.netlify.app/", expected: "broken", mustFailed: ["A3", "A4", "A5", "A6", "A7"] },
  { id: "gemini", url: "https://elaborate-crostata-d9b61c.netlify.app/", expected: "broken_or_hold", mustFailed: ["A3", "A6"] },
  { id: "v0", url: "https://1-pi-three-qk0pjsjigw.vercel.app/", expected: "broken_or_hold", mustFailed: ["A6", "A7"], timeDependent: true },
  { id: "bolt", url: "https://hair-salon-booking-w-8vq8.bolt.host/", expected: "broken_or_hold", mustFailed: ["A6", "A7"], timeDependent: true },
  { id: "claude", url: "https://dreamy-babka-5f07cd.netlify.app/", expected: "broken_or_hold", mustFailed: ["A3", "A6"] },
  { id: "lovable", url: "https://my-town-salon.lovable.app/", expected: "works", mustFailed: [] },
];

/** 정답지 조건 ↔ 실패 AC 문장 대조(키워드). 사람이 결과 문서에서 한 번 더 본다. */
const CONDITION_KEYWORDS = {
  A1: /30분|10시|19시|오후 7|시간.*고르|시간대|time slot/i,
  A2: /휴대폰|번호.*형식|이름.*없|필수|유효성/i,
  A3: /다른 손님|중복|이미 예약|이중|겹치/i,
  A4: /완료 화면|예약 내용|확인 화면|완료/i,
  A5: /새로고침|유지|사라지지/i,
  A6: /관리|사장|오늘 예약|목록/i,
  A7: /취소/i,
};

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}

/**
 * 프로덕션 Worker에는 Anthropic 키가 **설정돼 있고**(차단 상태라 킬스위치로 OpenAI 폴백) 생성 함수들이 키 유무로
 * 모의 응답을 고르므로, 로컬에서도 키 자리를 채워 같은 경로(폴백)로 가게 한다. 이 값은 어디에도 보내지지 않는다
 * (preferFallback이면 Anthropic 호출 자체를 건너뛴다).
 */
const ANTHROPIC_KEY_SLOT = process.env.ANTHROPIC_API_KEY || "local-anthropic-skipped";
const STATIC_EVIDENCE_MIN = 400;

function fallbackConfig() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  return openaiApiKey ? { openaiApiKey, ...(process.env.ANTHROPIC_API_KEY ? {} : { preferFallback: true }) } : undefined;
}

function costOf(events) {
  return events.reduce((s, e) => s + priceTokens(e.modelActual, e).costUsd, 0);
}

/** Worker 프록시의 로컬 대역: 같은 anthropicMessages(폴백·재시도), 같은 서버 고정 모델, 같은 단일 턴 모양. */
function localProxyLlm(events) {
  const model = process.env.INSPECT_AGENT_MODEL || "claude-sonnet-4-6";
  return async ({ system, user, maxTokens = 700 }) => {
    const data = await anthropicMessages(
      ANTHROPIC_KEY_SLOT,
      { model, max_tokens: maxTokens, messages: [{ role: "user", content: `${system}\n\n---\n\n${user}` }] },
      90_000,
      fetch,
      undefined,
      "inspect_agent",
      { fallback: fallbackConfig(), onUsage: (u) => events.push(u), maxTotalMs: 20_000 },
    );
    return (data.content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
  };
}

/**
 * "맞나요?" 카드에 답하는 사용자 흉내 — 카드의 실제 모양 그대로(IntentConfirmCard):
 *   ① 한 줄 의도(내가 원래 원한 것) ② 추론 항목은 **기본 체크**, 내 요청과 어긋나는 것만 해제
 *   ③ "빠졌는데 꼭 되어야 하는 것" — 내 요청에 있는데 목록에 없는 것을 한 줄씩(intent-missing.mjs와 같은 user_N 항목)
 * 아는 것은 **빌더에 넣은 프롬프트 원문뿐**이다(정답지는 보지 않는다). 항목마다 이유를 남긴다.
 */
export async function confirmFromPrompt(items, events) {
  const llm = localProxyLlm(events);
  const list = items.map((it, i) => `${i + 1}. [${it.id}] ${it.title}${it.criteria?.length ? ` — ${it.criteria.join(" / ")}` : ""}`).join("\n");
  const text = await llm({
    system: [
      "You simulate a non-developer filling in an app checker's 'Is this right?' card. The ONLY thing you know is the request you typed into the AI builder (below) — answer from that text, not from what would be easy to pass.",
      "The card has: (1) a one-sentence description of what you wanted, (2) the checker's inferred items, all checked by default — uncheck only items that contradict your request, (3) a box 'anything missing that must work?' — list, one per line in Korean, every requirement your request states (especially outcomes: what must actually happen, who must see it, what must be prevented, what must survive) that the inferred items do not already cover.",
      'Reply JSON only: {"oneLine":"...","items":[{"id":"...","keep":true|false,"why":"..."}],"missing":[{"text":"...","why":"..."}]}',
    ].join("\n"),
    user: `My request to the builder (verbatim):\n${REGISTERED_PROMPT}\n\nItems the checker inferred from my app:\n${list}`,
    maxTokens: 1500,
  });
  const m = /\{[\s\S]*\}/.exec(text);
  let parsed = {};
  try {
    parsed = JSON.parse(m ? m[0] : "{}");
  } catch {
    parsed = {};
  }
  const verdicts = new Map((Array.isArray(parsed.items) ? parsed.items : []).map((x) => [x?.id, x]));
  const kept = items.map((it) => {
    const v = verdicts.get(it.id);
    return { id: it.id, title: it.title, confirmed: v?.keep !== false, why: String(v?.why ?? "기본 체크 유지").slice(0, 200) };
  });
  const missing = (Array.isArray(parsed.missing) ? parsed.missing : [])
    .map((x) => ({ text: String(x?.text ?? "").trim().slice(0, 200), why: String(x?.why ?? "").slice(0, 200) }))
    .filter((x) => x.text.length >= 2)
    .slice(0, 8);
  const taken = new Set(items.map((i) => i.id));
  const added = [];
  for (const mItem of missing) {
    let n = added.length + 1;
    while (taken.has(`user_${n}`)) n += 1;
    taken.add(`user_${n}`);
    added.push({ id: `user_${n}`, title: mItem.text, criteria: [], why: mItem.why });
  }
  return { oneLine: String(parsed.oneLine ?? "").trim().slice(0, 300), items: kept, added };
}

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

export async function benchOne(app, { locale = "ko" } = {}) {
  const t0 = Date.now();
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const genEvents = [];
  const agentEvents = [];
  const out = { app: app.id, url: app.url, startedKst: kst, expected: app.expected };
  // 1) 의도 추론 — 프로덕션 함수 그대로(정적 HTML). 비어 있으면(SPA) 렌더 본문으로 한 번 더 — 차이를 기록한다.
  const ev = await evidenceFromWebsite(app.url, fetch).catch(() => null);
  let idea = ev ? composeIdeaFromEvidence(ev, locale) : "";
  out.inference = { staticEvidenceChars: ev?.text?.length ?? 0, usedRenderedText: false };
  // 정적 HTML만 읽는 프로덕션 infer-intent는 SPA(빌더 앱 대부분)에서 껍데기만 읽는다 — 로컬 실측에서 발견한 격차.
  // 여기서는 렌더된 화면 글자로 보충하고 그 사실을 기록한다(프로덕션 수정 과제).
  if (!idea || (ev?.text?.length ?? 0) < STATIC_EVIDENCE_MIN) {
    const r = await renderedText(app.url).catch(() => null);
    if (r?.text) {
      idea = composeIdeaFromEvidence({ kind: "website", reference: app.url, text: r.text, title: r.title, stack: ev?.stack ?? {}, readSources: ["rendered"] }, locale);
      out.inference.usedRenderedText = true;
    }
  }
  if (!idea) {
    out.error = "no_evidence";
    return out;
  }
  const draft = await generateIdeaToSpecDraft({ idea, locale }, ANTHROPIC_KEY_SLOT, undefined, fallbackConfig(), (u) => genEvents.push(u));
  if (!draft || draft.ok === false || !Array.isArray(draft.items)) {
    out.error = "inference_failed";
    return out;
  }
  out.inference.summary = draft.understood?.summary;
  // 2) 맞나요? — 프롬프트 원문만으로
  const card = await confirmFromPrompt(draft.items, genEvents);
  out.confirm = card;
  const confirmedItemIds = [...card.items.filter((a) => a.confirmed).map((a) => a.id), ...card.added.map((a) => a.id)];
  const allItems = [...draft.items, ...card.added.map(({ why: _w, ...rest }) => ({ ...rest, status: "not_started" }))];
  const userOneLine = card.oneLine || draft.productSpec?.oneLine || "";
  // 3) 역추론 지시서 — 카드가 저장하는 그대로(브리프 oneLine = 사용자가 쓴 문장, 항목 = 체크 유지 + 직접 적은 것)
  const call = makeDevSpecLlmCaller(ANTHROPIC_KEY_SLOT, undefined, fallbackConfig(), undefined, (u) => genEvents.push(u));
  const gen = await generateDevSpec(
    { brief: { ...(draft.productSpec ?? {}), oneLine: userOneLine }, items: allItems, idea, locale, source: "inferred", confirmedItemIds },
    call,
  );
  const acs = gen.ok ? agentAcsFromDevSpec(gen.devSpec) : [];
  out.devSpec = gen.ok ? { ok: true, acs: acs.length } : { ok: false, error: gen.error };
  // 4) agent 엔진(로컬 Playwright, 로그인 없음)
  const outDir = mkdtempSync(join(tmpdir(), `bench1-${app.id}-`));
  const phases = [];
  try {
    const driver = await createPlaywrightDriver({ outDir, locale, isNoiseResource, chromium });
    const r = await runAgentInspection({
      targetUrl: app.url,
      // 프로덕션 런의 의도 = 프로젝트의 확정 한 줄(confirmedIntentFromProject) — 카드에서 사용자가 쓴 문장.
      intent: userOneLine || draft.understood?.summary || idea.slice(0, 300),
      locale,
      budgetMs: 13 * 60 * 1000,
      acs,
      acSource: acs.length ? "confirmed_inferred" : "inferred_at_run",
      loginMode: "none",
      llm: localProxyLlm(agentEvents),
      driver,
      onPhase: (l) => phases.push(l),
    });
    out.decision = r.decision;
    out.works = r.works;
    out.verdict = r.report.verdict;
    out.oneLine = r.report.oneLine;
    out.acTable = r.report.acTable.map((x) => ({ id: x.id, priority: x.priority, confirmed: x.confirmed, title: x.title, then: x.then, status: x.status, reason: x.reason, reasonCode: x.reasonCode, evidence: x.evidence, actions: x.actions, exercised: x.exercised }));
    out.sweep = r.report.sweep;
    out.findings = r.report.findings.map((f) => ({ code: f.code, what: f.what }));
    out.agentPrompt = r.agentPrompt;
    out.llmCalls = r.report.agent.llmCalls;
    out.basis = r.report.agent.basis;
    out.builder = r.report.agent.builder;
    out.defects = r.report.agent.defects;
  } catch (err) {
    out.error = `agent_failed: ${String(err?.message ?? err).slice(0, 200)}`;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  out.phasesTail = phases.slice(-6);
  out.costUsd = { generation: Number(costOf(genEvents).toFixed(4)), agent: Number(costOf(agentEvents).toFixed(4)) };
  out.models = [...new Set([...genEvents, ...agentEvents].map((e) => e.modelActual))];
  out.durationSec = Math.round((Date.now() - t0) / 1000);
  return score(app, out);
}

/** 판정 편: Needs Fix=고장 · Ready/Conditionally Ready=작동 · 그 밖=보류. */
export function side(decision) {
  if (decision === "Needs Fix") return "broken";
  if (decision === "Ready" || decision === "Conditionally Ready") return "works";
  return "hold";
}

export function score(app, out) {
  const s = side(out.decision);
  const opposite = (app.expected === "works" && s === "broken") || (app.expected !== "works" && s === "works");
  const match = app.expected === "broken" ? s === "broken" : app.expected === "broken_or_hold" ? s !== "works" : s === "works";
  const failedText = (out.acTable ?? []).filter((x) => x.status === "fail").map((x) => `${x.title} ${x.then} ${x.reason}`).join(" \n ");
  const identified = app.mustFailed.filter((c) => CONDITION_KEYWORDS[c].test(failedText));
  return { ...out, side: s, opposite, match, mustFailedExpected: app.mustFailed, mustIdentified: identified };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error("LLM 키가 셸 환경에 없습니다(ANTHROPIC_API_KEY · OPENAI_API_KEY 둘 다 없음) — 측정하지 않고 멈춥니다.");
    process.exit(2);
  }
  const only = arg("only", "").split(",").filter(Boolean);
  const conc = Math.max(1, Math.min(2, Number(arg("concurrency", "2")) || 2));
  const apps = APPS.filter((a) => !only.length || only.includes(a.id));
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (i < apps.length) {
        const app = apps[i++];
        console.log(`▶ ${app.id} ${app.url}`);
        const r = await benchOne(app).catch((err) => ({ app: app.id, error: String(err?.message ?? err).slice(0, 300) }));
        results.push(r);
        console.log(`  ${app.id}: ${r.decision ?? r.error} side=${r.side} match=${r.match} opposite=${r.opposite} must=${(r.mustIdentified ?? []).join(",")}/${(r.mustFailedExpected ?? []).join(",")} $${(r.costUsd?.generation ?? 0) + (r.costUsd?.agent ?? 0)} ${r.durationSec}s`);
      }
    }),
  );
  const ordered = APPS.map((a) => results.find((r) => r.app === a.id)).filter(Boolean);
  const scored = ordered.filter((r) => r.decision);
  const brokenApps = APPS.filter((a) => a.mustFailed.length > 0);
  const totalMust = brokenApps.reduce((s, a) => s + a.mustFailed.length, 0);
  const idMust = ordered.reduce((s, r) => s + (r.mustIdentified?.length ?? 0), 0);
  const summary = {
    label: "로컬 실행(브랜치 코드) — 프로덕션 아님",
    oppositeErrors: scored.filter((r) => r.opposite).length,
    appMatch: `${scored.filter((r) => r.match).length}/${APPS.length}`,
    mustIdentified: `${idMust}/${totalMust}`,
    mustIdentifiedPct: totalMust ? Math.round((idMust / totalMust) * 100) : 0,
    totalCostUsd: Number(ordered.reduce((s, r) => s + (r.costUsd?.generation ?? 0) + (r.costUsd?.agent ?? 0), 0).toFixed(4)),
  };
  const file = join(here, "agent-bench1-local-result.json");
  writeFileSync(file, JSON.stringify({ summary, results: ordered }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`saved: ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
