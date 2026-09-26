// Stage 269: pure repair-flow helpers for the "[고치기]" button on a visual
// check report (Stage 268 backend: POST/GET …/visual-checks/:runId/repair).
//
// PURE — no LLM, no network, no timers, no token/userKey storage. The report
// detail page derives button visibility, polling cadence and error copy keys
// from these helpers; all user-facing copy stays in the dictionary
// (t.visualChecks.repair.*). Mirrors visual-check-run-state.mjs conventions.

/** Poll cadence while a repair job is still queued or running. */
export const REPAIR_POLL_INTERVAL_MS = 5000;

/**
 * The "[고치기]" entry point only makes sense on a finished check that did
 * NOT verify as working (works false OR null/needs-a-closer-look). The
 * backend enforces the same gate (run_not_repairable) plus the presence of
 * the stored fix prompt — the UI stays permissive on that last detail and
 * lets the server answer.
 */
export function canRepair(check) {
  if (!check || typeof check !== "object") return false;
  return check.status === "done" && check.works !== true;
}

/**
 * Train C — C2a (재정렬 2026-09-27 §1 끊김 #4·#5, D-17 amend): which "make it
 * work" entry the report shows.
 *
 *   "repair"        — canRepair AND a code repository is linked → the Stage 269
 *                     "[고치기]" button (server repair job → PR → re-check loop).
 *   "builder_paste" — canRepair but NO linked repository (address-only apps:
 *                     Lovable / Bolt / v0 / Base44 …) → paste the builder prompt
 *                     into the tool's chat, then "check again". Linking a repo is
 *                     offered as an OPTIONAL sentence only — the default flow must
 *                     not put an external-account CTA in front of a beginner.
 *   "none"          — the run cannot be repaired at all (works, active, failed).
 *
 * `hasRepo` follows repo-settle.mjs: true = linked · false = confirmed none ·
 * null/undefined = unknown (fetch failed). Unknown resolves to the beginner
 * default (builder_paste) rather than the GitHub path — the optional sentence
 * still leads a developer to the repair route, whereas the reverse would show
 * a beginner a button that ends in "connect GitHub first".
 */
export function repairEntryMode(check, hasRepo) {
  if (!canRepair(check)) return "none";
  return hasRepo === true ? "repair" : "builder_paste";
}

/**
 * A repair job is "active" only while the backend can still move it forward:
 * queued → running → done|failed. null (no job yet), terminal statuses and
 * unknown/legacy statuses are all inactive (defensive: never poll forever on
 * a status this UI doesn't recognize).
 */
export function isRepairActive(repair) {
  if (!repair || typeof repair !== "object") return false;
  return repair.status === "queued" || repair.status === "running";
}

/**
 * Delay before the next repair status poll, or null when the job is terminal
 * (done/failed/unknown) and polling must stop.
 */
export function nextRepairPollMs(status) {
  return status === "queued" || status === "running" ? REPAIR_POLL_INTERVAL_MS : null;
}

/**
 * The backend serializes env_cause as a D1 integer — the wire value may be
 * boolean or 0|1 depending on the code path. Normalize once here so the UI
 * only ever branches on a boolean.
 */
export function isEnvCause(repair) {
  if (!repair || typeof repair !== "object") return false;
  return repair.envCause === true || repair.envCause === 1;
}

/**
 * auto_fix 성숙 (2026-07-20): classify a FAILED repair job by its stored error
 * string. The container tags access-shaped clone failures with the stable
 * `repo_access_denied:` prefix (container/coerce-result.mjs classifyCloneError)
 * — those get the non-dev "저장소가 비공개예요" guidance card instead of the
 * generic failure + raw details. Pure; unknown/absent errors → "generic".
 */
export function repairFailureKind(repair) {
  if (!repair || typeof repair !== "object" || repair.status !== "failed") return null;
  const err = typeof repair.error === "string" ? repair.error : "";
  return /^repo_access_denied\b/.test(err.trim()) ? "repoAccessDenied" : "generic";
}

/**
 * Map a backend error code (string), an HTTP status (number), or the client
 * fallback string "HTTP <status>" to a t.visualChecks.repair.errors
 * dictionary key. Unknown inputs fall back to "generic" — the UI never
 * crashes on a new backend error code.
 */
export function repairErrorKey(codeOrStatus) {
  let code = codeOrStatus;
  if (typeof code === "string") {
    const m = /^HTTP\s+(\d{3})$/i.exec(code.trim());
    if (m) code = Number(m[1]);
  }
  if (typeof code === "number") {
    if (code === 409) return "alreadyActive";
    if (code === 404) return "notFound";
    if (code === 403) return "forbidden";
    // A bare 400/500 without a JSON error code carries no more detail.
    return "generic";
  }
  switch (code) {
    case "run_not_repairable":
      return "notRepairable";
    case "github_repo_required":
      return "repoRequired";
    case "github_token_required":
      return "tokenRequired";
    case "repair_already_active":
      return "alreadyActive";
    case "run_not_found":
    case "project_not_found":
      return "notFound";
    case "forbidden":
      return "forbidden";
    default:
      return "generic";
  }
}
