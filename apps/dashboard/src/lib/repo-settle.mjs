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
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 * @returns {Promise<{ok:boolean, repo?:unknown}>}
 */
export async function fetchProjectRepoSettled(fetchProjectRepo, id, userKey, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 700;
  let res = await fetchProjectRepo(id, userKey);
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
 * @param {{ok:boolean, repo?:unknown}} res
 * @returns {boolean | null}
 */
export function repoConnectedFact(res) {
  return res.ok ? Boolean(res.repo) : null;
}
