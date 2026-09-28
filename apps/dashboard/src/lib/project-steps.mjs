/**
 * project-steps.mjs — the 3-step progress map's state machine (pure).
 *
 * The flow skeleton is 준비 → 검수 → 결과·수정. This computes each step's status
 * from observed project facts so the sidebar can render checked / current /
 * locked — the two invariants that kill wandering and rework:
 *
 *  - LOCKING: a step whose precondition is CONFIRMED unmet is locked (dimmed +
 *    hint). Unknown facts (null — fetch pending or failed) NEVER lock: a wrong
 *    lock blocks a user, a briefly-missing lock just shows plain nav (fail-open).
 *  - AUTO-CHECK: done is DERIVED from data ("repo already connected" → step 2
 *    partially satisfied), never from user ceremony — revisiting a done step
 *    never demands rework.
 *
 * Pure + deterministic so both invariants are test-fixed.
 */

/** @typedef {"done" | "current" | "todo" | "locked"} StepStatus */

/**
 * ★기존 앱 여정 (2026-09-28 Bae 라이브 신고).
 *
 * 저장소가 연결된 복원 프로젝트에서 개요의 "첫 검수 실행하기"가 PR 코드 리뷰(/github)로
 * 보냈고, 0개 PR 화면에서 여정이 멈췄다. 비개발자 빌더(Lovable·Bolt·v0·Replit)는 PR을
 * 거의 만들지 않으므로 0 PR은 정상 상태다 — 막다른 길은 제품 쪽 결함이다.
 *
 * 원칙(재정렬 2026-09-27, D-17 amend): 기본 "확인"은 **실제 앱을 브라우저로 여는 검수**
 * (visual check)다. PR 리뷰는 개발자 도구이고, 코드 연결은 기존 앱 문에서 선택 단계다.
 *
 * "앱이 있다"는 갈래(entryPath)만으로 정하지 않는다: 복원된 프로젝트는 entryPath를
 * 모르면 "idea"로 채워지므로(project-restore.mjs), 저장소·주소 사실을 함께 본다.
 *
 * @param {{ entryPath?: "idea" | "code" | "spec" | null, hasRepo?: boolean | null, hasRepoSource?: boolean | null, hasDeployUrl?: boolean | null } | null | undefined} facts
 * @returns {boolean} 모르는 사실(null)은 "없음"으로 본다 — 종전 라벨·흐름을 유지한다.
 */
export function projectHasApp(facts) {
  const f = facts ?? {};
  return f.entryPath === "code" || f.hasRepo === true || f.hasRepoSource === true || f.hasDeployUrl === true;
}

/**
 * "한 번이라도 확인했는가" — 실제 앱 확인 런 ≥1 **또는** PR 리뷰 런 ≥1.
 *
 * 종전엔 PR 리뷰 이력만 셌다. 그래서 실제 앱 확인을 끝낸 사람에게도 개요가 계속
 * "첫 검수"를 권했다. 두 조회 중 하나라도 실패(null)면 사실 자체가 null이다
 * (fail-open: 모르는 것으로 CTA를 만들지 않는다).
 *
 * `hasVisualCheck`를 아예 넘기지 않는(undefined) 호출자는 PR 리뷰만 추적하던 종전
 * 계약으로 본다 — 두 화면(개요·사이드바)은 둘 다 넘긴다.
 *
 * @param {{ hasReviewRun?: boolean | null, hasVisualCheck?: boolean | null }} f
 * @returns {boolean | null}
 */
function checkedFact(f) {
  const pr = f.hasReviewRun;
  const vc = f.hasVisualCheck;
  if (vc === undefined) return pr === true ? true : pr === false ? false : null;
  if (pr !== true && pr !== false) return null;
  if (vc !== true && vc !== false) return null;
  return pr || vc;
}

/**
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasVisualCheck?: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 *   null = unknown (loading or fetch failed) — treated as "not confirmed", never locks.
 *   hasVisualCheck: at least one real-app check (visual check) exists. Together
 *   with hasReviewRun (PR review) it decides "the project has been checked".
 *   entryPath: the branch this project entered through. For the CODE branch the
 *   prepare step is OPTIONAL by design (the user skipped the idea step — that is
 *   the branch's normal path, not a deficit): prepare renders as optional, and
 *   review NEVER locks on missing items.
 *   hasDeployUrl: whether a deployed-app URL (website source) is connected. On
 *   the BUILDER (non-code) path this is the alternative to a repo — a non-dev who
 *   built the app elsewhere attaches a deploy URL and gets a URL-based visual
 *   check, so results never dead-end on "connect GitHub".
 * @returns {Array<{ key: "prepare" | "review" | "results", status: StepStatus, lockReason: "need_items" | "need_code" | "need_build" | null, optional: boolean }>}
 */
export function computeProjectSteps(facts) {
  const f = facts ?? {};
  const hasItems = f.hasItems === true;
  const noItems = f.hasItems === false; // confirmed absent — only this locks
  const hasRepo = f.hasRepo === true;
  const hasRepoSource = f.hasRepoSource === true;
  const hasDeployUrl = f.hasDeployUrl === true;
  const hasVisualCheck = f.hasVisualCheck === true;
  const hasRun = checkedFact(f) === true;
  const codeEntry = f.entryPath === "code";
  // The app already exists (code branch, or a repo/URL is known) — then the
  // idea-side preparation is optional and never gates checking the app.
  const hasApp = projectHasApp(f);

  // Step 1 — 준비 (idea / spec / items). Always accessible. Optional on the
  // code branch (skipping it is that branch's normal path, never a red mark).
  const prepareDone = hasItems;

  // A project is "connected" for review/results once EITHER its code (repo) or
  // its deployed app (URL) is attached. GitHub is the developer door; a builder
  // who made the app elsewhere attaches a deploy URL instead. A real-app check
  // that already ran proves a URL was attached (callers like the sidebar may
  // not pass the URL fact).
  const connected = hasRepo || hasRepoSource || hasDeployUrl || hasVisualCheck;

  // Step 2 — 검수 (connect code/URL / run review). Locked only when items are
  // CONFIRMED missing — except when the app already exists, where no-items is
  // normal (a real-app check needs no checklist).
  // Done when something is connected AND a check (real-app or PR) has run.
  const reviewLocked = noItems && !hasApp;
  const reviewDone = connected && hasRun;

  // Step 3 — 결과·수정. Locked only when the project is CONFIRMED to have neither
  // a repo nor a deploy URL. On the code branch the guidance is "connect your
  // repo" (need_code); on the builder branch it's "get the pack, build, connect
  // your URL" (need_build) — never a GitHub dead end. Unknown deploy-url on the
  // builder branch stays fail-open (no lock). On the code branch a known URL or
  // repo source also unlocks — code linking is optional there (D-17 amend).
  const resultsLocked = codeEntry
    ? f.hasRepo === false && !hasRepoSource && !hasDeployUrl && !hasVisualCheck
    : f.hasRepo === false && f.hasDeployUrl === false && !hasRepoSource && !hasVisualCheck;

  // When the app exists, prepare is never "current" (the flow starts at
  // checking the app): it shows as done when items exist, otherwise as a
  // neutral optional todo.
  const prepareStatus = prepareDone ? "done" : hasApp ? "todo" : "current";
  const prepare = {
    key: /** @type {const} */ ("prepare"),
    status: /** @type {StepStatus} */ (prepareStatus),
    lockReason: null,
    optional: hasApp,
  };

  let reviewStatus;
  if (reviewLocked) reviewStatus = "locked";
  else if (reviewDone) reviewStatus = "done";
  else reviewStatus = prepareDone || hasApp ? "current" : "todo";
  const review = {
    key: /** @type {const} */ ("review"),
    status: /** @type {StepStatus} */ (reviewStatus),
    lockReason: reviewLocked ? /** @type {const} */ ("need_items") : null,
    optional: false,
  };

  let resultsStatus;
  if (resultsLocked) resultsStatus = "locked";
  else if (reviewDone) resultsStatus = "current";
  else resultsStatus = "todo";
  const results = {
    key: /** @type {const} */ ("results"),
    status: /** @type {StepStatus} */ (resultsStatus),
    lockReason: resultsLocked
      ? codeEntry
        ? /** @type {const} */ ("need_code")
        : /** @type {const} */ ("need_build")
      : null,
    optional: false,
  };

  return [prepare, review, results];
}

/**
 * The command center's SINGLE next action — the shortest path to the
 * activation moment (receiving the first check result) and, after that, to
 * the working loop. Only CONFIRMED facts produce a CTA: on unknowns it returns
 * null (no CTA beats a misleading one that flips after a fetch resolves).
 *
 * ★2026-09-28 (기존 앱 여정 막다른 길) — 세 가지를 바꿨다:
 *
 *  D1. 기본 확인 = **실제 앱 확인**(visual-checks). 종전엔 저장소 링크(hasRepo)가
 *      있으면 두 갈래 모두 PR 코드 리뷰(github)로 보냈고, PR이 0개인 비개발자
 *      빌더는 거기서 멈췄다. PR 리뷰는 개발자 도구라 기본 다음 행동이 되지 않는다.
 *  D2. 앱이 있는데(코드 갈래, 저장소 링크/알려짐, 또는 주소) 앱 주소가 **확정적으로
 *      없으면** 다음 행동은 add_url — 저장소 링크 여부와 무관하다. 종전 코드 갈래는
 *      `hasRepo !== true`일 때만 add_url로 갔다. (connect_code는 이제 나오지 않는다:
 *      코드 연결은 기존 앱 문에서 선택 단계다 — D-17 amend.)
 *  D3. "확인했음" = 실제 앱 확인 런 ≥1 또는 PR 리뷰 런 ≥1(checkedFact). 결과 보기의
 *      목적지는 실제 앱 확인이 있으면 visual-checks, PR 리뷰만 있으면 checks.
 *
 * add_url의 slug("sources")는 주소를 넣을 수 있는 화면이다. 개요는 이 행동을
 * 링크가 아니라 **그 자리의 입력칸**으로 그린다(D4) — slug는 다른 소비자를 위한 폴백.
 *
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasVisualCheck?: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 * @returns {{ action: "create_items" | "connect_code" | "add_url" | "get_pack" | "run_review" | "view_results", slug: string } | null}
 */
export function nextProjectAction(facts) {
  const f = facts ?? {};

  if (!projectHasApp(f)) {
    // Builder (non-code) path with no app known yet. Only act once the app is
    // CONFIRMED absent — if a repo/URL turns up after the fetch, the right
    // action is add_url/run_review, and a CTA that flips under the cursor is
    // worse than a moment without one. (undefined = a caller that does not
    // track that fact at all — legacy contract, treated as absent.)
    const confirmedNoApp =
      f.hasRepo === false &&
      f.hasRepoSource !== null &&
      f.hasDeployUrl !== null;
    if (!confirmedNoApp) return null;
    if (f.hasItems === false) return { action: "create_items", slug: "items" };
    // No repo AND no deploy URL → get the handoff pack, build the app
    // elsewhere, come back with a deploy URL. GitHub is never the forced step.
    if (f.hasDeployUrl === false) return { action: "get_pack", slug: "export" };
    return null;
  }

  // The app exists. The first result is a real-app check, which needs the
  // address — so a confirmed-missing address is the whole next step, whatever
  // else is linked (D2). Missing checklist items never interpose here.
  if (f.hasDeployUrl === false) return { action: "add_url", slug: "sources" };

  const checked = checkedFact(f);
  if (checked === true) {
    return { action: "view_results", slug: f.hasVisualCheck === true ? "visual-checks" : "checks" };
  }
  if (f.hasDeployUrl !== true) return null; // address fact unknown — stay quiet
  if (checked === false) return { action: "run_review", slug: "visual-checks" };
  return null; // a check fact is unknown — show nothing rather than mislead
}

/**
 * The canonical screen order inside the flow, used by the bottom "다음 →"
 * button so a user finishing one screen is walked to the next without
 * scanning the sidebar. Pure lookup; unknown slugs return null.
 *
 * The CODE branch ("이미 만든 앱이 있어요") walks prep FIRST, then straight to
 * checking the real app: someone who already has an app is not marched through
 * 준비 screens (Bae, 2026-07-10 live feedback).
 *
 * ★2026-09-28 (D9): the code walk's second stop is the real-app check
 * (visual-checks), not the PR screen (github). PR review is a developer tool —
 * it joins the walk only in developer mode, right after the real-app check.
 * @param {string} slug current screen slug ("" = overview)
 * @param {"idea" | "code" | "spec" | null} [entryPath] the branch this project entered through
 * @param {{ developerMode?: boolean }} [opts]
 * @returns {string | null} next slug, or null when there is no obvious next
 */
export function nextScreenSlug(slug, entryPath, opts) {
  const developerMode = opts?.developerMode === true;
  // Idea/spec entries have NO CODE YET: their walk ends at the builder pack
  // (go build it), never marching into repo-connect/PR screens — that funnel
  // only makes sense AFTER the app exists (2026-07-10 live walkthrough: an
  // idea-branch user was walked settings→github→history in a loop with
  // nothing to connect). The post-build return path (/p/:id/connect, checks)
  // is reachable from the export screen and the sidebar, not a forced walk.
  const order =
    entryPath === "code"
      ? developerMode
        ? ["settings", "visual-checks", "github", "items", "checks", "fixes"]
        : ["settings", "visual-checks", "items", "checks", "fixes"]
      : ["idea", "spec", "items", "dev-spec", "export"];
  const i = order.indexOf(slug);
  if (i !== -1) return i === order.length - 1 ? null : (order[i + 1] ?? null);

  // Post-review loop on the builder branches (Bae 2026-07-17): once a review
  // exists the right order is 확인 결과 → 고쳐보기 → 빌더팩 — the pack is handed
  // AFTER fixes are prepared, so it carries the fix briefs instead of an empty
  // fixes.md. checks/fixes aren't in the base walk for these branches, so this
  // chain only ever engages after the user reached the review screens.
  if (entryPath !== "code") {
    const loop = ["checks", "fixes", "export"];
    const j = loop.indexOf(slug);
    if (j !== -1 && j < loop.length - 1) return loop[j + 1] ?? null;
  }
  return null;
}

/**
 * D6 — which label the second step wears. A project whose app already exists
 * is not "building" anything: the step is checking that app. Everyone else
 * keeps the original "만들기·검수" (the builder pack lives there).
 * @param {Parameters<typeof projectHasApp>[0]} facts
 * @returns {"reviewApp" | "review"} key under t.stepsNav
 */
export function reviewStepLabelKey(facts) {
  return projectHasApp(facts) ? "reviewApp" : "review";
}

/**
 * D6 — the sidebar's step 2/3 screens (slugs; the component owns the labels).
 *
 *  - App exists: step 2 = the real-app check; the PR screen only for developers
 *    or when PR reviews already exist (never hide something in use); the build
 *    guide only for developers (the app is already built). Step 3 = results.
 *  - No app yet: step 2 = the build guide; step 3 = results + the app check —
 *    unchanged, and no PR tab (an idea-branch user has no code to review).
 *
 * A screen never appears in two steps at once.
 * @param {{ hasApp: boolean, developerMode?: boolean, hasPrReviewHistory?: boolean | null }} input
 * @returns {{ review: string[], results: string[] }}
 */
export function sidebarStepItems(input) {
  const dev = input?.developerMode === true;
  if (input?.hasApp === true) {
    const review = ["visual-checks"];
    if (prReviewVisible(input)) review.push("github");
    if (dev) review.push("export");
    return { review, results: ["checks"] };
  }
  return { review: ["export"], results: ["checks", "visual-checks"] };
}

/**
 * The PR-review surfaces (the sidebar's code-changes item, the results
 * screen's PR section and its "connect a PR" button) are a developer tool:
 * shown to developers, and to anyone who already has PR reviews (never hide
 * something in use). Everyone else's default check is the real app — the
 * results screen used to make "go to the PR screen" its primary button for
 * every code-branch project, which is the same dead end the overview had.
 * @param {{ developerMode?: boolean, hasPrReviewHistory?: boolean | null } | null | undefined} input
 * @returns {boolean}
 */
export function prReviewVisible(input) {
  return input?.developerMode === true || input?.hasPrReviewHistory === true;
}

/**
 * D7 — which "how this works" list the overview shows. The idea list (brief →
 * builder pack → paste the address) only makes sense before an app exists;
 * showing it next to "your code is connected" (Bae, 2026-09-28) contradicted
 * itself.
 * @param {Parameters<typeof projectHasApp>[0]} facts
 * @returns {"idea" | "app"}
 */
export function explainerKind(facts) {
  return projectHasApp(facts) ? "app" : "idea";
}

// ─── Facts from API responses — one rule for the overview and the sidebar ───
//
// Both screens read the same three lists. If each mapped responses on its own,
// they would drift (#498), and the sidebar would disagree with the overview
// about what exists. A project that is not saved on the server yet has no
// runs and no sources — that is a confirmed "none", not an unknown.

/**
 * @param {{ ok: boolean, checks?: unknown[], error?: string } | null | undefined} res
 * @returns {boolean | null}
 */
export function visualCheckFact(res) {
  if (!res) return null;
  if (res.ok) return Array.isArray(res.checks) && res.checks.length > 0;
  return res.error === "project_not_found" ? false : null;
}

/**
 * @param {{ ok: boolean, runs?: unknown[], error?: string } | null | undefined} res
 * @returns {boolean | null}
 */
export function reviewRunFact(res) {
  if (!res) return null;
  if (res.ok) return Array.isArray(res.runs) && res.runs.length > 0;
  return res.error === "HTTP 404" || res.error === "project_not_found" ? false : null;
}

/**
 * @param {{ ok: boolean, sources?: Array<{ type: string }>, error?: string } | null | undefined} res
 * @returns {{ hasDeployUrl: boolean | null, hasRepoSource: boolean | null }}
 */
export function sourceFacts(res) {
  if (res && res.ok) {
    const list = Array.isArray(res.sources) ? res.sources : [];
    return {
      hasDeployUrl: list.some((s) => s && s.type === "website"),
      hasRepoSource: list.some((s) => s && s.type === "github_repo"),
    };
  }
  if (res && res.error === "project_not_found") return { hasDeployUrl: false, hasRepoSource: false };
  return { hasDeployUrl: null, hasRepoSource: null };
}

/** DOM id of the overview's inline "app address" input (D4) — link target for D8. */
export const APP_ADDRESS_ANCHOR = "app-address";

/**
 * D8 — where "실제 앱 확인하기" goes from a screen that is not the overview
 * (e.g. the empty PR list). With an address: the real-app check. Without one:
 * the overview's inline address input. Unknown: the check screen, which itself
 * explains a missing address (fail-open — never a dead end).
 * @param {string} projectId
 * @param {boolean | null | undefined} hasDeployUrl
 * @returns {string}
 */
export function liveAppCheckHref(projectId, hasDeployUrl) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return hasDeployUrl === false ? `${base}#${APP_ADDRESS_ANCHOR}` : `${base}/visual-checks`;
}

/**
 * packReadiness — should the export screen route the user through 확인 결과
 * first? (Bae 2026-07-17: "수정을 다 마치고 빌더팩을 전달해줘야지".)
 *
 * A pack exported while failed check items still lack a fix suggestion ships an
 * empty fixes.md — legal but weak. This computes that state so the export
 * screen can lead with "확인 결과부터" (soft gate: informing + default CTA,
 * never a hard lock — dead ends are worse than a weaker pack).
 *
 * @param {{ results?: Array<{ itemId: string, status: string }> } | null | undefined} checkResults
 * @param {Record<string, unknown> | null | undefined} fixSuggestions
 * @returns {{ state: "no_review" | "fixes_missing" | "fixes_ready", failedCount: number, missingCount: number }}
 *   no_review: no review ran, or nothing failed — no notice needed.
 */
export function packReadiness(checkResults, fixSuggestions) {
  const results = Array.isArray(checkResults?.results) ? checkResults.results : [];
  const failed = results.filter((r) => r && r.status === "failed");
  if (failed.length === 0) return { state: "no_review", failedCount: 0, missingCount: 0 };
  const fs = fixSuggestions ?? {};
  const missing = failed.filter((r) => !Object.prototype.hasOwnProperty.call(fs, r.itemId));
  if (missing.length > 0) {
    return { state: "fixes_missing", failedCount: failed.length, missingCount: missing.length };
  }
  return { state: "fixes_ready", failedCount: failed.length, missingCount: 0 };
}

/**
 * nextStepFromHere — **결과를 아는** 다음 한 걸음 (2026-09-01).
 *
 * ## 왜 정적 순서로는 안 되나
 *
 * Bae: *"유저들이 쉽게 따라오고 확인할 수 있도록 심플해야 하고 구성의 연결이
 * 이어지도록 유도하는 기능이 필요해."*
 *
 * `nextScreenSlug`는 화면 순서를 고정으로 안다. 그런데 이번에 만든 순환 —
 * 검수 → 결과 → 고칠 것 → **재검수** — 에서 다음 걸음은 **검수 결과에 따라
 * 달라진다.** 문제가 없으면 여기서 멈춰도 되고, 있으면 고칠 것으로 가야 하고,
 * 고쳤으면 다시 확인해야 한다. 고정 배열은 이 셋을 구분할 수 없다.
 *
 * ## 왜 순수 함수인가 (R5)
 *
 * 부르는 곳이 둘이다 — 모든 화면 하단의 안내 바와, 검수 결과 화면 자체.
 * 같은 규칙이 두 군데 살면 반드시 갈라진다(#498에서 겪었다). 그래서 판단은
 * 여기 하나뿐이고, 두 호출자는 자기가 아는 사실만 넘긴다.
 *
 * ## 왜 이유를 같이 돌려주나
 *
 * "다음 →"만으로는 유도가 안 된다. 왜 그게 다음인지 한 줄이 붙어야 따라온다.
 * 문구는 i18n이 가지고, 여기서는 **키**만 정한다.
 *
 * @param {string} slug 지금 화면 ("" = 개요)
 * @param {{
 *   entryPath?: "idea"|"code"|"spec"|null,
 *   summary?: {failed?: number, needsDecision?: number}|null,
 *   hasCheckRun?: boolean,
 *   hasFixes?: boolean,
 *   visual?: {findingCount?: number}|null,
 *   developerMode?: boolean,
 * }} ctx developerMode: the PR screen joins the code walk only for developers (D9).
 * @returns {{slug: string, reason: "seeProblems"|"afterFix"|"allClear"|"continue"}|null}
 */
export function nextStepFromHere(slug, ctx = {}) {
  const { entryPath = null, summary = null, hasCheckRun = false, hasFixes = false, visual = null } = ctx;
  const walk = { developerMode: ctx.developerMode === true };

  // ★검수를 본 직후 — 여기서만 결과가 다음을 정한다.
  if (slug === "checks" || slug === "visual-checks") {
    // 두 검수는 **결과가 다른 곳에 산다**: 코드 리뷰는 `checkResults`, 화면 검수는
    // 시각 검수 실행에. 이 구분을 컴포넌트에 두면 반드시 갈라지므로(#498) 출처를
    // 고르는 일까지 여기서 한다. 처음엔 `checkResults` 하나만 봤는데, 화면 검수는
    // 거기에 아무것도 쓰지 않아 **정작 순환의 중심 화면만 안내가 비어 있었다**
    // (2026-09-01 배포 전 확인에서 잡음).
    const onVisual = slug === "visual-checks";
    const ran = onVisual ? visual != null : hasCheckRun;
    const problems = onVisual
      ? (visual?.findingCount ?? 0)
      : (summary?.failed ?? 0) + (summary?.needsDecision ?? 0);
    if (!ran) return null; // 아직 결과가 없으면 다음을 말할 게 없다.
    if (problems > 0) return { slug: "fixes", reason: "seeProblems" };
    // 문제가 없으면 **끝났다고 말해준다.** 억지로 다음 화면으로 밀지 않는다 —
    // 할 일이 없는데 다음을 주면 그게 바로 "무한 행진" 경험이다.
    const onward = nextScreenSlug(slug, entryPath, walk);
    return onward ? { slug: onward, reason: "allClear" } : null;
  }

  // ★순환을 닫는 자리. 고칠 것을 받았으면 다음은 **재검수**다 — 고쳤다는 말은
  //  다시 돌려보기 전까지 주장일 뿐이다(run-comparison.ts와 같은 입장).
  if (slug === "fixes" && hasFixes) return { slug: "visual-checks", reason: "afterFix" };

  const onward = nextScreenSlug(slug, entryPath, walk);
  return onward ? { slug: onward, reason: "continue" } : null;
}
