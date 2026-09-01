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
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 *   null = unknown (loading or fetch failed) — treated as "not confirmed", never locks.
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
  const hasDeployUrl = f.hasDeployUrl === true;
  const hasRun = f.hasReviewRun === true;
  const codeEntry = f.entryPath === "code";

  // Step 1 — 준비 (idea / spec / items). Always accessible. Optional on the
  // code branch (skipping it is that branch's normal path, never a red mark).
  const prepareDone = hasItems;

  // A project is "connected" for review/results once EITHER its code (repo) or
  // its deployed app (URL) is attached. GitHub is the developer door; a builder
  // who made the app elsewhere attaches a deploy URL instead.
  const connected = hasRepo || hasDeployUrl;

  // Step 2 — 검수 (connect code/URL / run review). Locked only when items are
  // CONFIRMED missing — except on the code branch, where no-items is normal.
  // Done when something is connected AND a review has run.
  const reviewLocked = noItems && !codeEntry;
  const reviewDone = connected && hasRun;

  // Step 3 — 결과·수정. Locked only when the project is CONFIRMED to have neither
  // a repo nor a deploy URL. On the code branch the guidance is "connect your
  // repo" (need_code); on the builder branch it's "get the pack, build, connect
  // your URL" (need_build) — never a GitHub dead end. Unknown deploy-url on the
  // builder branch stays fail-open (no lock).
  const resultsLocked = codeEntry
    ? f.hasRepo === false
    : f.hasRepo === false && f.hasDeployUrl === false;

  // On the code branch, prepare is never "current" (the flow starts at review):
  // it shows as done when items exist, otherwise as a neutral optional todo.
  const prepareStatus = prepareDone ? "done" : codeEntry ? "todo" : "current";
  const prepare = {
    key: /** @type {const} */ ("prepare"),
    status: /** @type {StepStatus} */ (prepareStatus),
    lockReason: null,
    optional: codeEntry,
  };

  let reviewStatus;
  if (reviewLocked) reviewStatus = "locked";
  else if (reviewDone) reviewStatus = "done";
  else reviewStatus = prepareDone || codeEntry ? "current" : "todo";
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
 * activation moment (receiving the first review result) and, after that, to
 * the working loop. Only CONFIRMED facts produce a CTA: on unknowns it returns
 * null (no CTA beats a misleading one that flips after a fetch resolves).
 *
 * The chain deliberately skips anything that doesn't move the user toward the
 * first review result: on the code branch missing items never interpose —
 * connect code → run review is the whole activation path.
 *
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 * @returns {{ action: "create_items" | "connect_code" | "add_url" | "get_pack" | "run_review" | "view_results", slug: string } | null}
 */
export function nextProjectAction(facts) {
  const f = facts ?? {};
  const codeEntry = f.entryPath === "code";
  if (f.hasItems === false && !codeEntry) return { action: "create_items", slug: "items" };

  if (!codeEntry) {
    // Builder (non-code) path. No repo AND no deploy URL yet → get the handoff
    // pack, build the app elsewhere, come back with a deploy URL. GitHub is a
    // demoted developer option, never the forced next step (that was the dead
    // end). Once connected, review via the repo (code review) if one exists,
    // else via the deploy URL (visual check).
    if (f.hasRepo === false && f.hasDeployUrl === false) return { action: "get_pack", slug: "export" };
    const connected = f.hasRepo === true || f.hasDeployUrl === true;
    const reviewSlug = f.hasRepo === true ? "github" : "visual-checks";
    if (connected && f.hasReviewRun === false) return { action: "run_review", slug: reviewSlug };
    if (connected && f.hasReviewRun === true) return { action: "view_results", slug: "checks" };
    return null;
  }

  // Code path — 무언가 연결돼 있으면 검수로, 아니면 연결로.
  //
  // ★AF-1 이후 이 갈래는 **앱 주소로도 시작한다**(종전엔 항상 저장소였다).
  // 그때까지 이 분기는 `hasDeployUrl`을 아예 보지 않았고, 그래서 주소를 넣어
  // **검수까지 이미 끝난 프로젝트에도 "GitHub 저장소를 연결하세요"** 를 계속
  // 내밀었다(2026-08-24 journey-audit 실측). 사용자가 방금 한 일을 못 본 척하는
  // 안내는 제품이 자기 상태를 모른다는 뜻이다.
  //
  // 저장소가 있으면 코드 리뷰를, 주소만 있으면 화면 검수를 가리킨다.
  // ★저장소가 **알려진 것**과 **연결된 것**은 다른 사실이다 (2026-08-24 실측).
  //
  // AF-1은 제출한 저장소를 `project_sources`에 저장한다. 그런데 `hasRepo`는
  // GitHub 링크(토큰 보유)만 보므로, 저장소를 넣은 사용자가 시스템에는
  // "아무것도 연결 안 함"으로 보였다 — 방금 준 것을 못 본 척하는 상태.
  //
  // 둘을 나눠 쓴다: 코드 **리뷰**는 링크가 있어야 하고(토큰 필요), 코드를
  // **읽는 것**과 "무엇이 더 필요한가" 판단은 알려진 것만으로 충분하다.
  const repoKnown = f.hasRepo === true || f.hasRepoSource === true;
  const nothingKnown = f.hasRepo === false && f.hasRepoSource !== true && f.hasDeployUrl === false;
  if (nothingKnown) return { action: "connect_code", slug: "settings" };
  const codeConnected = repoKnown || f.hasDeployUrl === true;
  // 저장소만 알고 화면 주소가 없으면 **첫 결과까지 가장 짧은 길은 주소 추가**다.
  // (코드 리뷰는 GitHub 링크가 따로 필요하므로 더 먼 길이다.)
  if (repoKnown && f.hasDeployUrl === false && f.hasRepo !== true) {
    return { action: "add_url", slug: "sources" };
  }
  const codeReviewSlug = f.hasRepo === true ? "github" : "visual-checks";
  if (codeConnected && f.hasReviewRun === false) return { action: "run_review", slug: codeReviewSlug };
  if (codeConnected && f.hasReviewRun === true) return { action: "view_results", slug: "checks" };
  return null; // facts still unknown — show nothing rather than mislead
}

/**
 * The canonical screen order inside the flow, used by the bottom "다음 →"
 * button so a user finishing one screen is walked to the next without
 * scanning the sidebar. Pure lookup; unknown slugs return null.
 *
 * The CODE branch ("이미 만든 앱이 있어요") walks repo-connect FIRST: someone
 * who already has an app connects their code before curating check items —
 * being marched through 준비 screens and only then "suddenly" sent to the
 * repo read as an abrupt jump (Bae, 2026-07-10 live feedback).
 * @param {string} slug current screen slug ("" = overview)
 * @param {"idea" | "code" | "spec" | null} [entryPath] the branch this project entered through
 * @returns {string | null} next slug, or null when there is no obvious next
 */
export function nextScreenSlug(slug, entryPath) {
  // Idea/spec entries have NO CODE YET: their walk ends at the builder pack
  // (go build it), never marching into repo-connect/PR screens — that funnel
  // only makes sense AFTER the app exists (2026-07-10 live walkthrough: an
  // idea-branch user was walked settings→github→history in a loop with
  // nothing to connect). The post-build return path (/p/:id/connect, checks)
  // is reachable from the export screen and the sidebar, not a forced walk.
  const order =
    entryPath === "code"
      ? ["settings", "github", "items", "checks", "fixes"]
      : ["idea", "spec", "items", "export"];
  const i = order.indexOf(slug);
  if (i !== -1) return i === order.length - 1 ? null : order[i + 1];

  // Post-review loop on the builder branches (Bae 2026-07-17): once a review
  // exists the right order is 확인 결과 → 고쳐보기 → 빌더팩 — the pack is handed
  // AFTER fixes are prepared, so it carries the fix briefs instead of an empty
  // fixes.md. checks/fixes aren't in the base walk for these branches, so this
  // chain only ever engages after the user reached the review screens.
  if (entryPath !== "code") {
    const loop = ["checks", "fixes", "export"];
    const j = loop.indexOf(slug);
    if (j !== -1 && j < loop.length - 1) return loop[j + 1];
  }
  return null;
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
 * }} ctx
 * @returns {{slug: string, reason: "seeProblems"|"afterFix"|"allClear"|"continue"}|null}
 */
export function nextStepFromHere(slug, ctx = {}) {
  const { entryPath = null, summary = null, hasCheckRun = false, hasFixes = false, visual = null } = ctx;

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
    const onward = nextScreenSlug(slug, entryPath);
    return onward ? { slug: onward, reason: "allClear" } : null;
  }

  // ★순환을 닫는 자리. 고칠 것을 받았으면 다음은 **재검수**다 — 고쳤다는 말은
  //  다시 돌려보기 전까지 주장일 뿐이다(run-comparison.ts와 같은 입장).
  if (slug === "fixes" && hasFixes) return { slug: "visual-checks", reason: "afterFix" };

  const onward = nextScreenSlug(slug, entryPath);
  return onward ? { slug: onward, reason: "continue" } : null;
}
