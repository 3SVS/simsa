/**
 * source-reachability.ts — 연결 시점에 "지금 어디까지 볼 수 있는지"를 재는 계측 (2026-08-23).
 *
 * ## 왜
 *
 * 종전엔 저장소·앱 주소를 넣으면 **아무 말 없이 저장**하고, 한참 뒤 자동수리 단계에서
 * *"GitHub 계정 연결이 필요해요"* 로 막혔다. 비공개 저장소를 쓰는 사람에게는 받을 때는
 * 조용하고 나중에 거절하는 셈이라, 무엇을 잘못했는지 알 수 없다.
 *
 * Bae 지시(2026-08-23): *"연결 시점부터 확인하는 방향으로 고쳐줘. 로그인 기능이 없으면
 * 그냥 리포 주소나 앱 주소만 넣어도 돌아가도록 유연하게 적용해줘."*
 *
 * ## 설계 원칙 — 막지 않는다, 알려준다
 *
 * 이 계측은 **게이트가 아니다.** 어떤 결과가 나와도 소스는 저장된다. 읽을 수 없다고
 * 판단되어도 마찬가지다 — 우리 판단이 틀릴 수 있고(레이트리밋·일시적 장애), 사용자를
 * 자기 저장소로부터 막을 권한이 우리에게 없다. 하는 일은 **지금 어느 깊이인지 말해주고
 * 더 깊이 가는 법을 그 자리에서 보여주는 것**뿐이다.
 *
 * 그래서 실패는 세 갈래로 **구분**한다. "못 읽음"과 "모름"을 뭉뜽그리면, 레이트리밋에
 * 걸린 순간 멀쩡한 공개 저장소가 "비공개인가 봐요"로 오진된다.
 *
 * ## 인증
 *
 * 사용자의 GitHub 연결이 있으면 그 토큰으로 잰다(비공개도 보이고, 레이트리밋도 넉넉).
 * 없으면 **비인증으로 잰다** — 공개 저장소를 읽는 데는 계정이 필요 없다는 사실을
 * 그대로 쓴다. 다만 비인증 GitHub API는 **IP당 시간당 60회**이고 Worker는 egress IP를
 * 공유하므로, 429/403은 "못 읽음"이 아니라 **"모름"** 으로 다룬다.
 */
import type { Env } from "../env.js";
import { getGitHubConnectionByUserKey } from "./github-db.js";
import { decryptToken } from "../crypto.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_WEB = "https://github.com";
const PROBE_TIMEOUT_MS = 6000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * - `readable`   지금 이 상태로 읽을 수 있다(공개이거나, 사용자의 토큰이 볼 수 있다).
 * - `needs_access` 존재하지만 우리 눈엔 안 보인다 — 비공개일 가능성이 높다.
 *                (주소 오타와 구분되지 않는다. 문구가 둘 다 열어 둬야 하는 이유.)
 * - `unknown`    재지 못했다(레이트리밋·네트워크·타임아웃). **못 읽는다는 뜻이 아니다.**
 */
export type Reachability =
  | { state: "readable"; visibility: "public" | "private"; via: "anonymous" | "user_token" }
  | { state: "needs_access"; via: "anonymous" | "user_token" }
  | { state: "unknown"; reason: "rate_limited" | "network" | "timeout" };

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 사용자의 OAuth 토큰(있으면). 없거나 복호화 실패면 null — 비인증으로 잰다. */
async function userToken(env: Env, userKey: string): Promise<string | null> {
  try {
    const conn = await getGitHubConnectionByUserKey(env, userKey);
    if (!conn?.accessTokenEnc || !env.CONCLAVE_TOKEN_KEK) return null;
    return await decryptToken(conn.accessTokenEnc, env.CONCLAVE_TOKEN_KEK);
  } catch {
    return null;
  }
}

/**
 * `owner/repo`가 지금 읽히는지 잰다. 정규화된 형태를 받는다(github-repo-ref.ts).
 * 던지지 않는다 — 재지 못하면 `unknown`.
 */
export async function probeGithubRepo(
  env: Env,
  userKey: string,
  repoFullName: string,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<Reachability> {
  const slash = repoFullName.indexOf("/");
  if (slash < 0) return { state: "unknown", reason: "network" };
  const owner = encodeURIComponent(repoFullName.slice(0, slash));
  const repo = encodeURIComponent(repoFullName.slice(slash + 1));

  const token = await userToken(env, userKey);
  const via = token ? "user_token" : "anonymous";
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "simsa-central-plane/1.0",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const resp = await withTimeout((signal) =>
    fetchImpl(`${GITHUB_API}/repos/${owner}/${repo}`, { headers, signal }),
  );
  if (!resp) return { state: "unknown", reason: "timeout" };

  if (resp.ok) {
    const body = (await resp.json().catch(() => null)) as { private?: boolean } | null;
    return { state: "readable", visibility: body?.private ? "private" : "public", via };
  }
  // 레이트리밋을 "안 보임"으로 셈하면 멀쩡한 공개 저장소를 비공개로 오진한다.
  // 비인증 GitHub API는 IP당 60회/시간이고 Worker는 egress IP를 공유한다.
  const rateLimited =
    resp.status === 429 ||
    (resp.status === 403 && resp.headers.get("x-ratelimit-remaining") === "0");
  if (rateLimited) return webFallback(repoFullName, fetchImpl);
  if (resp.status === 403 || resp.status === 404) return { state: "needs_access", via };
  return { state: "unknown", reason: "network" };
}

/**
 * API가 레이트리밋에 걸렸을 때의 폴백 — **github.com 웹 페이지**를 찍는다.
 *
 * 왜 필요한가(2026-08-24 라이브 실측): 배포 직후 익명으로 4건을 연결해 봤더니
 * **2건이 rate_limited**로 나왔다. `unknown`으로 분류한 것 자체는 옳았지만(오진을
 * 막았다), 실사용에서 절반이 "모르겠어요"면 계측이 값을 못 낸다.
 *
 * 실측으로 확인한 대안: `github.com/owner/repo`에 HEAD를 던지면 **API 레이트리밋과
 * 별개**로 동작하고(연속 20회 전부 200), 존재·공개 여부가 200/404로 갈린다.
 *
 * **성공한 API 답을 대체하지 않는다** — 오직 API가 막혔을 때만 부른다. 그래서 이
 * 폴백이 실패해도 결과는 종전과 같은 `unknown`이고, 회귀가 없다.
 * 비공개 저장소도 익명에겐 404이므로 `needs_access`가 맞다(우리 눈엔 안 보인다).
 */
async function webFallback(repoFullName: string, fetchImpl: FetchLike): Promise<Reachability> {
  const resp = await withTimeout((signal) =>
    fetchImpl(`${GITHUB_WEB}/${repoFullName}`, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "simsa-central-plane/1.0" },
      signal,
    }),
  );
  if (!resp) return { state: "unknown", reason: "rate_limited" };
  if (resp.ok) return { state: "readable", visibility: "public", via: "anonymous" };
  if (resp.status === 404) return { state: "needs_access", via: "anonymous" };
  // 웹까지 이상하면 종전대로 정직하게 "모름".
  return { state: "unknown", reason: "rate_limited" };
}

/**
 * 앱 주소가 지금 응답하는지 잰다. **로그인 벽 뒤는 보지 않는다** — 여기서 재는 것은
 * "주소가 살아 있는가"까지다. 어떤 상태 코드든 응답이 왔으면 도달한 것으로 본다
 * (401/403도 서버가 살아 있다는 증거다 — 로그인이 필요할 뿐).
 */
export async function probeWebsite(
  url: string,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<Reachability> {
  const resp = await withTimeout((signal) =>
    fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "simsa-central-plane/1.0" },
      signal,
    }),
  );
  if (!resp) return { state: "unknown", reason: "timeout" };
  // 5xx는 앱이 지금 고장 났다는 뜻이지 주소가 틀렸다는 뜻이 아니다 — 그건 검수가 할 말.
  return { state: "readable", visibility: "public", via: "anonymous" };
}
