"use client";

/**
 * Tasks #52 — landing demo form.
 *
 * "Try it without signing up" funnel. Visitor pastes a PR URL or diff,
 * optionally attaches a PRD, and clicks Review. The form POSTs to
 * /saas/demo/review and renders the council's verdict + blockers
 * inline. No localStorage, no analytics — single shot.
 *
 * Cap: 3 reviews per IP per UTC day, enforced server-side. UI shows
 * remaining_today after each successful call so the visitor knows
 * what the limit is before signing up for unlimited.
 *
 * The point: prove "the council finds spec-mismatch blockers a single
 * agent doesn't" inside 30 seconds, before the visitor leaves.
 */
import { useState } from "react";

interface DemoBlocker {
  category: string;
  severity: "blocker" | "major" | "minor" | "nit";
  title: string;
  rationale: string;
  file?: string;
  line?: number;
}

interface DemoResponse {
  verdict: "approve" | "rework" | "reject";
  summary: string;
  blockers: DemoBlocker[];
  prd_aware: boolean;
  agent: string;
  remaining_today: number;
}

interface DemoError {
  error: string;
  error_description?: string;
  hint?: string;
  retry_after_seconds?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";

export function DemoForm() {
  const [prUrl, setPrUrl] = useState("");
  const [diff, setDiff] = useState("");
  const [prd, setPrd] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<DemoError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const body: Record<string, string> = {};
    if (prUrl.trim()) body.pr_url = prUrl.trim();
    if (diff.trim()) body.diff = diff;
    if (prd.trim()) body.prd = prd;

    try {
      const r = await fetch(`${API_BASE}/saas/demo/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as DemoResponse | DemoError;
      if (!r.ok) {
        setError(j as DemoError);
      } else {
        setResult(j as DemoResponse);
      }
    } catch (err) {
      setError({ error: "network_error", error_description: (err as Error).message });
    } finally {
      setPending(false);
    }
  };

  const verdictTone = (v: string) =>
    v === "approve"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
      : v === "reject"
      ? "bg-rose-50 border-rose-300 text-rose-900"
      : "bg-amber-50 border-amber-300 text-amber-900";

  const sevTone = (s: string) =>
    s === "blocker"
      ? "text-rose-700 bg-rose-50 border-rose-200"
      : s === "major"
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : s === "minor"
      ? "text-blue-700 bg-blue-50 border-blue-200"
      : "text-neutral-600 bg-neutral-50 border-neutral-200";

  return (
    <section id="try" className="py-24 border-b border-neutral-200">
      <h2 className="text-3xl font-bold text-neutral-900 mb-2">Try it now — no signup</h2>
      <p className="text-neutral-500 mb-12 max-w-prose">
        Paste a public PR URL (or a raw diff) and an optional PRD. One Claude pass with
        the PRD-aware prompt — the same prompt the full council uses. Three reviews per
        IP per day; sign in for unlimited and the full 3-agent council.
      </p>

      <form onSubmit={submit} className="grid gap-4 max-w-3xl">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">
            Public GitHub PR URL
          </label>
          <input
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-accent-700 focus:outline-none"
          />
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">
            …or paste a raw diff (private PRs / local changes)
          </summary>
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="diff --git a/foo.ts b/foo.ts ..."
            rows={6}
            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-accent-700 focus:outline-none"
          />
        </details>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">
            PRD <span className="text-neutral-400">(optional — describe what the PR is supposed to do)</span>
          </label>
          <textarea
            value={prd}
            onChange={(e) => setPrd(e.target.value)}
            placeholder="Acceptance criteria, out-of-scope, non-functional requirements…"
            rows={5}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-accent-700 focus:outline-none"
          />
          <p className="mt-1 text-xs text-neutral-500">
            With a PRD, agents flag spec-mismatches as first-class blockers. This is the
            moat that single-LLM reviews miss.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || (!prUrl.trim() && !diff.trim())}
          className="rounded-md bg-accent-900 hover:bg-accent-700 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors text-white px-5 py-3 font-medium w-fit"
        >
          {pending ? "Reviewing…" : "Review with Claude (1/3 council)"}
        </button>
      </form>

      {error && (
        <div className="mt-8 rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 max-w-3xl">
          <p className="font-semibold mb-1">{prettyErrorTitle(error)}</p>
          {error.error_description && <p className="text-rose-800">{error.error_description}</p>}
          {error.hint && <p className="mt-2 text-rose-700 text-xs">{error.hint}</p>}
          {error.retry_after_seconds !== undefined && (
            <p className="mt-2 text-rose-700 text-xs">
              Try again in {Math.ceil(error.retry_after_seconds / 3600)} hours, or sign in for unlimited.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="mt-8 grid gap-4 max-w-3xl">
          <div className={`rounded-md border-2 p-4 ${verdictTone(result.verdict)}`}>
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-xs uppercase tracking-wider opacity-70">Verdict</p>
              <p className="text-xs opacity-70">
                {result.remaining_today} review{result.remaining_today === 1 ? "" : "s"} left today
              </p>
            </div>
            <p className="text-2xl font-bold mt-1">{result.verdict.toUpperCase()}</p>
            <p className="text-sm mt-2 leading-relaxed">{result.summary}</p>
            {result.prd_aware && (
              <p className="mt-3 text-xs font-medium opacity-80">
                ✓ PRD-aware review — spec-mismatch blockers included
              </p>
            )}
          </div>

          {result.blockers.length === 0 ? (
            <p className="text-sm text-neutral-500 italic">No blockers — clean PR.</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm font-medium text-neutral-700">
                {result.blockers.length} blocker{result.blockers.length === 1 ? "" : "s"} flagged
              </p>
              {result.blockers.map((b, i) => (
                <article key={i} className="rounded-md border border-neutral-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-semibold text-neutral-900 text-sm">{b.title}</h4>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs font-mono ${sevTone(b.severity)}`}>
                      {b.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-neutral-500">{b.category}</p>
                  <p className="mt-2 text-sm text-neutral-700 leading-relaxed">{b.rationale}</p>
                  {b.file && (
                    <p className="mt-2 text-xs font-mono text-neutral-500">
                      {b.file}{b.line ? `:${b.line}` : ""}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}

          <p className="text-xs text-neutral-500 mt-2">
            This is one agent (Claude). The full council runs Claude + GPT-5 + Gemini in parallel
            and escalates disagreements — typically 3× more blockers caught.{" "}
            <a href="#pricing" className="text-accent-700 underline">See pricing →</a>
          </p>
        </div>
      )}
    </section>
  );
}

function prettyErrorTitle(e: DemoError): string {
  switch (e.error) {
    case "rate_limited":
      return "Daily demo limit reached";
    case "diff_fetch_failed":
      return "Couldn't fetch that PR";
    case "empty_diff":
      return "No diff supplied";
    case "service_unavailable":
      return "Review service temporarily unavailable";
    case "demo_disabled":
      return "Demo not enabled on this deploy";
    case "network_error":
      return "Network error";
    default:
      return e.error;
  }
}
