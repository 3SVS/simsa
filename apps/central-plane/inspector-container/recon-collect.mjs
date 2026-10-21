/**
 * recon-collect.mjs — 검사 엔진 v2 S2 정찰 수집기 (2026-10-21).
 *
 * 첫 화면 HTML + 그 HTML이 참조하는 **같은 출처** 스크립트 + 그 안의 같은 출처 동적 import 1단계를 GET으로 받는다.
 * 클릭·제출 0, 앱 상태 변화 0. 받은 코드는 **실행하지 않는다**(문자열로만 넘긴다 — 판단은 src/recon.ts 순수 함수).
 * 상한: 파일 20개 · 파일당 1.5MB · 합계 6MB · 요청당 10초. 넘으면 truncated로 정직하게 표시한다.
 * 근거: 정적 정찰 실험 스크립트(tools/simsa-inspection-fixtures/static-recon-2026-10-21.mjs)를 장비로 옮긴 것.
 */

const MAX_FILES = 20;
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 6_000_000;
const TIMEOUT_MS = 10_000;

function sameOrigin(base, src) {
  try {
    const u = new URL(src, base);
    return u.origin === new URL(base).origin ? u.href : null;
  } catch {
    return null;
  }
}

/** HTML 태그를 걷어 낸 화면 글자(첫 화면 판정용 — 브라우저 innerText의 근사). */
export function visibleText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} targetUrl
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ entry: { status: number|null, bodyText: string, html: string }, files: Array<{url:string,text:string}>, truncated: boolean, errors: string[] }>}
 */
export async function collectRecon(targetUrl, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const errors = [];
  let total = 0;
  let truncated = false;
  const get = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 simsa-recon" } });
      let text = await r.text().catch(() => "");
      if (text.length > MAX_FILE_BYTES) {
        text = text.slice(0, MAX_FILE_BYTES);
        truncated = true;
      }
      return { status: r.status, text };
    } catch (err) {
      errors.push(`${url}: ${String(err?.message ?? err).slice(0, 80)}`);
      return { status: null, text: "" };
    } finally {
      clearTimeout(t);
    }
  };

  const home = await get(targetUrl);
  const entry = { status: home.status, bodyText: visibleText(home.text).slice(0, 6000), html: home.text.slice(0, 200_000) };
  const files = [{ url: targetUrl, text: home.text }];
  total += home.text.length;

  const queue = [];
  for (const m of home.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const s = sameOrigin(targetUrl, m[1]);
    if (s) queue.push([s, 0]);
  }
  const seen = new Set([targetUrl]);
  while (queue.length) {
    const [src, depth] = queue.shift();
    if (seen.has(src)) continue;
    if (files.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    seen.add(src);
    const r = await get(src);
    files.push({ url: src, text: r.text });
    total += r.text.length;
    if (depth < 1) {
      for (const m of r.text.matchAll(/import\(\s*["']([^"']+\.js)["']\s*\)|from\s*["'](\.{0,2}\/[^"']+\.js)["']/g)) {
        const next = sameOrigin(src, m[1] ?? m[2]);
        if (next) queue.push([next, depth + 1]);
      }
    }
  }
  return { entry, files, truncated, errors };
}
