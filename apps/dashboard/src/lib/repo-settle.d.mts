export type RepoFetchResult = { ok: boolean; repo?: unknown; error?: string };

/**
 * Generic on the fetch's own result type so callers keep their concrete `repo`
 * type (e.g. ProjectRepoResponse's `LinkedRepo | null`) instead of `unknown`.
 */
export function fetchProjectRepoSettled<T extends RepoFetchResult>(
  fetchProjectRepo: (id: string, userKey: string) => Promise<T>,
  id: string,
  userKey: string,
  opts?: {
    attempts?: number;
    delayMs?: number;
    /** Called once with the first answer, before any retry (#559 여정 렌즈 결함 12). */
    onFirst?: (res: T) => void;
  },
): Promise<T>;

/** true = linked · false = confirmed no repo (incl. 404: not saved / not this key) · null = unknown (don't lock). */
export function repoConnectedFact(res: RepoFetchResult): boolean | null;
