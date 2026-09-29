/**
 * repo-settle.mjs — resolve a project's linked repo, tolerant of D1
 * read-after-write lag.
 *
 * Bug this fixes (3svs-os/error-patterns/transient-null-hard-false): the "repo
 * connected" fact is re-derived from a live fetch that can transiently return
 * `{ok:true, repo:null}` right after a link (D1 propagation). The github page's
 * loadInitial already retried, but two sibling consumers — the sidebar and the
 * project overview — collapsed that transient null straight to a hard `false`
 * with NO retry, which reverted the progress map to "2 코드변경" and hid the
 * already-linked PR (a re-connect도돌이표). This is the single source of the
 * retry so the three sites can't diverge again.
 *
 * Pure except for the injected `fetchProjectRepo` — unit-testable with a fake.
 */

/**
 * @param {(id: string, userKey: string) => Promise<{ok:boolean, repo?:unknown}>} fetchProjectRepo
 * @param {string} id
 * @param {string} userKey
 * @param {{ attempts?: number, delayMs?: number, onFirst?: (res: {ok:boolean, repo?:unknown}) => void }} [opts]
 *   onFirst: called once with the FIRST answer, before any retry (#559 여정 렌즈
 *   결함 12). "No repo" is by far the common answer for an idea-branch project,
 *   and waiting out the read-after-write retries (700ms × 3) held the overview's
 *   next step and the sidebar's step-2 label for 3–4.5 s on every visit. A caller
 *   may draw from the first answer and correct it from the settled one — the
 *   retries still run, so a repo linked a moment ago is still found (it then
 *   replaces the provisional "no repo"; it is never collapsed into a hard false).
 * @returns {Promise<{ok:boolean, repo?:unknown}>}
 */
export async function fetchProjectRepoSettled(fetchProjectRepo, id, userKey, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 700;
  let res = await fetchProjectRepo(id, userKey);
  if (typeof opts.onFirst === "function") {
    try { opts.onFirst(res); } catch { /* a caller's callback never breaks the settle */ }
  }
  for (let i = 0; i < attempts && res.ok && !res.repo; i++) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    res = await fetchProjectRepo(id, userKey);
  }
  return res;
}

/**
 * The repo-connected fact for the progress map, from a settled fetch result.
 * true = linked · false = confirmed no repo (after retries) · null = unknown
 * (fetch failed) → callers must treat null as "don't lock the flow".
 *
 * A 404 is a confirmed "no repo", not an unknown (#559 검증 결함 7): the server's
 * ownership gate answers 404 when the project is not saved there (or not under
 * this key) — such a project has no linked repo for this user. The sibling
 * facts (sources, runs, PR reviews — project-steps.mjs) already read 404 that
 * way; reading it as unknown here left a project whose server copy failed to
 * save with no next action at all. Transient failures (5xx, network) stay null.
 * @param {{ok:boolean, repo?:unknown, error?:string}} res
 * @returns {boolean | null}
 */
export function repoConnectedFact(res) {
  if (res.ok) return Boolean(res.repo);
  return res.error === "HTTP 404" || res.error === "not_found" || res.error === "project_not_found" ? false : null;
}
