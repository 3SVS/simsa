// Stage 269: pure repair-flow helpers for the "[고치기]" button on a visual
// check report (Stage 268 backend: POST/GET …/visual-checks/:runId/repair).
//
// PURE — no LLM, no network, no timers, no token/userKey storage. The report
// detail page derives button visibility, polling cadence and error copy keys
// from these helpers; all user-facing copy stays in the dictionary
// (t.visualChecks.repair.*). Mirrors visual-check-run-state.mjs conventions.

import { readDailyLimit } from "./daily-limit.mjs";

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
  return check.status === "done" && check.works !== true && hasSomethingToFix(check);
}

/**
 * Is there anything to fix in this finished check? (2026-09-29 live finding.)
 *
 * The same rule as the server's report next-steps (central-plane
 * nondev-report.ts `somethingToFix`, #560): a non-informational finding, OR the
 * app does not work, OR the verdict is an open one other than "no problem
 * found" (Conditionally Ready). Informational items (severity "info" — e.g.
 * third-party script noise) are never something to fix.
 *
 * Before this, a "no problem found" result with only a noise item still showed
 * the "[고치기]" card and the copy-a-fix-prompt card above a next step that
 * said "nothing needs fixing right now" — the page contradicted itself.
 * Legacy rows (no decision, no report, works null) keep the old behavior.
 *
 * @param {unknown} check
 * @returns {boolean}
 */
export function hasSomethingToFix(check) {
  if (!check || typeof check !== "object") return false;
  const c = /** @type {{ works?: unknown, decision?: unknown, report?: { findings?: unknown } | null }} */ (check);
  if (c.works === true) return false;
  if (c.works === false) return true;
  const findings = Array.isArray(c.report?.findings) ? c.report.findings : [];
  const actionable = findings.some(
    (f) => f && typeof f === "object" && /** @type {{ severity?: unknown }} */ (f).severity !== "info",
  );
  if (actionable) return true;
  return c.decision !== "Conditionally Ready";
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
 *
 * `opts.hasRepairJob` (PR #552 검증 P2): a repair job already exists for this
 * run (queued / running / done / failed). Then the entry is "repair" whatever
 * the repo fact says — before this, a failed or timed-out repo lookup (false /
 * null) replaced the card with builder-paste and the job's progress and PR
 * link vanished from the report. A job can only exist when a repository was
 * linked, so this never shows a beginner the GitHub path by accident.
 *
 * @param {{ status?: unknown, works?: unknown } | null | undefined} check
 * @param {boolean | null | undefined} hasRepo
 * @param {{ hasRepairJob?: boolean }} [opts]
 * @returns {"repair" | "builder_paste" | "none"}
 */
export function repairEntryMode(check, hasRepo, opts = {}) {
  if (!canRepair(check)) return "none";
  return hasRepo === true || opts?.hasRepairJob === true ? "repair" : "builder_paste";
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
    // A bare 400/500 without a JSON error code carries no more detail. A bare
    // 429/503 is infrastructure — never claim "today's cap" or "paused" (W-2).
    return "generic";
  }
  switch (code) {
    // Train W — W-2 (D-7 amend): per-user repair cap (429, 5/day) and the
    // REPAIR_ENABLED kill switch (503). Old servers never send these.
    case "daily_limit_reached":
      return "dailyLimitReached";
    case "repair_disabled":
      return "repairDisabled";
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

/**
 * Train W — W-2: map a whole repair-request answer (the parsed body) so the
 * daily cap's resetAt reaches the card. Same contract as runErrorNotice in
 * visual-check-run-state.mjs; the repair surface has its own copy (kind별).
 *
 * @param {unknown} res
 * @returns {{ errorKey: string, resetAt: string | null }} errorKey is a RepairErrorKey (see .d.mts)
 */
export function repairErrorNotice(res) {
  const code = res && typeof res === "object" ? /** @type {{ error?: unknown }} */ (res).error : res;
  const errorKey = repairErrorKey(code);
  const resetAt = errorKey === "dailyLimitReached" ? (readDailyLimit(res)?.resetAt ?? null) : null;
  return { errorKey, resetAt };
}

/**
 * Callout tone for a repair request error: today's cap and a paused service
 * are information, not the reader's mistake.
 *
 * @param {string} key
 * @returns {"info" | "error"}
 */
export function repairErrorTone(key) {
  return key === "dailyLimitReached" || key === "repairDisabled" ? "info" : "error";
}

/**
 * Train W — W-3 ③ (재정렬 §1 #7, D-4 keep: a label, not a gate). The repair
 * container's only post-apply check is `node --check` on .js/.mjs; the server
 * reports `buildVerified:false` when the change touched anything else (ts,
 * tsx, css, json, html …). Show the one-line "we couldn't confirm the fixed
 * code builds" ONLY on an explicit false from a job that really changed code:
 *   - true  → verified by that check → nothing to say
 *   - null  → legacy / undecidable  → nothing to say (no guess)
 *   - absent (old server)           → nothing to say
 *
 * Contract (server ↔ dashboard, #558 검증 P2-2·P2-13): buildVerified is about
 * the code the repair changed — computed over `autoFix.changedFiles` only
 * (SIMSA-FIX-BRIEF.md, committed alongside, is excluded); a `brief_only` job
 * changed no code → `buildVerified: null`. The dashboard uses the SAME test as
 * repairDoneKind (`mode === "auto_fix"`), so the build line never appears on a
 * card whose done copy says "code was not changed" (mode null/unknown included).
 *
 * @param {{ status?: unknown, mode?: unknown, buildVerified?: unknown } | null | undefined} repair
 * @returns {boolean}
 */
export function showBuildUnverified(repair) {
  if (!repair || typeof repair !== "object") return false;
  if (repair.status !== "done") return false;
  if (repairDoneKind(repair) !== "autoFix") return false;
  return repair.buildVerified === false;
}

/**
 * Which "done" copy the repair card shows. Since Stage 270 a repair either
 * applied real code changes (`mode: "auto_fix"`, non-draft PR) or fell back to
 * the Stage 268 fix-brief draft PR (`brief_only`). The card used to say "code
 * changes are not applied automatically yet" for both — false for auto_fix,
 * and it would contradict the build line. Legacy rows (null) and unknown
 * values predate auto_fix → the brief copy.
 *
 * @param {{ mode?: unknown } | null | undefined} repair
 * @returns {"autoFix" | "briefOnly"}
 */
export function repairDoneKind(repair) {
  return repair && typeof repair === "object" && repair.mode === "auto_fix" ? "autoFix" : "briefOnly";
}
