/**
 * Tasks #51 + #52 — landing demo endpoint.
 *
 * POST /saas/demo/review
 *   body: { pr_url?: string; diff?: string; prd?: string }
 *
 * No auth. IP-rate-limited to DEMO_DAILY_CAP per UTC day (default 3).
 * Calls Claude once with a PRD-aware review prompt and returns the
 * council's blockers JSON. Single agent, no debate, no autofix —
 * enough to show "the system actually finds spec mismatches",
 * which is the moat we want landing visitors to feel.
 *
 * Rate limit: D1 table demo_rate_limit (one row per ip_hash × day_utc).
 * IP is sha256-hashed with a per-deploy salt before storage so we
 * never persist raw addresses.
 *
 * Diff source priority:
 *   1. body.diff (if pasted directly — supports private/closed PRs)
 *   2. body.pr_url → fetch via GitHub public REST API (works for
 *      public repos / public PRs only — anonymous API has 60 req/h)
 *
 * On 429 / cap-reached: returns 429 with `retry_after_seconds` so the
 * UI can show the next free time. On LLM failure: 502 with a generic
 * "service unavailable" — never leak SDK details to the demo user.
 *
 * The demo deliberately does NOT spawn the Container, write to jobs,
 * or talk to Telegram. It's a stateless tasting menu.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { sha256Hex } from "../util.js";

const DEMO_DAILY_CAP = 3;
const DEMO_PROMPT_TIMEOUT_MS = 90_000;
const DEMO_MAX_DIFF_BYTES = 200_000;
const DEMO_MAX_PRD_BYTES = 32_000;

interface DemoBlocker {
  category: string;
  severity: "blocker" | "major" | "minor" | "nit";
  title: string;
  rationale: string;
  file?: string | undefined;
  line?: number | undefined;
}

interface DemoVerdict {
  verdict: "approve" | "rework" | "reject";
  summary: string;
  blockers: DemoBlocker[];
  prdAware: boolean;
  agent: "claude";
}

export function createDemoRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/saas/demo/review", async (c) => {
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: "demo_disabled", reason: "ANTHROPIC_API_KEY not configured" }, 503);
    }
    const body = (await c.req.json().catch(() => null)) as
      | { pr_url?: unknown; diff?: unknown; prd?: unknown }
      | null;
    if (!body) {
      return c.json({ error: "invalid_request", error_description: "expected JSON body" }, 400);
    }

    const prUrl = typeof body.pr_url === "string" ? body.pr_url.trim() : "";
    const pastedDiff = typeof body.diff === "string" ? body.diff : "";
    const prd = typeof body.prd === "string" ? body.prd.slice(0, DEMO_MAX_PRD_BYTES) : "";

    if (!prUrl && !pastedDiff) {
      return c.json(
        { error: "invalid_request", error_description: "supply pr_url or diff" },
        400,
      );
    }

    // Best-effort client IP. CF sets cf-connecting-ip; fall back to
    // X-Forwarded-For first hop. Rate-limit silently treats unknown
    // IPs as a shared bucket (rare; only happens in dev).
    const rawIp = c.req.header("cf-connecting-ip")
      ?? (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim()
      ?? "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const ipHash = await sha256Hex(`${c.env.DEMO_RATE_SALT ?? "conclave-demo"}::${rawIp}`);

    const rateRow = await c.env.DB.prepare(
      `SELECT count FROM demo_rate_limit WHERE ip_hash = ? AND day_utc = ?`,
    )
      .bind(ipHash, today)
      .first<{ count: number }>();
    const currentCount = rateRow?.count ?? 0;
    if (currentCount >= DEMO_DAILY_CAP) {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
      tomorrow.setUTCHours(0, 0, 0, 0);
      const retryAfter = Math.max(60, Math.floor((tomorrow.getTime() - Date.now()) / 1000));
      return c.json(
        {
          error: "rate_limited",
          error_description: `Demo cap reached: ${DEMO_DAILY_CAP} reviews per day. Sign in for unlimited.`,
          retry_after_seconds: retryAfter,
        },
        429,
      );
    }

    let diff = pastedDiff;
    let prContext: string | undefined;
    if (!diff && prUrl) {
      const fetched = await fetchPublicPrDiff(prUrl);
      if ("error" in fetched) {
        return c.json(
          {
            error: "diff_fetch_failed",
            error_description: fetched.error,
            hint: "Public GitHub PRs only. For private PRs, paste the diff directly.",
          },
          400,
        );
      }
      diff = fetched.diff;
      prContext = fetched.title;
    }

    if (!diff || diff.length === 0) {
      return c.json({ error: "empty_diff" }, 400);
    }
    if (diff.length > DEMO_MAX_DIFF_BYTES) {
      diff = diff.slice(0, DEMO_MAX_DIFF_BYTES) + "\n\n[truncated for demo — sign in for full reviews]";
    }

    let verdict: DemoVerdict;
    try {
      verdict = await runClaudeDemoReview({
        apiKey: c.env.ANTHROPIC_API_KEY,
        diff,
        prd,
        prContext,
      });
    } catch (err) {
      console.error("demo: Claude call failed:", err);
      return c.json({ error: "service_unavailable" }, 502);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO demo_rate_limit (ip_hash, day_utc, count, first_at, last_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT (ip_hash, day_utc) DO UPDATE SET
         count = count + 1, last_at = excluded.last_at`,
    )
      .bind(ipHash, today, now, now)
      .run()
      .catch((err) => console.warn("demo: rate-limit upsert failed (non-fatal):", err));

    return c.json({
      verdict: verdict.verdict,
      summary: verdict.summary,
      blockers: verdict.blockers,
      prd_aware: verdict.prdAware,
      agent: verdict.agent,
      remaining_today: Math.max(0, DEMO_DAILY_CAP - (currentCount + 1)),
    });
  });

  return app;
}

interface PublicPrFetch {
  diff: string;
  title: string;
}

async function fetchPublicPrDiff(prUrl: string): Promise<PublicPrFetch | { error: string }> {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(prUrl);
  if (!m) return { error: "Expected github.com/<owner>/<repo>/pull/<N> URL" };
  const [, owner, repo, num] = m;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/pulls/${num}`;
  try {
    const [diffResp, metaResp] = await Promise.all([
      fetch(apiBase, {
        headers: {
          accept: "application/vnd.github.v3.diff",
          "user-agent": "Conclave AI demo",
        },
      }),
      fetch(apiBase, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "Conclave AI demo",
        },
      }),
    ]);
    if (diffResp.status === 404) return { error: "PR not found (private repo or wrong URL)" };
    if (diffResp.status === 403) return { error: "GitHub anonymous rate limit hit — try again in an hour or paste the diff" };
    if (!diffResp.ok) return { error: `GitHub returned ${diffResp.status}` };
    const diff = await diffResp.text();
    let title = `PR #${num} of ${owner}/${repo}`;
    if (metaResp.ok) {
      const meta = (await metaResp.json().catch(() => null)) as { title?: string } | null;
      if (meta?.title) title = `${meta.title} (${owner}/${repo}#${num})`;
    }
    return { diff, title };
  } catch (err) {
    return { error: `fetch failed: ${(err as Error).message}` };
  }
}

interface ClaudeDemoArgs {
  apiKey: string;
  diff: string;
  prd: string;
  prContext: string | undefined;
}

async function runClaudeDemoReview(args: ClaudeDemoArgs): Promise<DemoVerdict> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEMO_PROMPT_TIMEOUT_MS);
  const prdSection = args.prd
    ? `\n\n<prd>\nThe PR is supposed to implement the following spec. Flag any blocker where the diff diverges from this spec — these are the highest-value findings:\n\n${args.prd}\n</prd>`
    : "";
  const contextLine = args.prContext ? `\n\nContext: ${args.prContext}` : "";
  const userMsg = `You are a code reviewer for the Conclave AI Council. Review this PR diff and return a strict JSON verdict.${contextLine}${prdSection}

<diff>
${args.diff}
</diff>

Return ONLY a JSON object with this exact shape (no prose, no markdown):
{
  "verdict": "approve" | "rework" | "reject",
  "summary": "<1-2 sentences on what this PR does and overall risk>",
  "blockers": [
    {
      "category": "<short kebab-case>",
      "severity": "blocker" | "major" | "minor" | "nit",
      "title": "<≤80 chars>",
      "rationale": "<≤200 chars, mention file/line if relevant>",
      "file": "<optional repo-relative path>",
      "line": <optional number>
    }
  ]
}

Rules:
- "rework" when blocker-severity issues exist OR ${args.prd ? "the diff fails to match the PRD" : "build/test correctness is at risk"}.
- "reject" only for security incidents or fundamentally wrong direction.
- Otherwise "approve".
- Up to 6 blockers; pick the highest-impact ones.
- ${args.prd ? "Spec-mismatch blockers MUST appear if the diff diverges from the PRD." : "Focus on real defects — don't manufacture issues for empty diffs."}
- If the diff is empty or unintelligible, set verdict="rework" with a single blocker explaining what was unparseable.`;

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 2048,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const tail = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${tail.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned non-JSON");
  let parsed: {
    verdict?: string;
    summary?: string;
    blockers?: Array<{
      category?: unknown;
      severity?: unknown;
      title?: unknown;
      rationale?: unknown;
      file?: unknown;
      line?: unknown;
    }>;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Claude JSON parse failed");
  }
  const verdict = (parsed.verdict === "approve" || parsed.verdict === "reject") ? parsed.verdict : "rework";
  const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "(no summary)";
  const blockers: DemoBlocker[] = (parsed.blockers ?? []).slice(0, 6).map((b) => {
    const severity = (b.severity === "blocker" || b.severity === "minor" || b.severity === "nit")
      ? b.severity
      : "major";
    const result: DemoBlocker = {
      category: typeof b.category === "string" ? b.category.slice(0, 40) : "general",
      severity: severity as DemoBlocker["severity"],
      title: typeof b.title === "string" ? b.title.slice(0, 120) : "(unspecified)",
      rationale: typeof b.rationale === "string" ? b.rationale.slice(0, 280) : "",
    };
    if (typeof b.file === "string") result.file = b.file.slice(0, 200);
    if (typeof b.line === "number" && Number.isFinite(b.line)) result.line = b.line;
    return result;
  });
  return {
    verdict,
    summary,
    blockers,
    prdAware: args.prd.length > 0,
    agent: "claude",
  };
}
