/**
 * github-repo-ref.ts — GitHub 저장소 참조 정규화 (2026-08-23).
 *
 * 왜 별도 모듈인가: 같은 정규화를 **입력구와 소비처가 따로 갖고 있었고, 서로 달랐다**.
 * 소스 연결(POST /workspace/projects/:id/sources)은 `owner/repo` 형태만 받아
 * `invalid_repo`로 거절했는데, 정작 그 값을 쓰는 수리 작업은 이미
 * `https://github.com/owner/repo.git` 같은 주소를 받아 정규화하고 있었다.
 * 그래서 사용자가 브라우저에서 복사한 **주소를 그대로 붙여넣으면 거절당했다** —
 * 시스템이 안쪽에서는 처리할 수 있는 형태인데도.
 *
 * Bae 실사용 지적(2026-08-23): *"깃헙 계정 연결하는 것도 나는 계정이 많아서 잘 안 되더라.
 * 그냥 깃헙 주소 넣는 거는 안 돼?"* — 공개 저장소를 **읽기만** 하는 데는 계정이 필요
 * 없다(연결 API는 애초에 인증을 요구하지 않는다). 막고 있던 것은 입력 형식뿐이었다.
 *
 * 계정이 실제로 필요한 지점은 따로다: **비공개 저장소 읽기**와 **수정 PR 쓰기**.
 */

/** GitHub가 허용하는 owner/repo 문자 집합. owner는 39자, repo는 100자 상한. */
const REPO_FULL_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/**
 * 사용자가 넣을 법한 모든 형태를 `owner/repo`로 정규화한다. 정규화 후에도
 * GitHub의 문자 규칙을 만족하지 않으면 null — **관대하게 받되 검증은 유지한다**.
 *
 * 받는 형태:
 *   owner/repo · https://github.com/owner/repo · http://www.github.com/owner/repo/
 *   git@github.com:owner/repo.git · https://github.com/owner/repo/tree/main/src
 */
export function normalizeGithubRepoRef(input: string): string | null {
  let ref = (input ?? "").trim();
  if (!ref) return null;

  // SSH 형태(git@github.com:owner/repo)
  const beforeHost = ref;
  ref = ref.replace(/^git@github\.com:/i, "");
  // HTTP(S) + 선택적 www
  ref = ref.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  /** 호스트를 떼어냈다 = 사용자가 **주소를 붙여넣었다**는 뜻. */
  const fromUrl = ref !== beforeHost;
  // 흔한 꼬리: .git · 트레일링 슬래시 · 쿼리/프래그먼트
  ref = ref.replace(/[?#].*$/, "");
  ref = ref.replace(/\.git$/i, "");
  ref = ref.replace(/\/+$/, "");

  // 저장소 안쪽 경로를 복사해 온 경우(/tree/main/src, /blob/…, /pull/12) 앞 두 조각만.
  //
  // **주소에서 온 경우에만** 자른다. 손으로 친 `a/b/c`는 붙여넣기가 아니라 오타이고,
  // 그걸 조용히 `a/b`로 고쳐 받으면 사용자가 의도하지 않은 저장소에 연결된다.
  if (fromUrl) {
    const parts = ref.split("/").filter(Boolean);
    if (parts.length > 2) ref = `${parts[0]}/${parts[1]}`;
  }

  return REPO_FULL_NAME_RE.test(ref) ? ref : null;
}
