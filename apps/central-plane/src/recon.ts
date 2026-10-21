/**
 * recon.ts — 검사 엔진 v2 S2: 정찰 — 첫 화면 즉시 판정 + 소스·번들 정적 사실 (2026-10-21).
 *
 * 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.2-1 · V-4(정찰에서 소스·번들을 읽는다 — 정적 사실은 **가설**의 근거일 뿐,
 * 판정은 실행 증거로). 규칙 R1~R3은 2026-10-21 정적 정찰 실험(사전 등록 `docs/pilot-2026-10/static-recon-prereg-2026-10-21.md`,
 * 결과: 벤치 #1 must 13셀 중 13 적중·원인까지 11, 정상 앱 헛짚음 0)의 규칙 그대로 + 실험이 찾은 R3 오발화 보완(현지 시간 보정 제외).
 *
 * 순수 — 의존성은 같은 패키지의 nondev-report(호스트 404 판별기 재사용 — 같은 판단을 두 곳에 두지 않는다).
 * 수집(같은 출처 GET)은 inspector-container/recon-collect.mjs가 한다.
 */
import { isLoginWallStatus, looksLikeHostNotFoundPage, looksLikeMissingIndexFile } from "./nondev-report.js";
import type { EvidenceStore } from "./evidence-chain.js";

// ─── 첫 화면 즉시 판정 ─────────────────────────────────────────────────────────

export type EntryBrokenCause = "deployment_not_found" | "missing_index_file" | "page_not_found" | "server_error" | "blank_page";

export interface EntryVerdict {
  /** 앱을 열 수 없다 = 즉시 고장(원인 포함). null이면 정찰 계속. */
  broken: { cause: EntryBrokenCause; status: number | null } | null;
  /** 401/403/407 — 앱은 있고 로그인·권한 벽이다(고장 아님). */
  loginWall: boolean;
}

/**
 * 첫 화면 응답으로 "앱이 없다"를 판정한다. 파일럿 2026-10-04: v0(Vercel DEPLOYMENT_NOT_FOUND)·Gemini(Netlify 맨 위 404 —
 * 첫 화면 파일 이름이 index.html이 아님)를 v1은 안내 페이지의 링크를 앱 버튼으로 눌러 "확인 못 함"·원인 오인으로 끝냈다.
 */
export function reconEntry(input: { targetUrl: string; status: number | null; bodyText: string | null }): EntryVerdict {
  const { targetUrl, status, bodyText } = input;
  const text = (bodyText ?? "").trim();
  if (isLoginWallStatus(status)) return { broken: null, loginWall: true };
  if (looksLikeMissingIndexFile(targetUrl, status, bodyText)) return { broken: { cause: "missing_index_file", status }, loginWall: false };
  if (looksLikeHostNotFoundPage(bodyText)) {
    const cause: EntryBrokenCause = /DEPLOYMENT_NOT_FOUND|This deployment (?:is|was)/i.test(text) ? "deployment_not_found" : "page_not_found";
    return { broken: { cause, status }, loginWall: false };
  }
  if (status !== null && status >= 500) return { broken: { cause: "server_error", status }, loginWall: false };
  if (status !== null && status >= 400) return { broken: { cause: "page_not_found", status }, loginWall: false };
  if (status !== null && status >= 200 && status < 300 && text.length === 0) return { broken: { cause: "blank_page", status }, loginWall: false };
  return { broken: null, loginWall: false };
}

// ─── 정적 사실 ────────────────────────────────────────────────────────────────

export const STATIC_FACT_RULES = ["R1", "R2", "R3", "R4", "R5"] as const;
export type StaticFactRule = (typeof STATIC_FACT_RULES)[number];

export type StaticFactClass =
  | "missing_backend_config"
  | "client_only_storage"
  | "timezone_date"
  | "needs_api_key"
  | "server_rendered_dates";

export interface StaticFact {
  rule: StaticFactRule;
  cls: StaticFactClass;
  /** 사실이 나온 파일(같은 출처 경로) */
  file: string;
  /** 근거 발췌(앞뒤 60자) — 증거물 원문이 된다 */
  excerpt: string;
}

export interface SourceFile {
  url: string;
  text: string;
}

const EXCERPT_PAD = 60;

function excerptAt(text: string, index: number, len: number): string {
  return text.slice(Math.max(0, index - EXCERPT_PAD), index + len + EXCERPT_PAD).replace(/\s+/g, " ");
}

function firstMatch(files: readonly SourceFile[], re: RegExp, accept: (text: string, index: number) => boolean = () => true): { file: string; excerpt: string } | null {
  for (const f of files) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of f.text.matchAll(g)) {
      if (m.index === undefined || !accept(f.text, m.index)) continue;
      return { file: f.url, excerpt: excerptAt(f.text, m.index, m[0].length) };
    }
  }
  return null;
}

// R1 백엔드 설정 자리표시자·미설정 안내(실험 R1 그대로).
const RE_R1 = /YOUR_SUPABASE|SUPABASE_URL\s*[:=]\s*["']\s*["']|config\.js에|연결 정보를 입력|연결 설정을 먼저|your-project\.supabase|<your/;
// R2 저장소 쓰기 + 서버 쓰기 흔적 없음(실험 R2 그대로).
const RE_R2_STORE = /localStorage\.setItem|indexedDB\.open/;
const RE_R2_SERVER = /fetch\(|axios|\.insert\(|\.from\(|method:\s*["']POST|supabase|firebase|firestore|\/api\//i;
// R3 클라이언트 "오늘"을 UTC로 만든다(실험 R3) — 단, 같은 식 앞쪽에 현지 시간 보정(getTimezoneOffset)이 있으면 제외(실험 오발화 2건: chatgpt·v0).
const RE_R3 = /toISOString\(\)\.slice\(0,\s*10\)|toISOString\(\)\.split\(["']T["']\)\[0\]|toISOString\(\)\.substring\(0,\s*10\)/;
const R3_CORRECTION_WINDOW = 160;
// R4 사용자 본인의 API 키를 넣어야 시작(파일럿 Claude 앱, F13).
const RE_R4 = /API\s*키를?\s*(?:입력|넣)|enter your (?:own )?(?:OpenAI |Anthropic |Claude |Gemini )?API key|placeholder=["'][^"']*(?:sk-|API key|API 키)/i;
// R5 서버 렌더 프레임워크(Next 서버 액션 등) — "오늘" 계산이 서버 시간대에 있을 수 있다(v0: 서버 UTC 날짜, 번들엔 안 보임).
const RE_R5 = /next-action|__next_f|"\$ACTION_ID_|createServerReference/;

/** 같은 출처 HTML·번들에서 정적 사실을 뽑는다(가설의 근거 — 판정 아님). 규칙마다 첫 근거 하나. */
export function extractStaticFacts(files: readonly SourceFile[]): StaticFact[] {
  const facts: StaticFact[] = [];
  const all = files.map((f) => f.text).join("\n");
  const r1 = firstMatch(files, RE_R1);
  if (r1) facts.push({ rule: "R1", cls: "missing_backend_config", ...r1 });
  if (!RE_R2_SERVER.test(all)) {
    const r2 = firstMatch(files, RE_R2_STORE);
    if (r2) facts.push({ rule: "R2", cls: "client_only_storage", ...r2 });
  }
  const r3 = firstMatch(files, RE_R3, (text, i) => !/getTimezoneOffset/.test(text.slice(Math.max(0, i - R3_CORRECTION_WINDOW), i)));
  if (r3) facts.push({ rule: "R3", cls: "timezone_date", ...r3 });
  const r4 = firstMatch(files, RE_R4);
  if (r4) facts.push({ rule: "R4", cls: "needs_api_key", ...r4 });
  const r5 = firstMatch(files, RE_R5);
  if (r5) facts.push({ rule: "R5", cls: "server_rendered_dates", ...r5 });
  return facts;
}

/** 정적 사실을 증거물(kind "source")로 남기고 id를 돌려준다 — 가설(S3)·판정(S5)이 이 id를 인용한다. */
export function recordStaticFacts(store: Pick<EvidenceStore, "add">, facts: readonly StaticFact[]): Array<{ fact: StaticFact; artifactId: string | null }> {
  return facts.map((fact) => ({
    fact,
    artifactId: store.add("source", `${fact.rule} ${fact.cls} — ${fact.file}`, fact.excerpt, { url: fact.file }),
  }));
}
