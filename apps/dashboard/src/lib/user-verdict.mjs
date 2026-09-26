// Train C — C2b (재정렬 2026-09-27 §1 끊김 #6·#12 · W1-7·W1-8; D-17·D-19 amend):
// 사람 수용 라벨(user_verdict)과 빌더용 고침 지시의 기본 선택.
//
// 북극성은 "접수 건 중 `user_verdict = as_intended`로 닫힌 건수"(D-19)다. 기계 판정
// (works/decision)과 별개로 **사람이** 결과를 어떻게 받아들였는지를 네 값으로 받는다.
// 그리고 Lovable/Bolt/v0/Replit/Base44처럼 채팅형 빌더로 만든 앱에는 CLI 에이전트용
// 지시(브랜치·터미널 전제)가 아니라 채팅창에 그대로 붙일 한 덩어리(builderPrompt)를
// 기본으로 보인다 — 붙여넣을 곳이 없는 지시는 지시가 아니다.
//
// PURE — no network, no storage. All user-facing copy stays in the dictionary
// (t.visualChecks.userVerdict.* / t.visualChecks.fixPrompt.*).

/** The four human acceptance labels, in display order (contract 2 — Zod enum on the server). */
export const USER_VERDICT_OPTIONS = ["as_intended", "works_but_different", "still_broken", "unsure"];

/** Canonical built-with ids whose users paste into a chat, not a terminal. */
export const WEB_BUILDER_TOOLS = ["lovable", "bolt", "v0", "replit", "base44"];

/**
 * Server value → one of the four verdicts, or null. Old servers return no field
 * at all; a typo'd/unknown value must never render as a selected option.
 * @param {unknown} raw
 * @returns {"as_intended" | "works_but_different" | "still_broken" | "unsure" | null}
 */
export function normalizeUserVerdict(raw) {
  return typeof raw === "string" && USER_VERDICT_OPTIONS.includes(raw) ? raw : null;
}

/**
 * Display label for a verdict from the dictionary (never hard-coded here).
 * @param {"as_intended" | "works_but_different" | "still_broken" | "unsure"} verdict
 * @param {{ visualChecks: { userVerdict: { options: Record<string, string> } } }} t
 * @returns {string}
 */
export function userVerdictLabel(verdict, t) {
  return t.visualChecks.userVerdict.options[verdict] ?? verdict;
}

/**
 * Accepts the two shapes built_with is stored in: the local `builtWithTools`
 * string[] and the server `{ tools: string[] }` object. Anything else → [].
 * @param {unknown} builtWith
 * @returns {string[]}
 */
function builtWithIds(builtWith) {
  const list = Array.isArray(builtWith)
    ? builtWith
    : builtWith && typeof builtWith === "object" && Array.isArray(/** @type {any} */ (builtWith).tools)
      ? /** @type {any} */ (builtWith).tools
      : [];
  return list.filter((x) => typeof x === "string").map((x) => x.trim().toLowerCase());
}

/**
 * Which fix-instruction format to show first (contract 3).
 *   - any web builder in built_with AND the report carries builderPrompt → "web_builder"
 *   - otherwise → "cli" (the pre-Train-C default; old runs without builderPrompt stay as they were)
 * @param {unknown} builtWith string[] | { tools: string[] } | undefined
 * @param {boolean} hasBuilderPrompt
 * @returns {"web_builder" | "cli"}
 */
export function pickDefaultPromptTarget(builtWith, hasBuilderPrompt) {
  if (!hasBuilderPrompt) return "cli";
  return builtWithIds(builtWith).some((id) => WEB_BUILDER_TOOLS.includes(id)) ? "web_builder" : "cli";
}

/**
 * The prompt text for a target, or null when the run has none of that kind.
 * @param {{ agentPrompt?: unknown, report?: { builderPrompt?: unknown } | null } | null | undefined} check
 * @param {"web_builder" | "cli"} target
 * @returns {string | null}
 */
export function fixPromptFor(check, target) {
  if (!check || typeof check !== "object") return null;
  const raw = target === "web_builder" ? check.report?.builderPrompt : check.agentPrompt;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/**
 * Targets this run can actually show, builder first (the toggle only renders
 * when there are two).
 * @param {{ agentPrompt?: unknown, report?: { builderPrompt?: unknown } | null } | null | undefined} check
 * @returns {Array<"web_builder" | "cli">}
 */
export function availablePromptTargets(check) {
  /** @type {Array<"web_builder" | "cli">} */
  const out = [];
  if (fixPromptFor(check, "web_builder")) out.push("web_builder");
  if (fixPromptFor(check, "cli")) out.push("cli");
  return out;
}
