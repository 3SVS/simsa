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
 * 사용: node tools/simsa-inspection-fixtures/agent-bench1-local.mjs [--only=claude,gemini] [--concurrency=2] [--repeat=3] [--acs=prereg|inferred]
 *   필요: apps/central-plane 빌드(dist), tools/simsa-completion-loop-spike의 playwright(npm install --no-save),
 *         ANTHROPIC_API_KEY 또는 OPENAI_API_KEY.
 *   --acs=prereg(기본, 2026-10-18 HANDOFF §3-3): 사전 등록 조건 A1~A10(benchmark-salon-2026-10-05.md §2)을 AC로 **주입**한다 —
 *         의도 추론·"맞나요?"·지시서의 3단 LLM을 거치지 않으므로 질문(AC 목록)이 런마다 같다(질문 동일성 = 구성으로 보장).
 *   --acs=inferred: 옛 경로(의도 추론 → "맞나요?" 흉내 → 역추론 지시서 → AC 추출). 제품 경로 그대로를 재고 싶을 때.
 *   --repeat=N: 같은 묶음을 N번. 런마다 시각 붙은 파일(덮어쓰지 않음) + 집계 파일(평균·최소·최대 + 질문/판정 동일성).
 * 결과: tools/simsa-inspection-fixtures/agent-bench1-local-result-<시각>-r<k>.json · agent-bench1-local-aggregate-<시각>.json
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { summarize, aggregate, compareRuns, costOfResult } from "./agent-bench-aggregate.mjs";
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
const { inspectAgentModelFor } = await imp("dist/workspace/inspection-agent.js");
const { stableSeed } = await imp("dist/agent-inspection.js");
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

/** 주입 모드의 의도 한 줄 — 사전 등록 프롬프트를 사용자가 카드에 적었을 법한 한 문장으로(고정값, 런마다 같다). */
export const BENCH1_INTENT =
  "동네 1인 미용실 예약 웹사이트 — 손님이 날짜·시간(10:00~19:00, 30분 단위)을 고르고 이름·휴대폰 번호를 넣으면 예약되고, 사장님은 관리 화면에서 오늘 예약을 시간순으로 보고 취소한다";

/**
 * 사전 등록 조건 A1~A10(docs/pilot-2026-10/benchmark-salon-2026-10-05.md §2, Simsa 실행 전 고정)을 agent AC 모양으로.
 * id = 조건 번호 그대로라 정답지 mustFailed와 바로 맞물린다(키워드 대조 불필요). 우선순위도 §2 그대로(A1~A7 must, A8~A10 should).
 * 이 표를 고치는 것은 정답지를 고치는 것과 같다 — 실행 뒤에는 [정정 날짜]로만 덧붙인다.
 */
export const BENCH1_PREREG_ACS = Object.freeze(
  [
    { id: "A1", title: "10:00~19:00, 30분 단위로 시간 선택", given: "예약 화면에서 날짜를 골랐다", when: "시간 목록을 본다", then: "오전 10시부터 오후 7시까지 30분 단위 시간을 고를 수 있다", priority: "must" },
    { id: "A2", title: "이름·휴대폰 번호 없이는 예약되지 않는다", given: "날짜와 시간을 골랐다", when: "이름이나 휴대폰 번호를 비우거나 형식에 맞지 않게 넣고 예약한다", then: "예약되지 않고 무엇이 잘못됐는지 알려 준다", priority: "must" },
    { id: "A3", title: "이미 예약된 시간은 다른 손님이 고를 수 없다", given: "어떤 날짜·시간에 예약이 하나 있다", when: "다른 손님(새 브라우저)이 같은 날짜·시간을 고르려 한다", then: "그 시간은 고를 수 없다(이중 예약이 되지 않는다)", priority: "must" },
    { id: "A4", title: "예약하면 완료 화면에 예약 내용이 보인다", given: "날짜·시간·이름·휴대폰 번호를 넣었다", when: "예약한다", then: "완료 화면에 날짜·시간·이름이 보인다", priority: "must" },
    { id: "A5", title: "새로고침해도 예약이 남는다", given: "예약을 마쳤다", when: "새로고침하거나 새 브라우저로 다시 연다", then: "예약이 사라지지 않고 남아 있다(다른 방문자에게도 그 시간은 마감으로 보인다)", priority: "must" },
    { id: "A6", title: "관리 화면에 오늘 예약이 시간순으로 보인다", given: "오늘 날짜에 예약이 1건 이상 있다", when: "사장님이 관리 화면을 연다", then: "오늘 예약 목록이 시간순으로 보인다", priority: "must" },
    { id: "A7", title: "취소하면 그 시간을 다시 예약할 수 있다", given: "관리 화면에 예약이 1건 보인다", when: "그 예약을 취소한다", then: "목록에서 사라지고 손님이 그 시간을 다시 고를 수 있다", priority: "must" },
    { id: "A8", title: "가격이 원 단위로 보인다", given: "첫 화면 또는 예약 화면", when: "가격을 본다", then: "커트 15,000원처럼 원 단위 형식으로 보인다", priority: "should" },
    { id: "A9", title: "휴대폰 폭(390px)에서 쓸 수 있다", given: "휴대폰 폭 화면", when: "예약 흐름을 밟는다", then: "글자·버튼이 잘리지 않고 예약까지 할 수 있다", priority: "should" },
    { id: "A10", title: "모든 글이 한국어다", given: "앱의 모든 화면", when: "글을 읽는다", then: "영어 등 다른 언어 문구가 없다", priority: "should" },
  ].map((a) => Object.freeze({ ...a, confirmed: true })),
);

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
  // 2026-10-06 진단: run-1~4는 등급(tier)을 무시해 **모든 호출이 강한 모델(gpt-5.4 폴백)** 이었다 — 프로덕션(행동=gpt-5.4-mini)과
  // 달라 로컬 결과가 프로덕션에서 재현되지 않았다. 이제 프로덕션 프록시와 같은 규칙(inspectAgentModelFor)으로 모델을 고른다.
  return async ({ system, user, maxTokens = 700, tier = "strong" }) => {
    const { model, fallbackModel } = inspectAgentModelFor(process.env, tier);
    const fb = fallbackConfig();
    const data = await anthropicMessages(
      ANTHROPIC_KEY_SLOT,
      { model, max_tokens: maxTokens, messages: [{ role: "user", content: `${system}\n\n---\n\n${user}` }] },
      90_000,
      fetch,
      undefined,
      "inspect_agent",
      { fallback: fb && fallbackModel ? { ...fb, model: fallbackModel } : fb, onUsage: (u) => events.push(u), maxTotalMs: 20_000 },
    );
    return (data.content ?? []).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
  };
}

/**
 * "맞나요?" 카드에 답하는 사용자 흉내 — 카드의 실제 모양 그대로(IntentConfirmCard):
 *   ① 한 줄 의도(내가 원래 원한 것) ② 추론 항목은 **체크 해제로 시작**(2026-10-06 Bae 결정) — 내 요청이 분명히 말하는 것만 체크
 *   ③ "빠졌는데 꼭 되어야 하는 것" — 내 요청에 있는데 목록에 없는 것을 한 줄씩(intent-missing.mjs와 같은 user_N 항목)
 * 아는 것은 **빌더에 넣은 프롬프트 원문뿐**이다(정답지는 보지 않는다). 항목마다 이유를 남긴다.
 */
export async function confirmFromPrompt(items, events) {
  const llm = localProxyLlm(events);
  const list = items.map((it, i) => `${i + 1}. [${it.id}] ${it.title}${it.criteria?.length ? ` — ${it.criteria.join(" / ")}` : ""}`).join("\n");
  const text = await llm({
    system: [
      "You simulate a non-developer filling in an app checker's 'Is this right?' card. The ONLY thing you know is the request you typed into the AI builder (below) — answer from that text, not from what would be easy to pass.",
      "The card has: (1) a one-sentence description of what you wanted, (2) the checker's inferred items, all UNCHECKED by default — check ONLY items your request clearly asks for (checked items are judged 'must work'); leave everything else unchecked, (3) a box 'anything missing that must work?' — list, one per line in Korean, every requirement your request states (especially outcomes: what must actually happen, who must see it, what must be prevented, what must survive) that the inferred items do not already cover.",
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
    // 기본은 체크 해제 — 흉내 사용자가 명시적으로 체크(keep:true)한 것만 확인 목록.
    return { id: it.id, title: it.title, confirmed: v?.keep === true, why: String(v?.why ?? "체크하지 않음(기본)").slice(0, 200) };
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

export async function benchOne(app, { locale = "ko", acMode = "prereg", runTag = "r1" } = {}) {
  const t0 = Date.now();
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const genEvents = [];
  const agentEvents = [];
  const out = { app: app.id, url: app.url, startedKst: kst, expected: app.expected, acMode };
  let acs;
  let intent;
  if (acMode === "prereg") {
    // 주입 — 사전 등록 조건 그대로. 생성 LLM 0회, 런마다 같은 질문.
    acs = BENCH1_PREREG_ACS.map((a) => ({ ...a }));
    intent = BENCH1_INTENT;
    out.inference = { mode: "prereg" };
    out.devSpec = { ok: true, acs: acs.length, source: "prereg" };
  } else {
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
  acs = gen.ok ? agentAcsFromDevSpec(gen.devSpec) : [];
  out.devSpec = gen.ok ? { ok: true, acs: acs.length } : { ok: false, error: gen.error };
  // 프로덕션 런의 의도 = 프로젝트의 확정 한 줄(confirmedIntentFromProject) — 카드에서 사용자가 쓴 문장.
  intent = userOneLine || draft.understood?.summary || idea.slice(0, 300);
  }
  // 4) agent 엔진(로컬 Playwright, 로그인 없음)
  const outDir = mkdtempSync(join(tmpdir(), `bench1-${app.id}-`));
  const phases = [];
  try {
    const driver = await createPlaywrightDriver({ outDir, locale, isNoiseResource, chromium });
    const r = await runAgentInspection({
      targetUrl: app.url,
      intent,
      locale,
      budgetMs: 13 * 60 * 1000,
      acs,
      // 주입된 사전 등록 조건은 사용자가 직접 적어 확인한 기준과 같은 자리(interview).
      acSource: acMode === "prereg" ? "interview" : acs.length ? "confirmed_inferred" : "inferred_at_run",
      loginMode: "none",
      // (2026-10-19 given 셋업) 벤치 앱 = 정리 예산이 모자라도 셋업하고 "남음 n건"으로 표시. seed·표지는 런·앱에서(재현 가능, 런마다 다름).
      setupPolicy: "bench",
      testDataSeed: stableSeed(`${runTag}:${app.id}`),
      runTag: `${runTag}${app.id.slice(0, 2)}`,
      // (2026-10-20 격차 §8 a-3) 측정 기록에 기준별 판정 이력·턴별 생각·시작 상태를 남긴다(프로덕션 리포트에는 없음).
      trace: true,
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
    // (2026-10-19 PR4) 셋업·정리 결과 — 측정 기록의 "만든 것·남은 것".
    out.testData = r.report.agent.testData ?? null;
    out.setup = r.report.agent.setup ?? null;
    out.trace = r.report.agent.trace ?? null;
    out.setupAttempt = r.report.agent.setupAttempt ?? null;
  } catch (err) {
    out.error = `agent_failed: ${String(err?.message ?? err).slice(0, 200)}`;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  out.phasesTail = phases.slice(-6);
  // (2026-10-19) 셋업·정리·취소 클릭의 위상 로그 전체 — 측정 기록이 "무엇을 만들고 무엇을 지웠나"를 보여 준다.
  out.phases = phases.filter((l) => /setup:|cleanup|cancel-click|probe [A-Z0-9-]+ #|ac [A-Z0-9-]+ →/.test(l));
  out.costUsd = { generation: Number(costOf(genEvents).toFixed(4)), agent: Number(costOf(agentEvents).toFixed(4)) };
  out.costUsdTotal = Number((out.costUsd.generation + out.costUsd.agent).toFixed(4));
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
  // 주입 모드: AC id = 조건 번호이므로 그 AC가 fail이면 짚은 것(키워드 대조보다 엄격). 추론 모드: 실패 문장 키워드 대조(관대 — 사람이 한 번 더 본다).
  const identified =
    out.acMode === "prereg"
      ? app.mustFailed.filter((c) => (out.acTable ?? []).some((x) => x.id === c && x.status === "fail"))
      : (() => {
          const failedText = (out.acTable ?? []).filter((x) => x.status === "fail").map((x) => `${x.title} ${x.then} ${x.reason}`).join(" \n ");
          return app.mustFailed.filter((c) => CONDITION_KEYWORDS[c].test(failedText));
        })();
  return { ...out, side: s, opposite, match, mustFailedExpected: app.mustFailed, mustIdentified: identified };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error("LLM 키가 셸 환경에 없습니다(ANTHROPIC_API_KEY · OPENAI_API_KEY 둘 다 없음) — 측정하지 않고 멈춥니다.");
    process.exit(2);
  }
  const only = arg("only", "").split(",").filter(Boolean);
  const conc = Math.max(1, Math.min(2, Number(arg("concurrency", "2")) || 2));
  const acMode = arg("acs", "prereg") === "inferred" ? "inferred" : "prereg";
  // (H4·2026-10-18) --repeat=N: 같은 묶음을 N번 — 한 번의 점수로 판단하지 않는다. 런마다 시각 붙은 파일, 덮어쓰지 않는다.
  const repeat = Math.max(1, Math.min(10, Number(arg("repeat", "1")) || 1));
  const apps = APPS.filter((a) => !only.length || only.includes(a.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = `로컬 실행(브랜치 코드) — 프로덕션 아님 · AC=${acMode === "prereg" ? "사전 등록 A1~A10 주입" : "추론(옛 경로)"}`;
  const runs = [];
  const runsFull = [];
  for (let k = 1; k <= repeat; k += 1) {
    const results = [];
    let i = 0;
    await Promise.all(
      Array.from({ length: conc }, async () => {
        while (i < apps.length) {
          const app = apps[i++];
          console.log(`▶ [${k}/${repeat}] ${app.id} ${app.url}`);
          const r = await benchOne(app, { acMode, runTag: `r${k}` }).catch((err) => ({ app: app.id, acMode, error: String(err?.message ?? err).slice(0, 300) }));
          results.push(r);
          console.log(`  [${k}/${repeat}] ${app.id}: ${r.decision ?? r.error} side=${r.side} match=${r.match} opposite=${r.opposite} must=${(r.mustIdentified ?? []).join(",")}/${(r.mustFailedExpected ?? []).join(",")} $${costOfResult(r) ?? "?"} ${r.durationSec}s`);
        }
      }),
    );
    const ordered = apps.map((a) => results.find((r) => r.app === a.id)).filter(Boolean);
    const summary = { label, acMode, run: k, ...summarize(apps, ordered) };
    runs.push(summary);
    runsFull.push({ results: ordered });
    const file = join(here, `agent-bench1-local-result-${stamp}-r${k}.json`);
    writeFileSync(file, JSON.stringify({ label, acMode, prompt: REGISTERED_PROMPT, run: k, summary, results: ordered }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    console.log(`saved: ${file}`);
  }
  // 두 층: 질문 동일성(AC 목록이 런마다 같은가 — 주입 모드는 구성으로 보장, 추론 모드는 측정) · 판정 동일성(같은 AC의 status).
  const compare = compareRuns(runsFull);
  const aggFile = join(here, `agent-bench1-local-aggregate-${stamp}.json`);
  writeFileSync(aggFile, JSON.stringify({ label, acMode, repeat, concurrency: conc, runs, aggregate: aggregate(runs), compare }, null, 2));
  console.log(JSON.stringify({ ...aggregate(runs), compare: compare.totals }, null, 2));
  console.log(`saved: ${aggFile}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
