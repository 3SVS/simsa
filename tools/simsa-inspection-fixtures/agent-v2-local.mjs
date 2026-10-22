/**
 * agent-v2-local.mjs — 검사 엔진 v2 S4d 로컬 실측 하네스 (2026-10-21).
 *
 * 픽스처 F1~F14(eval-run.mjs와 같은 대상·정답)에 v2 실행기(runAgentV2Inspection)를 **실제 Chromium + 실제 모델**로 돌린다.
 * 모델: 로컬엔 Anthropic 키가 없어 OpenAI 최상위 후보(기본 gpt-5.6-sol, V2_MODEL로 바꿈)로 직접 부른다 — 프로덕션 V-5 후보
 * (Fable 5.1·Opus 5.5)와 다르다는 것을 결과에 적는다. 토큰을 런마다 기록한다(V-6).
 *
 * 사용: node tools/simsa-inspection-fixtures/agent-v2-local.mjs [--only=F3,F1] [--steps=16]
 * 필요: OPENAI_API_KEY, tools/simsa-completion-loop-spike/node_modules/playwright, central-plane dist 빌드.
 */
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cp = join(here, "..", "..", "apps", "central-plane");
const imp = (rel) => import(pathToFileURL(join(cp, rel)).href);
const { runAgentV2Inspection } = await imp("inspector-container/agent-v2-run.mjs");
const { createPlaywrightDriver } = await imp("inspector-container/agent-driver.mjs");
const { isNoiseResource } = await imp("dist/nondev-report.js");
const { chromium } = createRequire(join(here, "..", "simsa-completion-loop-spike", "package.json"))("playwright");

const FIXTURES = process.env.FIXTURES_BASE ?? "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
// eval-run.mjs TARGETS F1~F14와 같은 대상·정답(그 파일은 실행 스크립트라 가져올 수 없어 복사 — 바꾸면 둘 다).
export const V2_TARGETS = [
  { id: "F1", url: `${FIXTURES}/working-todo`, expected: "working", intent: "할 일을 입력하고 추가 버튼을 누르면 목록에 나타나야 한다" },
  { id: "F2", url: `${FIXTURES}/noisy-working`, expected: "working", intent: "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다" },
  { id: "F3", url: `${FIXTURES}/potemkin-crm`, expected: "broken", intent: "고객 메모를 입력하고 저장을 누르면 저장된 메모가 목록에 나타나야 한다" },
  { id: "F4", url: `${FIXTURES}/js-crash`, expected: "broken", intent: "원화 금액을 입력하고 계산하기를 누르면 달러 금액이 보여야 한다" },
  { id: "F5", url: `${FIXTURES}/blank`, expected: "broken", intent: "방문자가 이 서비스가 무엇인지 화면에서 알 수 있어야 한다" },
  { id: "F6", url: `${FIXTURES}/optimistic-ghost`, expected: "broken", intent: "기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F7", url: `${FIXTURES}/heavy-site`, expected: "working", nullOk: true, intent: "기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F8", url: `${FIXTURES}/geo-gated`, expected: "working", nullOk: true, intent: "산책 기록을 입력하고 추가를 누르면 목록에 저장되어 나타나야 한다" },
  { id: "F9", url: `${FIXTURES}/http-404`, expected: "broken", intent: "방문자가 앱 화면을 열어 서비스를 쓸 수 있어야 한다" },
  { id: "F10", url: `${FIXTURES}/canned-result`, expected: "broken", intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F11", url: `${FIXTURES}/self-checklist`, expected: "broken", intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F12", url: `${FIXTURES}/real-echo-checker`, expected: "working", nullOk: true, intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F13", url: `${FIXTURES}/needs-api-key`, expected: "broken", nullOk: true, intent: "사용자가 자기 서비스 주소를 넣으면 실제로 열어 보고 작동 여부를 검토해 알려줘야 한다" },
  { id: "F14", url: `${FIXTURES}/static-site/`, expected: "broken", intent: "방문자가 앱 첫 화면을 열어 서비스를 쓸 수 있어야 한다" },
];

function arg(name, dflt) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
}

const MODEL = process.env.V2_MODEL ?? "gpt-5.6-sol";
function openAiLlm(usage) {
  return async ({ system, user, maxTokens }) => {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_completion_tokens: Math.max(maxTokens ?? 900, 1500), messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`llm ${r.status} ${JSON.stringify(j.error ?? {}).slice(0, 120)}`);
    usage.in += j.usage?.prompt_tokens ?? 0;
    usage.out += j.usage?.completion_tokens ?? 0;
    const text = j.choices?.[0]?.message?.content ?? "";
    if (process.env.V2_DEBUG) console.error(`--- llm reply (${j.choices?.[0]?.finish_reason})
${text.slice(0, 1500)}`);
    return text;
  };
}

/** 정답 대조: broken → Needs Fix가 정답, working → Ready가 정답(Not Verified는 부분, nullOk면 통과). 반대 = 정반대 판정. */
export function scoreV2(expected, decision, nullOk = false) {
  const said = decision === "Needs Fix" ? "broken" : decision === "Ready" ? "working" : null;
  if (said === null) return nullOk ? "pass" : "partial";
  return said === expected ? "pass" : "opposite";
}

const only = arg("only", "").split(",").filter(Boolean);
const steps = Number(arg("steps", "16"));
const targets = only.length ? V2_TARGETS.filter((t) => only.includes(t.id)) : V2_TARGETS;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const kstStart = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const rows = [];
for (const t of targets) {
  const usage = { in: 0, out: 0 };
  const outDir = mkdtempSync(join(tmpdir(), `v2-${t.id}-`));
  const phases = [];
  const started = Date.now();
  let row;
  let driver = null;
  try {
    driver = await createPlaywrightDriver({ outDir, locale: "ko", isNoiseResource, chromium });
    const ac = { id: "CORE-1", title: t.intent, given: "앱을 처음 연다", when: "앱의 핵심 일을 처음부터 끝까지 해 본다", then: t.intent, priority: "must", confirmed: true };
    const r = await runAgentV2Inspection({ targetUrl: t.url, intent: t.intent, locale: "ko", acs: [ac], llm: openAiLlm(usage), driver, budgetMs: 6 * 60_000, maxStepsPerAc: steps, testDataSeed: 4242, onPhase: (l) => phases.push(l) });
    row = {
      id: t.id, expected: t.expected, decision: r.decision, score: scoreV2(t.expected, r.decision, t.nullOk),
      entry: r.entry?.broken ?? null, facts: (r.facts ?? []).map((f) => `${f.rule}:${f.cls}`), hypotheses: (r.plan?.hypotheses ?? []).map((h) => `${h.id}:${h.cls}`),
      verdicts: r.verdicts.map((v) => ({ acId: v.acId, verdict: v.verdict, claim: v.claim, reasons: v.reasons, artifactIds: v.artifactIds, quotes: v.quotes })),
      artifacts: r.artifacts?.artifacts?.length ?? 0, llmCalls: r.llmCalls?.n ?? 0, tokens: usage, seconds: Math.round((Date.now() - started) / 1000), phases,
    };
  } catch (err) {
    row = { id: t.id, expected: t.expected, error: String(err?.message ?? err).slice(0, 200), tokens: usage, phases };
  } finally {
    await driver?.close();
    rmSync(outDir, { recursive: true, force: true });
  }
  rows.push(row);
  console.log(`${t.id} expected=${t.expected} decision=${row.decision ?? "ERR"} score=${row.score ?? "error"} calls=${row.llmCalls ?? 0} tokens=${usage.in}/${usage.out} ${row.seconds ?? "?"}s ${row.error ?? ""}`);
}
const summary = {
  pass: rows.filter((r) => r.score === "pass").length,
  partial: rows.filter((r) => r.score === "partial").length,
  opposite: rows.filter((r) => r.score === "opposite").length,
  errors: rows.filter((r) => r.error).length,
  tokens: rows.reduce((s, r) => ({ in: s.in + (r.tokens?.in ?? 0), out: s.out + (r.tokens?.out ?? 0) }), { in: 0, out: 0 }),
};
const file = join(here, `agent-v2-local-result-${stamp}.json`);
writeFileSync(file, JSON.stringify({ label: `v2 로컬(브랜치 코드) — 모델 ${MODEL}(OpenAI 직접, 프로덕션 V-5 후보 아님)`, kstStart, model: MODEL, steps, summary, rows }, null, 1));
console.log(JSON.stringify(summary), "→", file);
process.exit(0); // 남은 핸들(브라우저 등)로 프로세스가 안 끝나 다음 묶음이 막히던 문제(2026-10-22)
