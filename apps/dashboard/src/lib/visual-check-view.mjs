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
  // ★2026-09-01: `decision`을 받아놓고 쓰지 않아, **"문제를 찾지 못했어요"와
  //  "확인 못 했어요"가 똑같이 "확인 필요" 칩**으로 나왔다. 리포트는 한 말을 하고
  //  칩은 다른 말을 하는 상태였다(8/26 중간 판정을 넣으면서 생긴 모순).
  //
  //  둘은 사용자에게 완전히 다른 소식이다: 하나는 "따라가 봤는데 문제가 없었다",
  //  다른 하나는 "따라가 보지도 못했다". 색도 달라야 한다 — 다만 초록(작동 확인)은
  //  아니다. 우리는 확인한 게 아니라 **못 찾은** 것이다.
  if (decision === "Conditionally Ready") {
    return { label: t.visualChecks.worksNoProblems, tone: "clear" };
  }
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
    // 소스로 붙인 저장소도 "알고 있다"에 포함한다 — AF-1이 저장하는 형태다.
    if (f.hasRepoSource === true) return "need_url";
    if (f.hasRepo === false) return "connect";
    if (f.hasRepo == null) return "wait";
    // AF-1 (2026-08-23): 저장소만 연결된 상태. 종전엔 여기서 "run"을 줬는데,
    // 화면 검수는 **앱 주소가 있어야** 돌아간다 — 그래서 사용자는 "첫 검수
    // 돌려보기"를 눌러 갔다가 **비활성 버튼**을 만났다(막다른 골목).
    //
    // 제출물-우선 진입으로 "저장소만 넣기"가 흔한 시작점이 되면서 이 경로가
    // 정문이 됐으므로, 문을 따로 판다: 코드는 연결됐고 화면 검수를 하려면
    // 주소가 더 필요하다고 **정확히** 말한다.
    return "need_url";
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

/**
 * ★AF-5 (설계 D-4) — 지금 검수가 **어느 깊이**인지, 그래서 **무엇을 못 봤는지**.
 *
 * 이 표기는 장식이 아니라 **정직성 요건**이다. 검수 러너에는 로그인 기능이 아예
 * 없다(랜딩에서 안전한 CTA를 골라 눌러보는 결정론적 플로우). 즉 **로그인 뒤 화면은
 * 보지 못한다** — 이건 제출물-우선 진입이 만든 한계가 아니라 원래 있던 한계이고,
 * 앱 주소가 정문이 되면서 정면에 드러날 뿐이다.
 *
 * 한계를 없애는 척하지 않고, 몇 단인지와 다음 단으로 가는 법을 말한다:
 *   L1 공개 표면  앱 주소 하나        페이지 로드·에러·공개 화면의 동작
 *   L2 코드 열람  + GitHub 저장소     로그인 뒤 로직·설정·의존성(정적 판독)
 *   L3 로그인 통과 + 테스트 계정       — **아직 구현하지 않았다**(D-5 미결)
 *
 * @returns {{level: 1|2, hasUrl: boolean, hasRepo: boolean, nextStep: "add_url"|"add_repo"|null}}
 */
export function inspectionDepth(facts) {
  const f = facts ?? {};
  const hasUrl = f.hasDeployUrl === true;
  // 코드를 **읽는 데**는 링크가 필요 없다(공개 저장소는 토큰 없이 읽힌다).
  const hasRepo = f.hasRepo === true || f.hasRepoSource === true;
  // 코드까지 읽을 수 있으면 L2. 주소만 있으면 L1.
  const level = hasRepo ? 2 : 1;
  // 다음 한 걸음만 제안한다 — 둘 다 없으면 화면 검수가 먼저다(볼 것이 생긴다).
  const nextStep = !hasUrl ? "add_url" : !hasRepo ? "add_repo" : null;
  return { level, hasUrl, hasRepo, nextStep };
}
