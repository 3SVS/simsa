/**
 * single-file-fix.mjs — B5: 빌드 없이 공개된 단일 HTML 앱(index.html 하나에 스크립트가 들어 있는 앱)의 **고친 파일**.
 *
 *   1) 단일 파일 앱인가 — 같은 출처의 번들 스크립트(/assets/*.js, /_next/, type=module src)가 없고 인라인 스크립트가 있다
 *   2) 고침 제안 — LLM이 실패한 기준(재현 순서·기대·실제·근거)을 보고 **정확히 한 번 나오는** search → replace 편집만 낸다
 *      (파일 전체를 다시 쓰게 하면 잘린 파일이 나온다 — #439 대형 파일 교훈). 적용이 하나라도 어긋나면 고친 파일 없음.
 *   3) 검증은 실행기가 한다 — 고친 파일을 그 주소에 **로컬로 끼워 넣고**(page.route) 실패했던 기준을 다시 돈다.
 *      검증을 통과한 기준만 "고쳐짐"이라 말한다. 서버가 필요한 결함(공유·저장)은 단일 파일로 못 고치므로 정직하게 남는다.
 */

export const SINGLE_FILE_MAX_BYTES = 400_000;
export const CORRECTED_FILE_REPORT_MAX = 150_000;

export function isSingleFileApp(html, url) {
  if (typeof html !== "string" || html.length === 0 || html.length > SINGLE_FILE_MAX_BYTES) return false;
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
  const sameOriginBundle = srcs.some((s) => {
    try {
      const u = new URL(s, origin + "/");
      return u.origin === origin && /\.(m?js)(\?|$)/.test(u.pathname);
    } catch {
      return false;
    }
  });
  const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].reduce((n, m) => n + m[1].trim().length, 0);
  return !sameOriginBundle && inline >= 200;
}

/** 편집 적용 — 각 search가 파일에 **정확히 한 번**. 아니면 { ok:false, error }. */
export function applyExactEdits(html, edits) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 20) return { ok: false, error: "no_edits" };
  let out = html;
  for (const [i, e] of edits.entries()) {
    if (!e || typeof e.search !== "string" || typeof e.replace !== "string" || e.search.length < 8) return { ok: false, error: `edit_${i}_invalid` };
    const first = out.indexOf(e.search);
    if (first < 0) return { ok: false, error: `edit_${i}_not_found` };
    if (out.indexOf(e.search, first + 1) >= 0) return { ok: false, error: `edit_${i}_ambiguous` };
    out = out.slice(0, first) + e.replace + out.slice(first + e.search.length);
  }
  return { ok: true, html: out };
}

/** 사람이 읽는 차이(편집별 −/+ 줄). */
export function editsDiff(edits) {
  return edits
    .map((e, i) => [`@@ edit ${i + 1}`, ...e.search.split("\n").map((l) => `- ${l}`), ...e.replace.split("\n").map((l) => `+ ${l}`)].join("\n"))
    .join("\n");
}

export function singleFileFixPrompt(html, failedRows, locale = "ko") {
  const list = failedRows
    .map((r, i) => `${i + 1}. [${r.id}] ${r.title}\n   expected: ${r.then}\n   steps: ${(r.actions ?? []).join(" → ")}\n   actual: ${r.reason}\n   evidence: ${(r.evidence ?? []).join(" / ")}`)
    .join("\n");
  return [
    "You fix a single-file web app (one index.html with inline scripts). Below are acceptance criteria that FAILED in a real browser.",
    "Return ONLY JSON: {\"edits\":[{\"search\":\"<exact text copied from the file, unique, ≥ 8 chars>\",\"replace\":\"<new text>\"}],\"cannotFix\":[\"<criterion id>: <why — e.g. needs a server/database>\"]}",
    "Rules: minimal edits; each search must appear exactly once in the file; keep everything else unchanged; do not add external services or keys; if a failure needs a real back end (data shared between people/devices), list it in cannotFix instead of faking it.",
    locale === "en" ? "Write cannotFix reasons in English." : "cannotFix 이유는 한국어로.",
    "",
    "Failed criteria:",
    list,
    "",
    "The file:",
    html,
  ].join("\n");
}
