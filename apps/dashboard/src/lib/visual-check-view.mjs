// Stage 262: pure view helpers for the Simsa visual-check (시각 검수) pages.
// Stage 272 adds the project-overview helpers: overviewNextAction (the single
// next action a non-developer should take) and relativeTimeLabel.
//
// PURE — no LLM, no network, no randomness, no token/userKey storage. All
// user-facing labels come from the injected dictionary (t), so the output
// follows the UI language. NO numeric scores anywhere (Simsa policy).

import { isActiveStatus } from "./visual-check-run-state.mjs";

/**
 * Map a run's works flag (true / false / null) to the localized verdict label
 * and the brand status tone. `works` is authoritative: the backend derives it
 * from the inspection outcome. `decision` (a short free-form string) is kept
 * in the signature for forward compatibility but never overrides `works`.
 *
 * works true  → 작동해요        → tone "passed"
 * works false → 작동 안 해요     → tone "failed"
 * works null  → 확인 필요        → tone "inconclusive"
 */
export function verdictLabel(works, decision, t) {
  if (works === true) return { label: t.visualChecks.worksYes, tone: "passed" };
  if (works === false) return { label: t.visualChecks.worksNo, tone: "failed" };
  return { label: t.visualChecks.worksUnknown, tone: "inconclusive" };
}

/** Localized label for a finding severity. Unknown severities fall through raw. */
export function severityLabel(severity, t) {
  if (severity === "high") return t.visualChecks.severityHigh;
  if (severity === "medium") return t.visualChecks.severityMedium;
  if (severity === "low") return t.visualChecks.severityLow;
  if (severity === "info") return t.visualChecks.severityInfo;
  return String(severity ?? "");
}

/** Brand status tone for a finding severity chip (colors carry meaning only). */
export function severityTone(severity) {
  if (severity === "high") return "failed";
  if (severity === "medium") return "inconclusive";
  return "decision";
}

/**
 * Split a run's evidence key manifest into screenshots (sorted, so step-00,
 * step-01… render in capture order) and the single flow video (or null).
 * Non-string / unknown-prefixed entries are dropped defensively.
 */
export function splitEvidenceKeys(keys) {
  const list = Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : [];
  const screenshots = list.filter((k) => k.startsWith("screenshots/")).sort();
  const video = list.find((k) => k.startsWith("video/")) ?? null;
  return { screenshots, video };
}

/**
 * Build the evidence file URL served by the central plane. The evidence name
 * keeps its `/` path separator (the backend route is a wildcard) but each
 * segment — and every id + the userKey — is URI-encoded.
 */
/**
 * Stage 272 — the single next action the project-overview inspection card
 * should offer, derived from the run list (any order; sorted here by
 * createdAt, newest first). Returns exactly one of:
 *
 *   { kind: "runFirst" }                 — no runs yet → "첫 검수 실행하기"
 *   { kind: "inProgress", runId }        — a queued/running run exists (the
 *                                          most recent one wins) → "진행 중"
 *   { kind: "viewReport", runId }        — the latest run needs attention:
 *                                          status failed, works=false, or a
 *                                          done run that could not verify
 *                                          (works=null) → "리포트 보기"
 *   { kind: "viewLatest", runId }        — the latest run verified working
 *
 * Defensive: non-array input and rows without a string id are dropped, so a
 * partial/legacy list can never crash the overview card.
 */
export function overviewNextAction(checks) {
  const list = Array.isArray(checks)
    ? checks.filter((c) => c && typeof c === "object" && typeof c.id === "string")
    : [];
  if (list.length === 0) return { kind: "runFirst" };
  const sorted = [...list].sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
  const active = sorted.find((c) => isActiveStatus(c.status));
  if (active) return { kind: "inProgress", runId: active.id };
  const latest = sorted[0];
  if (latest.status === "failed" || latest.works !== true) {
    return { kind: "viewReport", runId: latest.id };
  }
  return { kind: "viewLatest", runId: latest.id };
}

/**
 * Journey-audit P2 (2026-07-20) — which door the overview inspection card's
 * EMPTY state offers. On the CODE branch with the repo CONFIRMED absent and
 * no deploy URL, "run your first inspection" points at the URL-based door the
 * user can't use yet — walk them to connect first instead.
 *
 * v2 기준선 (2026-07-21): on the code branch an UNKNOWN repo fact must not
 * render the default door either — the baseline caught the card showing
 * "run" for ~2s then flipping to "connect" once the repo fetch settled
 * (실측 스크린샷). A CTA that flips is worse than a moment without one
 * (same principle as nextProjectAction). So code + hasRepo null → "wait"
 * (caller renders nothing until the fact settles). Non-code branches keep
 * the default door on unknowns — their door never depends on the repo fact.
 *
 * @param {{ entryPath?: "idea" | "code" | "spec" | null, hasRepo?: boolean | null, hasDeployUrl?: boolean | null }} facts
 * @returns {"connect" | "run" | "wait"}
 */
export function inspectionEmptyStateDoor(facts) {
  const f = facts ?? {};
  if (f.entryPath === "code" && f.hasDeployUrl !== true) {
    if (f.hasRepo === false) return "connect";
    if (f.hasRepo == null) return "wait";
  }
  return "run";
}

/**
 * Stage 272 — localized "3 minutes ago"-style label for the overview card.
 * `now` is injectable for deterministic tests. Unparseable dates return ""
 * (the card simply omits the timestamp).
 */
export function relativeTimeLabel(iso, locale, now = Date.now()) {
  const ts = Date.parse(String(iso ?? ""));
  if (Number.isNaN(ts)) return "";
  const rtf = new Intl.RelativeTimeFormat(locale === "ko" ? "ko" : "en", { numeric: "auto" });
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.trunc(diffSec / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.trunc(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.trunc(diffSec / (86400 * 365)), "year");
}

export function buildEvidenceUrl(base, projectId, runId, name, userKey) {
  const trimmedBase = String(base ?? "").replace(/\/+$/, "");
  const encodedName = String(name ?? "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return (
    `${trimmedBase}/workspace/projects/${encodeURIComponent(projectId)}` +
    `/visual-checks/${encodeURIComponent(runId)}/evidence/${encodedName}` +
    `?userKey=${encodeURIComponent(userKey)}`
  );
}
