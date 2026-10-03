/**
 * source-evidence.ts — AF-3 (설계 D-3): 제출물에서 **증거**를 모은다.
 *
 * ## 왜
 *
 * Bae 지적: *"제작 의도도 모르고."* 맞다. 다만 "모른다"가 "물어봐야 한다"를 뜻하지는
 * 않는다. 비개발자에게 빈칸을 내미는 것보다 **초안을 주고 고치게 하는 편이 훨씬 쉽다.**
 *
 * 그리고 우리가 묻던 것 대부분은 제출물에 이미 적혀 있다 — 저장소의 README와
 * `package.json`, 앱 주소의 title/description/헤딩. **감지할 수 있는 것을 인터뷰로
 * 묻고 있었다.**
 *
 * ## 정직성 계약 (D-3)
 *
 * 이 모듈은 **읽은 것만 돌려준다.** 못 읽었으면 빈 증거이고, 빈 증거는 빈 초안이 된다.
 * 지어낸 의도는 잘못된 기준을 만들고, 잘못된 기준은 잘못된 검수 결과를 만든다 —
 * 이 제품에서 가장 비싼 실패다. 그래서 여기서는 **추론하지 않고 수집만** 한다.
 *
 * 스택 감지는 **결정론적**이다(의존성 이름·응답 헤더). LLM에게 물어보지 않는다 —
 * 사실을 확인할 수 있는 것을 추측에 맡길 이유가 없다.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 8000;
const MAX_README_CHARS = 6000;
const MAX_PAGE_CHARS = 4000;

export type StackHint = {
  /**
   * stackProfile.hosting.id와 같은 어휘. 확신 없으면 넣지 않는다.
   * C4a(재정렬 D-8 amend, detected_stack): 빌더가 호스팅해 주는 앱(lovable·bolt·replit·base44)은
   * "어떤 도구로 만들었든"의 도구 축이므로 개별 이름으로 읽는다(집계 축). 소비자는 미지 id를
   * 중립 처리한다(service-examples.ts).
   */
  hosting?: "vercel" | "netlify" | "builder_hosted" | "lovable" | "bolt" | "replit" | "base44";
  data?: "supabase" | "firebase";
  /** 감지된 프레임워크·도구 이름(표시용, 자유 문자열). */
  tools: string[];
};

export type SourceEvidence = {
  kind: "github_repo" | "website";
  reference: string;
  /** 사람이 쓴 설명 — README 또는 페이지 텍스트. 없으면 빈 문자열. */
  text: string;
  /** 저장소/사이트 제목. */
  title?: string;
  stack: StackHint;
  /** 무엇을 실제로 읽었는지 — 초안이 빈약할 때 이유를 설명하기 위해. */
  readSources: string[];
};

async function fetchText(
  url: string,
  fetchImpl: FetchLike,
  headers: Record<string, string> = {},
  maxChars = MAX_README_CHARS,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      headers: { "user-agent": "simsa-central-plane/1.0", ...headers },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t.slice(0, maxChars);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 의존성 이름에서 스택을 읽는다 — 확인할 수 있는 사실이므로 추측하지 않는다. */
export function stackFromPackageJson(raw: string | null): StackHint {
  const out: StackHint = { tools: [] };
  if (!raw) return out;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return out;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  if (has("@supabase/supabase-js") || has("@supabase/ssr")) out.data = "supabase";
  else if (has("firebase") || has("firebase-admin")) out.data = "firebase";

  if (has("@vercel/analytics") || has("@vercel/speed-insights")) out.hosting = "vercel";
  else if (has("netlify-cli") || has("@netlify/functions")) out.hosting = "netlify";

  for (const [name, label] of [
    ["next", "Next.js"],
    ["react", "React"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["@angular/core", "Angular"],
    ["express", "Express"],
    ["prisma", "Prisma"],
    ["drizzle-orm", "Drizzle"],
    ["tailwindcss", "Tailwind CSS"],
  ] as const) {
    if (has(name)) out.tools.push(label);
  }
  return out;
}

/** 응답 헤더에서 호스팅을 읽는다. 헤더는 벤더가 스스로 붙인 것이라 신뢰도가 높다. */
export function hostingFromHeaders(headers: Headers, url: string): StackHint["hosting"] | undefined {
  const server = (headers.get("server") ?? "").toLowerCase();
  if (headers.has("x-vercel-id") || server.includes("vercel")) return "vercel";
  if (headers.has("x-nf-request-id") || server.includes("netlify")) return "netlify";
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".vercel.app")) return "vercel";
    if (host.endsWith(".netlify.app")) return "netlify";
    // C4a — 빌더 호스트. 등록 가능한 도메인의 **접미(레이블 경계)**로만 판정한다:
    // `lovable.app.evil.example`은 lovable이 아니다.
    for (const [suffix, hosting] of BUILDER_HOSTS) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return hosting;
    }
  } catch {
    /* 주소가 이상하면 호스팅을 단정하지 않는다 */
  }
  return undefined;
}

/** 빌더가 자기 도메인으로 서빙하는 앱 주소 → 도구 이름. 벤더 공개 도메인만(추측 아님). */
const BUILDER_HOSTS: ReadonlyArray<readonly [string, NonNullable<StackHint["hosting"]>]> = [
  ["lovable.app", "lovable"],
  ["lovableproject.com", "lovable"],
  ["bolt.host", "bolt"],
  ["replit.app", "replit"],
  ["repl.co", "replit"],
  ["base44.app", "base44"],
];

// ─── 선형 HTML 훑기 (2026-10-01) ──────────────────────────────────────────────
//
// 이 파일은 사용자가 준 **아무 주소**의 HTML(최대 200,000자)을 읽는다 — 그 HTML은 그 주소의
// 주인이 마음대로 쓴다. 예전에는 정규식 여섯 개로 훑었는데, 닫는 짝이 없는 여는 조각이
// 반복되면 여는 자리마다 문서 끝까지 다시 훑어 **제곱 시간**이 들었다(3a1ca07 실측:
// `<h1`×n 200K 15초, `<a`×n 200K 11.6초, `<meta name="description"`×n은 50K에서 57초).
// 아래는 같은 정규식과 **같은 결과**를 내는 한 방향 훑기다(차등 퍼징 테스트로 대조:
// test/redos-linear-hardening.test.mjs). 옛 정규식은 각 함수 주석에 적어 둔다.

/**
 * ASCII 글자만 소문자로 — 길이가 그대로라 위치가 원문과 맞는다. 유니코드 플래그 없는
 * `/i`가 접는 것도 정확히 이것뿐이다(ASCII 밖 글자는 ASCII 글자와 같게 보지 않는다).
 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** `s.replace(/<script[\s\S]*?<\/script>/gi, " ")` (style도 같은 모양). */
function removeElements(s: string, tag: "script" | "style"): string {
  const lower = asciiLower(s);
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = "";
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start === -1) break;
    // 닫는 짝이 없으면 이후의 어느 여는 조각에도 없다 — 거기서 끝.
    const end = lower.indexOf(close, start + open.length);
    if (end === -1) break;
    out += `${s.slice(pos, start)} `;
    pos = end + close.length;
  }
  return out + s.slice(pos);
}

/** `s.replace(/<[^>]+>/g, " ")`. `<>`(사이가 빈 것)는 태그가 아니다. */
function replaceTags(s: string): string {
  let out = "";
  let pos = 0;
  let lt = s.indexOf("<");
  while (lt !== -1) {
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) break; // 이 뒤의 어느 "<"도 닫히지 않는다.
    if (gt > lt + 1) {
      out += `${s.slice(pos, lt)} `;
      pos = gt + 1;
      lt = s.indexOf("<", pos);
    } else {
      lt = s.indexOf("<", lt + 1);
    }
  }
  return out + s.slice(pos);
}

function stripHtml(s: string): string {
  return replaceTags(removeElements(removeElements(s, "script"), "style"))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim()`.
 * 첫 `<title`이 짝을 못 찾으면 뒤의 어느 `<title`도 못 찾으므로 첫 것만 본다.
 */
function titleOf(html: string, lower: string): string | undefined {
  const open = lower.indexOf("<title");
  if (open === -1) return undefined;
  const gt = html.indexOf(">", open + 6);
  if (gt === -1) return undefined;
  const close = lower.indexOf("</title>", gt + 1);
  if (close === -1) return undefined;
  return html.slice(gt + 1, close).trim();
}

/** `<h1`·`<h2`의 다음 위치. */
function nextHeadingOpen(lower: string, from: number): number {
  let i = lower.indexOf("<h", from);
  while (i !== -1) {
    const c = lower.charCodeAt(i + 2);
    if (c === 0x31 || c === 0x32) return i;
    i = lower.indexOf("<h", i + 1);
  }
  return -1;
}

/** `</h1>`·`</h2>`의 다음 위치. */
function nextHeadingClose(lower: string, from: number): number {
  let i = lower.indexOf("</h", from);
  while (i !== -1) {
    const c = lower.charCodeAt(i + 3);
    if ((c === 0x31 || c === 0x32) && lower.charCodeAt(i + 4) === 0x3e) return i;
    i = lower.indexOf("</h", i + 1);
  }
  return -1;
}

/** `[...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => m[1])`. */
function headingTexts(html: string, lower: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = nextHeadingOpen(lower, from);
    if (open === -1) break;
    const gt = html.indexOf(">", open + 3);
    if (gt === -1) break; // 뒤의 여는 조각도 ">"를 못 찾는다.
    const close = nextHeadingClose(lower, gt + 1);
    if (close === -1) break; // 뒤의 여는 조각도 닫는 짝을 못 찾는다.
    out.push(html.slice(gt + 1, close));
    from = close + 5;
  }
  return out;
}

const NAME_DESCRIPTION_LEN = 'name="description"'.length; // 18
const CONTENT_EQ_LEN = "content=".length; // 8

function isQuote(c: string): boolean {
  return c === '"' || c === "'";
}

/**
 * `/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1]`.
 *
 * 그 정규식이 고르는 값을 정확히 따른다:
 *   - `<meta`부터 첫 `>` 앞까지가 한 구간이다(`[^>]+` 두 개는 `>`를 못 넘는다). 값 자체는 `>`를 넘을 수 있다.
 *   - 욕심쟁이 `[^>]+` 때문에 값은 구간 안의 **마지막** 유효한 `content=`(따옴표 + 빈칸 아닌 값 + 따옴표)의 값이다.
 *   - 그 `content=`보다 최소 한 글자 앞에서 끝나는 `name="description"`이 `<meta` 뒤 한 글자 이상 떨어져 있으면 맞는다.
 *   - 맞는 가장 왼쪽 `<meta`가 답이다.
 * 구간마다 한 번만 훑고(`<meta`가 한 구간에 여럿이어도), 다음 따옴표 위치는 한 번에 미리 잰다.
 */
function metaDescription(html: string, lower: string): string | undefined {
  let meta = lower.indexOf("<meta");
  if (meta === -1) return undefined;
  const n = html.length;
  // nextQuote[i] = i 이상에서 처음 나오는 따옴표 위치(없으면 n).
  const nextQuote = new Int32Array(n + 1);
  nextQuote[n] = n;
  for (let i = n - 1; i >= 0; i--) nextQuote[i] = isQuote(html.charAt(i)) ? i : (nextQuote[i + 1] ?? n);
  const validContentValueStart = (c: number): boolean => {
    if (!isQuote(html.charAt(c + CONTENT_EQ_LEN))) return false;
    const valueStart = c + CONTENT_EQ_LEN + 1;
    if (valueStart >= n) return false;
    const q = nextQuote[valueStart] ?? n;
    return q < n && q > valueStart;
  };

  let regionEnd = -1;
  let names: number[] = [];
  let nameIdx = 0;
  let lastContent = -1;
  while (meta !== -1) {
    if (meta >= regionEnd) {
      const gt = html.indexOf(">", meta + 5);
      regionEnd = gt === -1 ? n : gt;
      const from = meta + 6;
      const seg = from < regionEnd ? lower.slice(from, regionEnd) : "";
      names = [];
      nameIdx = 0;
      for (let k = seg.indexOf("name="); k !== -1; k = seg.indexOf("name=", k + 1)) {
        const p = from + k;
        if (
          isQuote(html.charAt(p + 5)) &&
          lower.startsWith("description", p + 6) &&
          isQuote(html.charAt(p + 17))
        ) {
          names.push(p);
        }
      }
      lastContent = -1;
      for (let k = seg.lastIndexOf("content="); k !== -1; k = k > 0 ? seg.lastIndexOf("content=", k - 1) : -1) {
        const c = from + k;
        if (validContentValueStart(c)) {
          lastContent = c;
          break;
        }
      }
    }
    while (nameIdx < names.length && (names[nameIdx] ?? Infinity) < meta + 6) nameIdx += 1;
    const p = names[nameIdx];
    if (p !== undefined && lastContent !== -1 && p + NAME_DESCRIPTION_LEN + 1 <= lastContent) {
      const valueStart = lastContent + CONTENT_EQ_LEN + 1;
      return html.slice(valueStart, nextQuote[valueStart] ?? n);
    }
    meta = lower.indexOf("<meta", meta + 1);
  }
  return undefined;
}

/** HTML에서 사람이 읽는 텍스트만 성기게 뽑는다. 파서를 들이지 않는다(Worker 예산). 입력 길이에 선형. */
export function textFromHtml(html: string): { title?: string; text: string } {
  const strip = stripHtml;
  const lower = asciiLower(html);

  const title = titleOf(html, lower);
  const desc = metaDescription(html, lower);
  const headings = headingTexts(html, lower)
    .map((m) => strip(m))
    .filter(Boolean)
    .slice(0, 8);

  const parts = [desc, ...headings].filter(Boolean) as string[];
  // 제목·설명·헤딩이 전부 비면 본문에서 앞부분만 — 광고 문구라도 없는 것보다 낫다.
  const body = parts.length > 0 ? parts.join("\n") : strip(html).slice(0, MAX_PAGE_CHARS);
  return { ...(title ? { title } : {}), text: body.slice(0, MAX_PAGE_CHARS) };
}

/** GitHub 저장소에서 증거를 모은다. 공개 저장소는 토큰 없이 읽힌다. */
export async function evidenceFromRepo(
  repoFullName: string,
  fetchImpl: FetchLike,
  token?: string,
): Promise<SourceEvidence> {
  const readSources: string[] = [];
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const raw = (path: string) =>
    fetchText(`https://raw.githubusercontent.com/${repoFullName}/HEAD/${path}`, fetchImpl, auth);

  const [readme, readmeLower, pkgRaw] = await Promise.all([raw("README.md"), raw("readme.md"), raw("package.json")]);
  const readmeText = readme ?? readmeLower ?? "";
  if (readmeText) readSources.push("README");
  if (pkgRaw) readSources.push("package.json");

  const stack = stackFromPackageJson(pkgRaw);
  let title: string | undefined;
  if (pkgRaw) {
    try {
      const name = (JSON.parse(pkgRaw) as { name?: string }).name;
      if (typeof name === "string" && name.trim()) title = name.trim();
    } catch {
      /* 이름을 못 읽어도 나머지 증거는 유효하다 */
    }
  }
  // README 제목(# ...)이 package name보다 사람 말에 가깝다.
  const h1 = /^#\s+(.+)$/m.exec(readmeText)?.[1]?.trim();
  if (h1) title = h1;

  return {
    kind: "github_repo",
    reference: repoFullName,
    text: readmeText,
    ...(title ? { title } : {}),
    stack,
    readSources,
  };
}

/** 앱 주소에서 증거를 모은다. 로그인 벽 뒤는 보지 않는다 — 공개 표면만(D-4 L1). */
export async function evidenceFromWebsite(url: string, fetchImpl: FetchLike): Promise<SourceEvidence> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let html = "";
  let hosting: StackHint["hosting"] | undefined;
  const readSources: string[] = [];
  try {
    const r = await fetchImpl(url, {
      headers: { "user-agent": "simsa-central-plane/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    hosting = hostingFromHeaders(r.headers, url);
    if (r.ok) {
      html = (await r.text()).slice(0, 200_000);
      readSources.push("page");
    }
  } catch {
    /* 못 읽으면 빈 증거 — 지어내지 않는다 */
  } finally {
    clearTimeout(timer);
  }

  const { title, text } = html ? textFromHtml(html) : { title: undefined, text: "" };
  return {
    kind: "website",
    reference: url,
    text,
    ...(title ? { title } : {}),
    stack: { ...(hosting ? { hosting } : {}), tools: [] },
    readSources,
  };
}

/**
 * 증거를 기존 아이디어→스펙 생성기가 먹을 수 있는 한 문단으로 만든다.
 *
 * **새 LLM 경로를 만들지 않는다** — 검증된 기계(generate.ts)를 그대로 쓰고 입력만
 * 바꾼다. 증거가 비면 **빈 문자열을 돌려주고**, 호출부는 생성 자체를 건너뛴다.
 * 빈 증거로 LLM을 부르면 그럴듯한 의도를 지어내는데, 그게 정확히 D-3이 금지하는 것이다.
 */
export function composeIdeaFromEvidence(ev: SourceEvidence, locale: "ko" | "en" = "ko"): string {
  // ★임계를 영어 기준으로 잡으면 한국어를 차별한다 (Rule 6, 실측으로 잡힘).
  // 한국어는 글자당 정보량이 커서 "주말 티타임을 찾아주는 서비스입니다"(19자)가
  // 이미 완전한 설명이다. 30자 임계는 이런 **멀쩡한 한국어 설명을 걸러냈다.**
  // 15자면 "TODO"·"WIP" 같은 빈 껍데기는 여전히 걸러진다.
  const MIN_DESCRIPTION_CHARS = 15;
  const meaningful = ev.text.trim().length >= MIN_DESCRIPTION_CHARS || (ev.title ?? "").trim().length > 0;
  if (!meaningful) return "";

  const lines: string[] = [];
  lines.push(
    locale === "en"
      ? "Describe this existing app from the evidence below. Do not invent features that are not mentioned."
      : "아래 증거만으로 이미 만들어진 이 앱을 설명하세요. 증거에 없는 기능을 지어내지 마세요.",
  );
  if (ev.title) lines.push(`\n[Name] ${ev.title}`);
  lines.push(`\n[Source] ${ev.kind === "github_repo" ? `GitHub ${ev.reference}` : ev.reference}`);
  if (ev.stack.tools.length > 0) lines.push(`[Built with] ${ev.stack.tools.join(", ")}`);
  if (ev.stack.hosting) lines.push(`[Hosting] ${ev.stack.hosting}`);
  if (ev.stack.data) lines.push(`[Data] ${ev.stack.data}`);
  if (ev.text.trim()) lines.push(`\n[What the project says about itself]\n${ev.text.trim()}`);
  return lines.join("\n");
}
