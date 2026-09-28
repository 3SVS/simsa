// Stage 264: pure run-state helpers for one-click visual inspection runs.
//
// PURE — no LLM, no network, no timers, no token/userKey storage. The UI
// (visual-checks list + report detail) derives polling and button behavior
// from these helpers; all user-facing copy stays in the dictionary.

import { readDailyLimit } from "./daily-limit.mjs";

/** Poll cadence while a run is still queued or running. */
export const RUN_POLL_INTERVAL_MS = 5000;

/**
 * A run is "active" only while the backend can still move it forward:
 * queued → running → done|failed. Anything else — done, failed, or an
 * unknown/legacy status — is treated as terminal (defensive: never poll
 * forever on a status this UI doesn't recognize).
 */
export function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

/**
 * Delay before the next status poll, or null when the run is terminal
 * (done/failed/unknown) and polling must stop.
 */
export function nextPollDelayMs(status) {
  return isActiveStatus(status) ? RUN_POLL_INTERVAL_MS : null;
}

/**
 * Run-button availability. An active run wins over a missing website source
 * (the backend enforces one active run per project — 409 run_already_active).
 * reasonKey indexes into t.visualChecks.runErrors; null when enabled.
 */
export function runButtonState({ hasWebsiteSource, hasActiveRun } = {}) {
  if (hasActiveRun) return { disabled: true, reasonKey: "runAlreadyActive" };
  if (!hasWebsiteSource) return { disabled: true, reasonKey: "websiteSourceRequired" };
  return { disabled: false, reasonKey: null };
}

/**
 * Map a backend error code (string), an HTTP status (number), or the client
 * fallback string "HTTP <status>" to a t.visualChecks.runErrors dictionary
 * key. Unknown inputs fall back to "generic" — the UI never crashes on a new
 * backend error code.
 */
export function mapRunError(codeOrStatus) {
  let code = codeOrStatus;
  if (typeof code === "string") {
    const m = /^HTTP\s+(\d{3})$/i.exec(code.trim());
    if (m) code = Number(m[1]);
  }
  if (typeof code === "number") {
    if (code === 409) return "runAlreadyActive";
    if (code === 404) return "projectNotFound";
    if (code === 403) return "forbidden";
    // A bare 400/500 without a JSON error code carries no more detail. A bare
    // 429/503 (no JSON body) is infrastructure, not our Train W answer — it
    // must not claim "today's cap" or "we paused checks" (W-2).
    return "generic";
  }
  switch (code) {
    // Train W — W-2 (D-7 amend): per-user daily cap (429) and the
    // INSPECTION_ENABLED kill switch (503). Old servers never send these.
    case "daily_limit_reached":
      return "dailyLimitReached";
    case "inspection_disabled":
      return "inspectionDisabled";
    case "website_source_required":
      return "websiteSourceRequired";
    case "run_already_active":
      return "runAlreadyActive";
    case "project_not_found":
      return "projectNotFound";
    case "forbidden":
      return "forbidden";
    case "invalid_intent":
      return "invalidIntent";
    default:
      return "generic";
  }
}

/**
 * Train W — W-2: map a whole inspection-request answer (the parsed body, not
 * just its code) so the daily cap's resetAt reaches the screen. resetAt is
 * carried only for the daily cap and only when it is a valid timestamp
 * (readDailyLimit validates the wire value); everything else is null.
 * Old servers / network failures / garbage → { errorKey: "generic" }.
 *
 * @param {unknown} res
 * @returns {{ errorKey: string, resetAt: string | null }} errorKey is a RunErrorKey (see .d.mts)
 */
export function runErrorNotice(res) {
  const code = res && typeof res === "object" ? /** @type {{ error?: unknown }} */ (res).error : res;
  const errorKey = mapRunError(code);
  const resetAt = errorKey === "dailyLimitReached" ? (readDailyLimit(res)?.resetAt ?? null) : null;
  return { errorKey, resetAt };
}

/**
 * Callout tone for a run error. Being capped for today, a paused service, an
 * inspection already running or a missing website address are not the
 * reader's mistake — they read as information, not as a red error.
 *
 * @param {string} key
 * @returns {"info" | "error"}
 */
export function runErrorTone(key) {
  return key === "dailyLimitReached" ||
    key === "inspectionDisabled" ||
    key === "runAlreadyActive" ||
    key === "websiteSourceRequired"
    ? "info"
    : "error";
}

/**
 * The two answers that mean "the service said no for now" (daily cap, kill
 * switch). The new-project flow starts the first inspection automatically and
 * swallows ordinary failures (the reader can retry from the project page) —
 * but these two must be said out loud, otherwise the reader waits for a check
 * that was never started.
 *
 * @param {unknown} key
 * @returns {boolean}
 */
export function isServiceGateKey(key) {
  return key === "dailyLimitReached" || key === "inspectionDisabled";
}
