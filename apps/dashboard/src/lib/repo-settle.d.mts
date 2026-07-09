export type RepoFetchResult = { ok: boolean; repo?: unknown };

/**
 * Generic on the fetch's own result type so callers keep their concrete `repo`
 * type (e.g. ProjectRepoResponse's `LinkedRepo | null`) instead of `unknown`.
 */
export function fetchProjectRepoSettled<T extends RepoFetchResult>(
  fetchProjectRepo: (id: string, userKey: string) => Promise<T>,
  id: string,
  userKey: string,
  opts?: { attempts?: number; delayMs?: number },
): Promise<T>;

/** true = linked · false = confirmed no repo · null = unknown (don't lock). */
export function repoConnectedFact(res: RepoFetchResult): boolean | null;
