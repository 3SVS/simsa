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
 * "한 번이라도 확인했는가" — **끝난** 실제 앱 확인 런 ≥1 **또는** PR 리뷰 런 ≥1.
 *
 * 종전엔 PR 리뷰 이력만 셌다. 그래서 실제 앱 확인을 끝낸 사람에게도 개요가 계속
 * "첫 검수"를 권했다. (hasVisualCheck는 끝난 런만 센다 — visualCheckFact.)
 *
 * 확정된 런은 모르는 사실에 지워지지 않는다(#559 검증 결함 11): 한쪽이 true면 다른
 * 쪽 조회가 실패(null)해도 true다. 둘 다 true가 아니고 하나라도 null이면 null
 * (fail-open: 모르는 것으로 "아직 안 했다"를 만들지 않는다).
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
  if (pr === true || vc === true) return true;
  if (pr === false && vc === false) return false;
  return null;
}

/**
 * A fact the caller confirmed absent. `undefined` = a caller that does not track
 * that fact at all (legacy contract, treated as absent); `null` = unknown
 * (loading or failed) and never counts as absent — unknowns never lock.
 * @param {boolean | null | undefined} v
 */
function confirmedAbsent(v) {
  return v === false || v === undefined;
}

/**
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasVisualCheck?: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 *   null = unknown (loading or fetch failed) — treated as "not confirmed", never locks.
 *   hasVisualCheck: at least one FINISHED real-app check (visual check) exists
 *   (queued / running / failed runs don't count — visualCheckFact). Together
 *   with hasReviewRun (PR review) it decides "the project has been checked".
 *   entryPath: the branch this project entered through. For the CODE branch the
 *   prepare step is OPTIONAL by design (the user skipped the idea step — that is
 *   the branch's normal path, not a deficit): prepare renders as optional, and
 *   review NEVER locks on missing items.
 *   hasDeployUrl: whether a deployed-app URL (website source) is connected. On
 *   the BUILDER (non-code) path this is the alternative to a repo — a non-dev who
 *   built the app elsewhere attaches a deploy URL and gets a URL-based visual
 *   check, so results never dead-end on "connect GitHub".
 * @returns {Array<{ key: "prepare" | "review" | "results", status: StepStatus, lockReason: "need_items" | "need_url" | "need_build" | null, optional: boolean }>}
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
  // a repo nor a deploy URL (nor a finished check). On the builder branch the
  // guidance is "get the pack, build, connect your URL" (need_build) — never a
  // GitHub dead end. On the code branch it is "add your app's address first"
  // (need_url) — the same prerequisite the overview asks for (add_url); code
  // linking is optional there (D-17 amend), so "connect your code" is retired
  // (#559 검증 결함 6). Every fact in the lock must be CONFIRMED absent — an
  // unknown (null) address / source / check never locks (fail-open).
  const nothingKnown =
    f.hasRepo === false &&
    confirmedAbsent(f.hasRepoSource) &&
    confirmedAbsent(f.hasVisualCheck);
  const resultsLocked = codeEntry
    ? nothingKnown && confirmedAbsent(f.hasDeployUrl)
    : nothingKnown && f.hasDeployUrl === false;

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
        ? /** @type {const} */ ("need_url")
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
 *  D3. "확인했음" = **끝난** 실제 앱 확인 런 ≥1 또는 PR 리뷰 런 ≥1(checkedFact). 결과
 *      보기의 목적지는 실제 앱 확인이 있으면 visual-checks, PR 리뷰만 있으면 checks.
 *
 * #559 검증에서 고친 것:
 *  - 결함 1: 앱이 있으면 주소 사실이 **확정된 뒤에만** CTA를 낸다. 종전엔 확인 이력만
 *    있으면 주소 사실이 null이어도 "결과 보기"를 먼저 그렸다가, 소스가 도착해 주소가
 *    없다고 밝혀지면 주소 입력칸으로 뒤집혔다.
 *  - 결함 2: 진행 중인 런만 있으면 "결과 있어요"가 아니라 view_progress(진행 상황 보기),
 *    실패 런만 있으면 run_review(다시 확인). visualCheckActive는 visualCheckActiveFact.
 *
 * add_url의 slug("sources")는 주소를 넣을 수 있는 화면이다. 개요는 이 행동을
 * 링크가 아니라 **그 자리의 입력칸**으로 그린다(D4) — slug는 다른 소비자를 위한 폴백.
 *
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasRepoSource?: boolean | null, hasReviewRun: boolean | null, hasVisualCheck?: boolean | null, visualCheckActive?: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 * @returns {{ action: "create_items" | "connect_code" | "add_url" | "get_pack" | "run_review" | "view_progress" | "view_results", slug: string } | null}
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
  // Address fact unknown — stay quiet. Checked BEFORE the run facts: a "view
  // results" drawn now would flip into the address box once the sources arrive
  // and say no address is attached (결함 1).
  if (f.hasDeployUrl !== true) return null;

  const checked = checkedFact(f);
  if (checked === true) {
    return { action: "view_results", slug: f.hasVisualCheck === true ? "visual-checks" : "checks" };
  }
  if (checked === null) return null; // a check fact is unknown — show nothing rather than mislead
  // Not checked yet. A check that is still running is not a result (결함 2) —
  // and not a reason to start another one either (the server allows one at a time).
  if (f.visualCheckActive === true) return { action: "view_progress", slug: "visual-checks" };
  if (f.visualCheckActive === null) return null;
  // Never checked, or only runs that failed to finish → (re)run the real-app check.
  return { action: "run_review", slug: "visual-checks" };
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
 *
 * #559 검증에서 고친 것:
 *  - 결함 4: the PR screen stays reachable outside developer mode (the sidebar
 *    shows it to anyone with PR reviews, the results screen links to it, old
 *    bookmarks). Leaving it out of the default walk must not strand them.
 *    (여정 렌즈 결함 4, 2026-09-28: the first fix continued to "items", which
 *    disagreed with the screen's own "실제 앱 확인하기" — now the bar follows
 *    that button: the real-app check when an address exists, else nothing.)
 *  - 결함 5: "the app already exists" is not only the code branch. A restored
 *    project defaults to entryPath "idea" even when its repo or address is
 *    known; walking it to the builder pack contradicts the sidebar, which hides
 *    that screen once an app exists. `hasApp: true` walks the app route.
 * @param {string} slug current screen slug ("" = overview)
 * @param {"idea" | "code" | "spec" | null} [entryPath] the branch this project entered through
 * @param {{ developerMode?: boolean, hasApp?: boolean, hasDeployUrl?: boolean | null }} [opts]
 *   hasDeployUrl: the app's address is connected (only read on the PR screen).
 * @returns {string | null} next slug, or null when there is no obvious next
 */
export function nextScreenSlug(slug, entryPath, opts) {
  const developerMode = opts?.developerMode === true;
  const appWalk = entryPath === "code" || opts?.hasApp === true;
  // Idea/spec entries have NO CODE YET: their walk ends at the builder pack
  // (go build it), never marching into repo-connect/PR screens — that funnel
  // only makes sense AFTER the app exists (2026-07-10 live walkthrough: an
  // idea-branch user was walked settings→github→history in a loop with
  // nothing to connect). The post-build return path (/p/:id/connect, checks)
  // is reachable from the export screen and the sidebar, not a forced walk.
  const fullAppWalk = ["settings", "visual-checks", "github", "items", "checks", "fixes"];
  const order = appWalk
    ? developerMode
      ? fullAppWalk
      : fullAppWalk.filter((s) => s !== "github")
    : ["idea", "spec", "items", "dev-spec", "export"];
  const i = order.indexOf(slug);
  if (i !== -1) return i === order.length - 1 ? null : (order[i + 1] ?? null);
  // The PR screen outside developer mode (the sidebar shows it to anyone with
  // PR reviews; old bookmarks). Its own way out is "실제 앱 확인하기" — to the
  // real-app check when an address exists, else to the overview's address box
  // (liveAppCheckHref). The bottom bar must agree with that button, never offer
  // a second answer (#559 여정 렌즈 결함 4 — it used to say "다음: 확인 항목"):
  // with an address it points at the same check; otherwise it stays silent and
  // the screen's own button is the one way on.
  if (appWalk && slug === "github") return opts?.hasDeployUrl === true ? "visual-checks" : null;

  // Post-review loop on the builder branches (Bae 2026-07-17): once a review
  // exists the right order is 확인 결과 → 고쳐보기 → 빌더팩 — the pack is handed
  // AFTER fixes are prepared, so it carries the fix briefs instead of an empty
  // fixes.md. checks/fixes aren't in the base walk for these branches, so this
  // chain only ever engages after the user reached the review screens.
  if (!appWalk) {
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
 * Is "does this project's app already exist?" answered yet? (#559 검증 결함 3)
 *
 * The step-2 label ("만들기·검수" vs "앱 확인"), the sidebar's step items, the
 * how-it-works list and the bottom "다음 →" all hang on that answer. For a
 * non-code project it is only known once the repo and sources requests have
 * finished — a restored project defaults to the idea branch, so drawing the
 * idea label first and swapping it when the repo arrives is exactly the flip
 * the fail-open rule forbids.
 *
 *  - code branch, or any CONFIRMED repo / source / address → known (the app
 *    exists; a positive fact is never retracted by a later answer),
 *  - otherwise known once both requests settled (`settled`), whatever they
 *    returned — a failed request leaves the fact unknown and the former
 *    "no app" view is drawn (never hold forever).
 * @param {Parameters<typeof projectHasApp>[0]} facts
 * @param {boolean} settled the repo AND sources requests have both finished
 * @returns {boolean}
 */
export function appPresenceKnown(facts, settled) {
  return projectHasApp(facts) || settled === true;
}

/**
 * The progress map as the screens draw it — one hold rule for the overview's
 * progress row and the sidebar (#559 검증 결함 3).
 *
 * While the app's presence is unknown every step is a neutral "todo" (no
 * current / locked / done, no optional tag) and there is no step-2 label
 * (reviewLabelKey null → the screens draw a placeholder). Once known it is
 * exactly computeProjectSteps + reviewStepLabelKey.
 * @param {Parameters<typeof computeProjectSteps>[0]} facts
 * @param {boolean} settled
 * @returns {{ known: boolean, reviewLabelKey: "reviewApp" | "review" | null, steps: ReturnType<typeof computeProjectSteps> }}
 */
export function stepMapView(facts, settled) {
  const f = facts ?? {};
  if (!appPresenceKnown(f, settled)) {
    return {
      known: false,
      reviewLabelKey: null,
      steps: /** @type {const} */ (["prepare", "review", "results"]).map((key) => ({
        key,
        status: /** @type {StepStatus} */ ("todo"),
        lockReason: null,
        optional: false,
      })),
    };
  }
  return { known: true, reviewLabelKey: reviewStepLabelKey(f), steps: computeProjectSteps(f) };
}

/**
 * D6 — the sidebar's step 2/3 screens (slugs; the component owns the labels).
 *
 *  - App exists: step 2 = the real-app check; the PR screen only for developers
 *    or when PR reviews already exist (never hide something in use); the build
 *    guide only for developers (the app is already built). Step 3 = results.
 *  - No app yet: step 2 = the build guide; step 3 = results + the app check —
 *    unchanged, and no PR tab (an idea-branch user has no code to review).
 *  - Not known yet (`hasApp: null`, #559 검증 결함 3): only the screen both
 *    answers share (results). The rest appears once the answer is in, so no
 *    item moves from one step to another under the reader.
 *
 * A screen never appears in two steps at once.
 * @param {{ hasApp: boolean | null, developerMode?: boolean, hasPrReviewHistory?: boolean | null }} input
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
  if (input?.hasApp === null) return { review: [], results: ["checks"] };
  return { review: ["export"], results: ["checks", "visual-checks"] };
}

/**
 * The one name a project screen goes by in the sidebar AND in the bottom
 * "다음 →" bar (#559 검증 결함 13) — key under t.nav.
 *
 *  - visual-checks: "앱 확인하기" once the app exists (D6); before that the
 *    former "시각 검수" — nothing to check yet, and the no-app sidebar kept its
 *    old items and names.
 *  - export: "만들기 안내" in the default view, "빌더 팩" for developers
 *    (Train N §8-6) — the bottom bar used to say "빌더 팩" to everyone.
 *  - github: always labelled as the developer tool it is.
 * @param {string} slug
 * @param {{ hasApp?: boolean | null, developerMode?: boolean }} [opts]
 * @returns {string | null} null for a slug that is not a flow screen
 */
export function navLabelKey(slug, opts) {
  switch (slug) {
    case "visual-checks":
      return opts?.hasApp === true ? "checkApp" : "visualChecks";
    case "export":
      return opts?.developerMode === true ? "export" : "buildGuide";
    case "github":
      return "githubDev";
    case "dev-spec":
      return "devSpec";
    case "idea":
    case "spec":
    case "items":
    case "settings":
    case "checks":
    case "fixes":
      return slug;
    default:
      return null;
  }
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

/**
 * Is the overview's "how this works" list still worth showing? (#559 여정 렌즈 결함 9)
 *
 * It is a first-use explanation. Once the project has been checked — a finished
 * real-app check, a PR review, or local review activity — the list only pushes
 * the actual result further down (it also told a user whose address was already
 * connected to "1. add the address"). Unknown facts keep it (fail-open: a failed
 * request never hides the explanation from a first-time user); the caller waits
 * until the check requests have finished before drawing it, so it never
 * appears and then vanishes.
 * @param {{ hasReviewActivity: boolean, hasVisualCheck: boolean | null, hasReviewRun: boolean | null }} input
 * @returns {boolean}
 */
export function howItWorksVisible(input) {
  return input?.hasReviewActivity !== true && input?.hasVisualCheck !== true && input?.hasReviewRun !== true;
}

/**
 * Does the overview's "review summary" (passed / failed / … counts) have
 * anything to summarize? (#559 여정 렌즈 결함 3)
 *
 * Those counts come from PR reviews and the brief-based pre-check — never from
 * a real-app check. Shown next to a "not working" real-app result as 0/0/0/0
 * they contradicted it, and their "view all →" led to a screen without that
 * result. So they appear only when one of their own sources exists.
 * @param {{ hasReviewActivity: boolean, hasPrecheck: boolean, hasReviewRun: boolean | null }} input
 * @returns {boolean}
 */
export function resultsSummaryVisible(input) {
  return input?.hasReviewActivity === true || input?.hasPrecheck === true || input?.hasReviewRun === true;
}

/**
 * "Does this project's app already exist?" for a screen that is not the
 * overview or the sidebar (#559 여정 렌즈 결함 5·7) — from what it can know
 * without fetching the repo again: the entry branch, the answer the sidebar
 * settled (app-presence), and its own address fact.
 *
 * A confirmed positive decides at once (code branch · presence true · an
 * address). "No app" is only known once the sidebar settled it — until then
 * `known` is false and the screen holds whatever depends on the answer (a
 * title, a "get the builder pack" hint) instead of drawing one and swapping it.
 * @param {{ entryPath?: "idea" | "code" | "spec" | null, presence: boolean | null, hasDeployUrl: boolean | null }} input
 * @returns {{ known: boolean, hasApp: boolean }}
 */
export function screenAppView(input) {
  const hasApp = input?.entryPath === "code" || input?.presence === true || input?.hasDeployUrl === true;
  if (hasApp) return { known: true, hasApp: true };
  return { known: input?.presence === false, hasApp: false };
}

/**
 * The builder-pack door's copy keys, named like the sidebar item for the same
 * screen (#559 여정 렌즈 결함 10): "만들기 안내" in the default view, "빌더 팩"
 * for developers — navLabelKey("export") follows the same rule (Train N §8-6).
 * The overview's CTA said "빌더 팩 받기" while its own description and the
 * sidebar said "만들기 안내".
 * @param {boolean} developerMode
 * @returns {{ label: "getGuide" | "getPack", step2: "gsIdeaStep2Guide" | "gsIdeaStep2" }}
 */
export function packCopyKeys(developerMode) {
  return developerMode === true
    ? { label: "getPack", step2: "gsIdeaStep2" }
    : { label: "getGuide", step2: "gsIdeaStep2Guide" };
}

// ─── Facts from API responses — one rule for the overview and the sidebar ───
//
// Both screens read the same three lists. If each mapped responses on its own,
// they would drift (#498), and the sidebar would disagree with the overview
// about what exists. A project that is not saved on the server yet (or not
// under this key) has no runs, no sources and no linked repo — that is a
// confirmed "none", not an unknown. The four facts share this rule, the repo
// fact included (repo-settle.mjs repoConnectedFact, #559 검증 결함 7·11); only
// transient failures (5xx, network) stay unknown.

/** Visual-check run statuses that carry a result (central-plane VISUAL_CHECK_STATUSES). */
const FINISHED_RUN_STATUSES = new Set(["done", "uploaded"]);
/** Statuses the backend can still move forward (visual-check-run-state isActiveStatus). */
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

/**
 * @param {unknown} res
 * @param {(status: string) => boolean} match
 * @returns {boolean | null}
 */
function anyRun(res, match) {
  const r = /** @type {{ ok?: boolean, checks?: unknown, error?: string } | null | undefined} */ (res);
  if (!r) return null;
  if (r.ok) {
    const list = Array.isArray(r.checks) ? r.checks : [];
    return list.some((c) => c && typeof c === "object" && match(String(/** @type {{ status?: unknown }} */ (c).status ?? "")));
  }
  return r.error === "project_not_found" ? false : null;
}

/**
 * "A real-app check has a result" — at least one FINISHED run (done, or
 * uploaded by the local tooling). Queued / running runs have no result yet and
 * failed runs never produced one (#559 검증 결함 2: counting them told the user
 * "your latest review is in" while the run was still going, or after the
 * dispatch had failed).
 * @param {{ ok: boolean, checks?: Array<{ status?: string }>, error?: string } | null | undefined} res
 * @returns {boolean | null}
 */
export function visualCheckFact(res) {
  return anyRun(res, (s) => FINISHED_RUN_STATUSES.has(s));
}

/**
 * "A real-app check is still running" — at least one queued / running run.
 * Read from the same list response as visualCheckFact.
 * @param {{ ok: boolean, checks?: Array<{ status?: string }>, error?: string } | null | undefined} res
 * @returns {boolean | null}
 */
export function visualCheckActiveFact(res) {
  return anyRun(res, (s) => ACTIVE_RUN_STATUSES.has(s));
}

/**
 * The most recent FINISHED real-app check (done / uploaded) — the result the
 * results screen and the fixes screen point at (#559 여정 렌즈 결함 2·3). Same
 * "finished" rule as visualCheckFact. null when there is none.
 * @param {Array<{ id?: string, status?: string, createdAt?: string }> | null | undefined} checks
 * @returns {string | null}
 */
export function latestFinishedRunId(checks) {
  if (!Array.isArray(checks)) return null;
  let best = null;
  for (const c of checks) {
    if (!c || typeof c.id !== "string" || !FINISHED_RUN_STATUSES.has(String(c.status ?? ""))) continue;
    if (!best || String(c.createdAt ?? "") > String(best.createdAt ?? "")) best = c;
  }
  return best ? best.id : null;
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
 * D8 — what the PR screen shows under the repo card, decided in one place
 * (#559 검증 결함 8·12).
 *
 *  - list: the open-PR list with its "N open" header — only when there ARE
 *    open PRs (the old "0 open" header was the dead end itself).
 *  - empty "action": zero open PRs and nothing linked before → "no PR is
 *    normal" + the ONE primary action, the real-app check.
 *  - empty "quiet": zero open PRs but earlier PRs are linked below (merged or
 *    closed since) → a plain sentence only. Those cards carry their own
 *    buttons; a second primary, and "having no PR is normal" next to a list
 *    of PRs, would contradict each other.
 *  - devNote: the "this is a developer tool · check the real app" line —
 *    everywhere except next to the "action" empty state, which already carries
 *    that way out as its primary.
 * @param {{ pullsPhase: "idle" | "loading" | "done" | "error", openCount: number, linkedCount: number }} input
 * @returns {{ list: boolean, empty: "action" | "quiet" | null, devNote: boolean }}
 */
export function githubPullsView(input) {
  const done = input?.pullsPhase === "done";
  const open = Number(input?.openCount ?? 0);
  const linked = Number(input?.linkedCount ?? 0);
  if (!done) return { list: false, empty: null, devNote: true };
  if (open > 0) return { list: true, empty: null, devNote: true };
  if (linked > 0) return { list: false, empty: "quiet", devNote: true };
  return { list: false, empty: "action", devNote: false };
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
 *   hasApp?: boolean,
 *   hasDeployUrl?: boolean | null,
 * }} ctx developerMode: the PR screen joins the code walk only for developers (D9).
 *   hasApp: the app already exists (restored idea-branch project with a repo or
 *   address) → walk the app route, never to the builder pack (#559 검증 결함 5).
 *   hasDeployUrl: the app's address is connected — decides where the PR
 *   screen's bar goes (#559 여정 렌즈 결함 4).
 * @returns {{slug: string, reason: "seeProblems"|"afterFix"|"allClear"|"continue"|"checkLiveApp"}|null}
 */
export function nextStepFromHere(slug, ctx = {}) {
  const { entryPath = null, summary = null, hasCheckRun = false, hasFixes = false, visual = null } = ctx;
  const walk = {
    developerMode: ctx.developerMode === true,
    hasApp: ctx.hasApp === true,
    hasDeployUrl: ctx.hasDeployUrl ?? null,
  };

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
    if (problems > 0) {
      // ★화면 검수의 발견과 고칠 방법(바로 고치게 하기 · 고치기 · 고칠 내용 복사)은 **그 결과
      //  화면에 산다.** "고칠 것"(/fixes)은 코드 리뷰의 `checkResults`만 읽어서, 실제 앱 확인
      //  뒤 "다음: 남은 문제 →"는 결과 없는 순환(/fixes → /checks)으로 보냈다 — 게다가 급한
      //  primary로 결과 화면의 버튼과 경쟁했다(#559 여정 렌즈 결함 2). 그래서 여기선 말하지 않는다.
      return onVisual ? null : { slug: "fixes", reason: "seeProblems" };
    }
    // 문제가 없으면 **끝났다고 말해준다.** 억지로 다음 화면으로 밀지 않는다 —
    // 할 일이 없는데 다음을 주면 그게 바로 "무한 행진" 경험이다.
    const onward = nextScreenSlug(slug, entryPath, walk);
    return onward ? { slug: onward, reason: "allClear" } : null;
  }

  // ★순환을 닫는 자리. 고칠 것을 받았으면 다음은 **재검수**다 — 고쳤다는 말은
  //  다시 돌려보기 전까지 주장일 뿐이다(run-comparison.ts와 같은 입장).
  if (slug === "fixes" && hasFixes) return { slug: "visual-checks", reason: "afterFix" };

  const onward = nextScreenSlug(slug, entryPath, walk);
  if (!onward) return null;
  // From the PR screen the next step is the real-app check — say why in those
  // words, not "pick up where you left off" (#559 여정 렌즈 결함 4).
  if (slug === "github" && onward === "visual-checks") return { slug: onward, reason: "checkLiveApp" };
  return { slug: onward, reason: "continue" };
}

/**
 * How the bottom "다음 →" bar is drawn (#559 여정 렌즈 결함 2).
 *
 * A problem to fix (seeProblems) or a fix to verify (afterFix) makes the bar the
 * screen's most important action — but only when the screen has no primary of
 * its own. One screen, one filled button: a screen that already carries its own
 * primary keeps it, and the bar recedes. While the answer is unknown (the screen
 * is still drawing) the bar stays secondary — a second primary even for a
 * moment is exactly what this rule forbids.
 * @param {{ reason: string, screenHasPrimary: boolean | null }} input
 * @returns {"primary" | "secondary"}
 */
export function nextBarEmphasis(input) {
  const urgent = input?.reason === "seeProblems" || input?.reason === "afterFix";
  return urgent && input?.screenHasPrimary === false ? "primary" : "secondary";
}

/**
 * What the "고칠 것" (/fixes) screen shows when it opens (#559 여정 렌즈 결함 2).
 *
 *  - items: code-review / pre-check results exist → the fix list (as before).
 *  - live: only a real-app check result exists. Its findings and how to fix
 *    them live on that run's page (paste-into-your-tool, repair, copy-ready
 *    prompt) — so the screen points there instead of "go to review results",
 *    which holds no real-app results at all (the old loop /fixes → /checks).
 *  - review_first: nothing yet → as before.
 * @param {{ projectId: string, hasCheckResults: boolean, visualCheck: { findingCount?: number, runId?: string } | null | undefined }} input
 * @returns {{ kind: "items" } | { kind: "live", href: string } | { kind: "review_first" }}
 */
export function fixesEntryView(input) {
  if (input?.hasCheckResults) return { kind: "items" };
  const vc = input?.visualCheck;
  if (vc) {
    const base = `/projects/${encodeURIComponent(String(input.projectId ?? ""))}/visual-checks`;
    const runId = typeof vc.runId === "string" && vc.runId ? vc.runId : null;
    return { kind: "live", href: runId ? `${base}/${encodeURIComponent(runId)}` : base };
  }
  return { kind: "review_first" };
}
