// AF-1 (2026-08-23 설계 D-1) — 제출물 한 칸 파서.
//
// PURE — 네트워크·저장소 없음.
//
// ## 왜 이 파일이 생겼나
//
// 종전 코드 갈래 첫 화면은 이름(필수) + 빌더칩 + 호스팅 + 데이터 + 설명 + 필수동작
// 여섯 칸이었고, **정작 사용자가 손에 들고 온 것(앱 주소·저장소)을 묻지 않았다** —
// 그건 두 화면 뒤에 있었다. 필수가 아니어도 보이는 순서가 요구로 읽힌다.
//
// 이제 첫 화면은 칸 하나다. 무엇을 넣었는지는 **우리가 알아낸다.**

import { normalizeGithubRepoRef } from "./project-sources.mjs";

const MAX_INPUT_LEN = 500;

/**
 * 넣은 것이 저장소인지 앱 주소인지 가른다.
 *
 * 판별 순서가 중요하다: GitHub 주소는 **URL이기도 하므로**, 저장소 판정을 먼저 한다.
 * 그러지 않으면 `https://github.com/o/r`이 "웹사이트"로 분류돼 저장소 기능을 못 쓴다.
 *
 * @returns {{ok: true, type: "github_repo"|"website", reference: string, name: string}
 *          | {ok: false, error: "empty"|"too_long"|"unrecognized"}}
 */
export function parseSubmission(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, error: "empty" };
  if (raw.length > MAX_INPUT_LEN) return { ok: false, error: "too_long" };

  const repo = normalizeGithubRepoRef(raw);
  if (repo) return { ok: true, type: "github_repo", reference: repo, name: projectNameFor("github_repo", repo) };

  // 스킴이 붙어 있는데 http(s)가 아니면 검수 대상이 아니다. `//` 유무와 무관하게
  // 먼저 거른다 — 안 그러면 `mailto:a@b.com`이 `https://mailto:a@b.com`으로 붙어
  // **b.com이라는 엉뚱한 호스트**로 통과한다(실측으로 잡힌 구멍).
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { ok: false, error: "unrecognized" };

  // 사람은 "myapp.vercel.app"처럼 스킴을 빼고 친다. 거절하지 말고 붙여 준다.
  const withScheme = scheme ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "unrecognized" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "unrecognized" };
  // 점이 없는 호스트(localhost, 오타)는 검수할 수 있는 대상이 아니다.
  if (!url.hostname.includes(".")) return { ok: false, error: "unrecognized" };

  const reference = url.toString();
  return { ok: true, type: "website", reference, name: projectNameFor("website", reference) };
}

/**
 * 제출물에서 프로젝트 이름을 짓는다 — **이름을 묻지 않기 위해서다**(D-1).
 *
 * 임시 이름이고, 나중에 의도 추론(D-3)이 더 나은 이름을 제안하면 사용자가 고친다.
 * 지어낸 그럴듯한 이름이 아니라 **제출물에 실제로 있는 문자열**만 쓴다.
 */
export function projectNameFor(type, reference) {
  if (type === "github_repo") {
    const slash = String(reference).indexOf("/");
    return slash >= 0 ? String(reference).slice(slash + 1) : String(reference);
  }
  try {
    const u = new URL(reference);
    // 서브도메인이 이름인 경우가 많다(my-app.vercel.app → my-app).
    // 호스팅 도메인은 이름이 아니므로 앞 조각을 쓴다.
    const host = u.hostname.replace(/^www\./i, "");
    const parts = host.split(".");
    const generic = new Set(["vercel", "netlify", "app", "pages", "dev", "com", "io", "net", "co", "site", "web"]);
    const first = parts[0] ?? host;
    // 앞 조각이 일반 단어면(app.example.com) 그 다음 조각을 쓴다.
    if (parts.length > 2 && generic.has(first) && parts[1]) return parts[1];
    return first || host;
  } catch {
    return String(reference);
  }
}
