// Stage 262: pure view helpers for the Simsa visual-check (시각 검수) pages.
//
// PURE — no LLM, no network, no randomness, no token/userKey storage. All
// user-facing labels come from the injected dictionary (t), so the output
// follows the UI language. NO numeric scores anywhere (Simsa policy).

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
