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
  /** stackProfile.hosting.id와 같은 어휘. 확신 없으면 넣지 않는다. */
  hosting?: "vercel" | "netlify" | "builder_hosted";
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
  } catch {
    /* 주소가 이상하면 호스팅을 단정하지 않는다 */
  }
  return undefined;
}

/** HTML에서 사람이 읽는 텍스트만 성기게 뽑는다. 파서를 들이지 않는다(Worker 예산). */
export function textFromHtml(html: string): { title?: string; text: string } {
  const strip = (s: string) =>
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => strip(m[1] ?? ""))
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
