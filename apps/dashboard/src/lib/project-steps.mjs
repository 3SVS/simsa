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
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasReviewRun: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
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
 * @param {{ hasItems: boolean | null, hasRepo: boolean | null, hasReviewRun: boolean | null, hasDeployUrl?: boolean | null, entryPath?: "idea" | "code" | "spec" | null }} facts
 * @returns {{ action: "create_items" | "connect_code" | "get_pack" | "run_review" | "view_results", slug: string } | null}
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

  // Code (developer) path — connect the repo, then run review.
  if (f.hasRepo === false) return { action: "connect_code", slug: "settings" };
  if (f.hasRepo === true && f.hasReviewRun === false) return { action: "run_review", slug: "github" };
  if (f.hasRepo === true && f.hasReviewRun === true) return { action: "view_results", slug: "checks" };
  return null; // facts still unknown — show nothing rather than mislead
}

/**
 * The canonical screen order inside the flow, used by the bottom "다음 →"
 * button so a user finishing one screen is walked to the next without
 * scanning the sidebar. Pure lookup; unknown slugs return null.
 * @param {string} slug current screen slug ("" = overview)
 * @returns {string | null} next slug, or null when there is no obvious next
 */
export function nextScreenSlug(slug) {
  const order = ["idea", "spec", "items", "settings", "github", "checks", "fixes"];
  const i = order.indexOf(slug);
  if (i === -1 || i === order.length - 1) return null;
  return order[i + 1];
}
