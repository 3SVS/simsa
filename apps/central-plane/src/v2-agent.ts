/**
 * v2-agent.ts — 검사 엔진 v2 S4b: 실행 고리의 턴 프롬프트 · 증거물 목록 · 턴 파서 (2026-10-21).
 *
 * 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.2-4(실행: 최상급 모델이 도구로 조작, 관찰마다 가설 갱신, 화면이 안 바뀌면 같은
 * 행동을 반복하지 않음, 지어낸 주소 금지) · V-1(판정은 증거물 id 인용) · V-2·V-3(검증기 규칙을 모델에게 미리 알린다 — 통과 못 할
 * 판정을 내지 않게).
 *
 * v1(agent-inspection.ts)과 행동 어휘는 같고(드라이버 공유), **판정 형식만 다르다**: v1 `{verdict, reason, evidenceQuote}` →
 * v2 `{verdict, claim, artifactIds, quotes, reproArtifactIds}`. 행동 파싱은 v1 parseAgentAction을 그대로 쓰고, 판정은 S1
 * parseV2Verdict로 읽는다. 순수 — 의존성은 같은 패키지 모듈만.
 */
import { parseAgentAction, type AgentAc, type AgentAction, type AgentObservation } from "./agent-inspection.js";
import { parseV2Verdict, type EvidenceStore, type V2Verdict } from "./evidence-chain.js";
import type { Hypothesis } from "./v2-plan.js";

export type V2Locale = "ko" | "en";

/** v2 시스템 프롬프트 — 도구는 v1과 같고, 끝맺음(판정)은 증거물 인용 형식. */
export function v2SystemPrompt(locale: V2Locale = "ko", opts: { readOnly?: boolean } = {}): string {
  return [
    ...(opts.readOnly ? ["READ-ONLY RUN: the owner did not allow test data. Do NOT fill or submit forms. If a criterion needs creating data, judge not_verified."] : []),
    "You are Simsa's acceptance tester (engine v2). You operate a real browser on a web app built by a non-developer and decide, for ONE acceptance criterion at a time, whether the app actually does what it says.",
    "Every tool result is recorded as an EVIDENCE ARTIFACT with an id like E12 (listed under 'Evidence so far' with its kind and a summary). Your final judgement must cite those ids.",
    'Reply with exactly one JSON object and nothing else: {"thought": "<short>", "action": {...}}.',
    "Actions:",
    '- {"type":"click","target":{"role":"button","name":"예약하기"}}  (target keys: role, name, text, label, placeholder)',
    '- {"type":"fill","target":{"label":"이름"},"value":"김서연"} | {"type":"select","target":{"label":"시간"},"value":"10:30"}',
    '- {"type":"press","key":"Enter"} | {"type":"goto","path":"/admin"} (only addresses shown on screen) | {"type":"reload"} | {"type":"back"} | {"type":"wait","ms":1000}',
    '- {"type":"new_session"}   (fresh browser: a DIFFERENT customer, or the owner on another device)',
    '- {"type":"probe_storage"}   (records whether the app wrote to a server or only to this browser since the criterion started)',
    '- {"type":"judge","verdict":"pass"|"fail"|"not_verified"|"mismatch","claim":"<one plain sentence>","artifactIds":["E3","E7"],"quotes":["<text copied exactly from those artifacts>"],"reproArtifactIds":["E15"]}',
    "Judgement rules — a machine verifier enforces them; a judgement that breaks them is thrown away:",
    "V1. Cite the artifacts that show it (artifactIds) and copy 1~3 short quotes EXACTLY from those artifacts' text.",
    "V2. pass needs a STATE-CHANGE artifact among the cited ones: a server write that succeeded (2xx), a storage change, a before/after screen change, or an observation in a fresh browser / another role. Seeing labels or buttons is never a pass.",
    "V3. fail needs the SAME quote observed again in an independent repeat: redo it (e.g. in a new_session) and cite those artifacts as reproArtifactIds.",
    "V4. mismatch = the app does something different from what the user wanted (cite what it does instead). not_verified = you could not establish either way (say why in claim).",
    "Working rules:",
    "W1. Do the criterion end to end like a real user with the test data (fill every required field, choose options, submit, then look). If the app answered with a popup or message, read it and fix the input.",
    "W2. Check the listed hypotheses for this criterion with their experiments — they come from the app's own code and say what to look for.",
    "W3. If the screen did not change, do not repeat the same action — try another path. Never pay, delete other people's data, send messages or publish; cancel only a record you created (ownRecord:true).",
    "W4. Do not move the device clock yourself — time-of-day checks are run by the test runner.",
    locale === "en" ? "Write claim in English." : "Write claim in Korean (한국어, 쉬운 말).",
  ].join("\n");
}

/** 증거물 목록(최근 N개) — 모델이 인용할 id를 고르게 한다. 원문은 싣지 않고 종류·요약만(토큰 상한). */
export function artifactDigest(store: Pick<EvidenceStore, "list">, opts: { limit?: number } = {}): string {
  const limit = opts.limit ?? 25;
  const items = store.list();
  const shown = items.slice(-limit);
  const lines = shown.map((a) => {
    const m = a.meta ?? {};
    const tag = a.kind === "screen" && m.session ? `screen(${m.session})` : a.kind === "request" && m.status ? `request(${m.status})` : a.kind === "storage" ? `storage(${m.changed ? "changed" : "unchanged"})` : a.kind === "diff" ? `diff(${m.changed ? "changed" : "same"})` : a.kind;
    return `${a.id} · ${tag} · ${a.summary.replace(/\s+/g, " ").slice(0, 140)}`;
  });
  return [...(items.length > shown.length ? [`(… ${items.length - shown.length} older artifacts omitted)`] : []), ...lines].join("\n");
}

const OBS_TEXT_MAX = 3500;
const OBS_ARIA_MAX = 2500;

/** 한 턴의 사용자 메시지. */
export function v2TurnPrompt(args: {
  ac: Pick<AgentAc, "id" | "title" | "given" | "when" | "then" | "priority">;
  intent: string;
  hypotheses: readonly Pick<Hypothesis, "id" | "statement" | "experiment">[];
  observation: AgentObservation;
  evidence: string;
  history: readonly string[];
  testData: { name: string; altName: string; phone: string };
  stepsLeft: number;
  nowLabel: string;
  setupLines?: readonly string[];
}): string {
  const o = args.observation;
  return [
    `App intent: ${args.intent}`,
    `Criterion ${args.ac.id} (${args.ac.priority}): ${args.ac.title}`,
    `Given: ${args.ac.given}`,
    ...(args.setupLines ?? []),
    `When: ${args.ac.when}`,
    `Then: ${args.ac.then}`,
    ...(args.hypotheses.length
      ? [
          "Hypotheses to check for this criterion (from the app's code):",
          ...args.hypotheses.map((h) => `- ${h.id}: ${h.statement}. Experiment: ${h.experiment.steps.join(" → ")}. It is a defect if: ${h.experiment.confirmsIf}. Not a defect if: ${h.experiment.refutesIf}.`),
        ]
      : []),
    `Test data (Korean): name=${args.testData.name}, second customer=${args.testData.altName}, phone=${args.testData.phone}`,
    `Device clock now: ${args.nowLabel}. Actions left for this criterion: ${args.stepsLeft}.`,
    "",
    "Evidence so far:",
    args.evidence || "(none yet)",
    "",
    "Recent action results:",
    ...(args.history.length ? args.history.slice(-12) : ["(none)"]),
    "",
    `Current screen: ${o.url}${o.hasPasswordField ? " (has a password field)" : ""}`,
    `Text: ${o.text.slice(0, OBS_TEXT_MAX)}`,
    `Accessibility tree: ${o.aria.slice(0, OBS_ARIA_MAX)}`,
    ...(o.networkErrors.length ? [`Network errors: ${o.networkErrors.slice(-5).join(" | ")}`] : []),
    ...(o.consoleErrors.length ? [`Console errors: ${o.consoleErrors.slice(-5).join(" | ")}`] : []),
  ].join("\n");
}

export type V2Turn = { ok: true; kind: "action"; action: Exclude<AgentAction, { type: "judge" }> } | { ok: true; kind: "judge"; verdict: V2Verdict } | { ok: false; error: string };

function jsonObjectOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1));
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** 모델 한 턴을 읽는다 — 판정은 v2 형식(S1 parseV2Verdict, acId는 실행기가 붙인다), 그 밖의 행동은 v1 파서. */
export function parseV2Turn(raw: unknown, ctx: { acId: string; origin: string }): V2Turn {
  const obj = jsonObjectOf(raw);
  if (!obj) return { ok: false, error: "no_json_object" };
  const action = (obj["action"] && typeof obj["action"] === "object" ? obj["action"] : obj) as Record<string, unknown>;
  if (action["type"] === "judge") {
    const v = parseV2Verdict({ ...action, acId: ctx.acId });
    return v.ok ? { ok: true, kind: "judge", verdict: v.verdict } : { ok: false, error: `judge_${v.error}` };
  }
  if (action["type"] === "set_clock") return { ok: false, error: "set_clock_runner_only" };
  const a = parseAgentAction({ action }, ctx.origin);
  if (!a.ok) return a;
  if (a.action.type === "judge") return { ok: false, error: "judge_v1_format" };
  return { ok: true, kind: "action", action: a.action };
}
