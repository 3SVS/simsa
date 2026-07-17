/**
 * deploy-trend-watcher.ts — D14 (2026-07-17, Bae 승인).
 *
 * "항상 Vercel·Supabase"가 아니라 그 시점의 가장 쉬운 길을 안내하기 위한
 * 배포·서비스 동향 감시. 주 1회(월 07:00, changelog-monitor와 같은 크론 패스)
 * 플랫폼 CLI/SDK 릴리스를 훑고, "비개발자의 배포·온보딩 경로가 바뀌었는가"만
 * Haiku로 걸러 D1 리뷰 큐(`deploy_trend_suggestions`)에 쌓는다.
 *
 * 자동 반영은 하지 않는다 — 갱신 대상은 workspace/service-examples.ts 단일
 * 파일이고, 사람이 큐를 보고 그 파일을 고친다(잘못된 안내가 빌더팩에 바로
 * 실리는 것 방지). 상태 하이워터마크는 spec_monitor_state를 "deploytrend-"
 * prefix로 재사용(신규 상태 테이블 없음).
 */
import type { Env } from "./env.js";

/** 감시 소스 — 파라미터. 플랫폼 능력 변화의 프록시로 CLI/SDK 릴리스를 쓴다. */
export const DEPLOY_TREND_SOURCES: ReadonlyArray<{ id: string; repo: string; label: string }> = [
  { id: "vercel", repo: "vercel/vercel", label: "Vercel" },
  { id: "netlify", repo: "netlify/cli", label: "Netlify" },
  { id: "cloudflare", repo: "cloudflare/workers-sdk", label: "Cloudflare" },
  { id: "supabase", repo: "supabase/cli", label: "Supabase" },
  { id: "resend", repo: "resend/resend-node", label: "Resend" },
];

const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 8_000;
const PER_SOURCE_RELEASE_LIMIT = 3;
const STATE_PREFIX = "deploytrend-";

const FILTER_PROMPT = `You read release notes from a deployment/backend platform's CLI or SDK. Your ONLY question: does this release change how a NON-DEVELOPER (using an AI coding agent) would deploy or onboard an app on this platform?

Relevant examples: a new drag-and-drop or one-command deploy path, a simpler auth/login flow, a changed dashboard click-path for getting API keys, a deprecated deploy method, free-tier changes that affect the getting-started path.
NOT relevant: internal refactors, bug fixes, flags for advanced users, performance, framework adapters.

Output ONE JSON object PER LINE (JSONL, no fences), max 3 lines, or NOTHING if irrelevant:
{"relevance":"high"|"medium","title":"<3-8 words>","summary_ko":"<한 문장, 비개발자 온보딩 관점에서 무엇이 바뀌었는지 한국어로>","guidance_key":"deploy"|"storage"|"email"|"payment"|"other"}

Base ONLY on the notes provided. Do not invent.`;

interface ReleaseItem {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

async function fetchReleases(repo: string): Promise<ReleaseItem[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "conclave-ai/deploy-trend-watcher",
        "x-github-api-version": "2022-11-28",
      },
      signal: ctrl.signal,
    });
    if (!r.ok) return [];
    const items = (await r.json()) as ReleaseItem[];
    return items.filter((x) => !x.draft && !x.prerelease && x.body && x.published_at);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function callHaiku(env: Env, user: string): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: FILTER_PROMPT,
        messages: [{ role: "user", content: user }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    return j.content?.[0]?.text ?? "";
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface TrendSuggestion {
  relevance: "high" | "medium";
  title: string;
  summary_ko: string;
  guidance_key: string;
}

export function parseSuggestions(text: string): TrendSuggestion[] {
  const out: TrendSuggestion[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (o.relevance !== "high" && o.relevance !== "medium") continue;
      if (typeof o.title !== "string" || typeof o.summary_ko !== "string") continue;
      out.push({
        relevance: o.relevance,
        title: String(o.title).slice(0, 200),
        summary_ko: String(o.summary_ko).slice(0, 500),
        guidance_key: typeof o.guidance_key === "string" ? String(o.guidance_key).slice(0, 32) : "other",
      });
    } catch {
      /* skip malformed */
    }
  }
  return out.slice(0, 3);
}

async function getHighWaterMark(env: Env, sourceId: string): Promise<string | null> {
  const r = await env.DB.prepare(
    `SELECT last_release_published_at FROM spec_monitor_state WHERE source_id = ?`,
  )
    .bind(STATE_PREFIX + sourceId)
    .first<{ last_release_published_at: string | null }>()
    .catch(() => null);
  return r?.last_release_published_at ?? null;
}

async function setHighWaterMark(env: Env, sourceId: string, tag: string, publishedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO spec_monitor_state (source_id, last_release_tag, last_release_published_at, last_run_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
        last_release_tag = excluded.last_release_tag,
        last_release_published_at = excluded.last_release_published_at,
        last_run_at = excluded.last_run_at`,
  )
    .bind(STATE_PREFIX + sourceId, tag, publishedAt, new Date().toISOString())
    .run()
    .catch(() => undefined);
}

export interface DeployTrendRunSummary {
  sources: number;
  releases_processed: number;
  suggestions_saved: number;
  /** LLM 호출 실패 수 — 0건 저장이 "조용한 주"인지 "장애"인지 구분하는 유일한 신호. */
  llm_failures: number;
}

export async function runDeployTrendWatcher(env: Env): Promise<DeployTrendRunSummary> {
  const summary: DeployTrendRunSummary = { sources: 0, releases_processed: 0, suggestions_saved: 0, llm_failures: 0 };
  for (const src of DEPLOY_TREND_SOURCES) {
    summary.sources += 1;
    const mark = await getHighWaterMark(env, src.id);
    const releases = (await fetchReleases(src.repo))
      .filter((r) => !mark || (r.published_at ?? "") > mark)
      .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""))
      .slice(-PER_SOURCE_RELEASE_LIMIT);

    for (const rel of releases) {
      const text = await callHaiku(env, `Platform: ${src.label} (${src.repo})\nRelease ${rel.tag_name}:\n\n${(rel.body ?? "").slice(0, 6000)}`);
      if (text === null) {
        // 실패한 릴리스의 마크를 전진시키면 평가 없이 영영 소실된다. 이 소스는
        // 여기서 멈추고(뒤 릴리스를 건너뛰면 마크 순서가 깨짐) 다음 사이클에 재시도.
        summary.llm_failures += 1;
        break;
      }
      summary.releases_processed += 1;
      {
        for (const s of parseSuggestions(text)) {
          const id = `dts_${crypto.randomUUID().slice(0, 12)}`;
          await env.DB.prepare(
            `INSERT INTO deploy_trend_suggestions
               (id, source_id, source_label, release_tag, release_url, relevance, title, summary_ko, guidance_key, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          )
            .bind(id, src.id, src.label, rel.tag_name, rel.html_url, s.relevance, s.title, s.summary_ko, s.guidance_key, new Date().toISOString())
            .run()
            .then(() => { summary.suggestions_saved += 1; })
            .catch(() => undefined);
        }
      }
      if (rel.published_at) await setHighWaterMark(env, src.id, rel.tag_name, rel.published_at);
    }
  }
  return summary;
}
