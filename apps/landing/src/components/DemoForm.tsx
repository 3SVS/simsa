"use client";

/**
 * Tasks #52 — landing demo form (editorial refresh + PRD ingest paths).
 *
 * Drop zones now accept:
 *   - .md / .markdown / .txt files (drag from desktop)
 *   - folders (Chromium-based webkitGetAsEntry; recursively pulls every
 *     .md file and concatenates with file path headers)
 *   - GitHub URLs that point at a file or repo, auto-resolved to the
 *     raw blob and fetched
 *
 * Form-side state remains simple: pr_url + diff + prd. Whatever PRD
 * source path the visitor uses, we land in the same `prd` string, then
 * POST to /saas/demo/review.
 *
 * Cap unchanged: 3 reviews per IP per UTC day, server-enforced.
 */
import { useCallback, useRef, useState } from "react";

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

// PRD ingest budget — keep payload modest so the demo endpoint's 32KB
// cap on the server side never trips us. We trim during ingest.
const PRD_BYTE_CAP = 28_000;

export function DemoForm() {
  const [prUrl, setPrUrl] = useState("");
  const [diff, setDiff] = useState("");
  const [prd, setPrd] = useState("");
  const [prdGhUrl, setPrdGhUrl] = useState("");
  const [prdSource, setPrdSource] = useState<string>("");
  const [prdLoading, setPrdLoading] = useState(false);
  const [prdError, setPrdError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<DemoError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const ingestFiles = useCallback(async (files: File[]) => {
    const mdFiles = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (mdFiles.length === 0) {
      setPrdError("No .md / .markdown / .txt files in that drop. Drag a single PRD file or a folder containing one.");
      return;
    }
    const blocks: string[] = [];
    let bytes = 0;
    for (const f of mdFiles) {
      const text = await f.text();
      const header = mdFiles.length > 1 ? `\n\n## ${f.name}\n\n` : "";
      const block = header + text;
      if (bytes + block.length > PRD_BYTE_CAP) {
        blocks.push(`\n\n_(${mdFiles.length - blocks.length} more files trimmed — PRD cap reached)_`);
        break;
      }
      blocks.push(block);
      bytes += block.length;
    }
    setPrd(blocks.join("").trim());
    setPrdSource(
      mdFiles.length === 1
        ? mdFiles[0]!.name
        : `${mdFiles.length} files concatenated (${Math.round(bytes / 1024)} KB)`,
    );
    setPrdError(null);
  }, []);

  // FileSystem entries traversal — Chromium et al. expose this via
  // DataTransferItem.webkitGetAsEntry(). Falls back to flat .files
  // listing on browsers that don't.
  const ingestDataTransfer = useCallback(
    async (dt: DataTransfer) => {
      const items = dt.items;
      if (items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function") {
        const entries: FileSystemEntry[] = [];
        for (let i = 0; i < items.length; i++) {
          const e = items[i]!.webkitGetAsEntry();
          if (e) entries.push(e);
        }
        const collected: File[] = [];
        await collectFilesFromEntries(entries, collected);
        await ingestFiles(collected);
      } else {
        const flat: File[] = [];
        for (let i = 0; i < dt.files.length; i++) flat.push(dt.files[i]!);
        await ingestFiles(flat);
      }
    },
    [ingestFiles],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropping(false);
      setPrdError(null);
      await ingestDataTransfer(e.dataTransfer);
    },
    [ingestDataTransfer],
  );

  const onFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      setPrdError(null);
      await ingestFiles(files);
    },
    [ingestFiles],
  );

  const fetchFromGitHub = useCallback(async () => {
    const trimmed = prdGhUrl.trim();
    if (!trimmed) return;
    setPrdLoading(true);
    setPrdError(null);
    try {
      const candidates = resolveGitHubMarkdownUrls(trimmed);
      let loaded: { url: string; text: string } | null = null;
      for (const u of candidates) {
        try {
          const r = await fetch(u);
          if (r.ok) {
            const t = await r.text();
            if (t.trim().length > 0) {
              loaded = { url: u, text: t.slice(0, PRD_BYTE_CAP) };
              break;
            }
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!loaded) {
        setPrdError(
          `Couldn't fetch a PRD from that URL. Try a direct link to .conclave/prd.md, PRD.md, or docs/prd.md.`,
        );
        return;
      }
      setPrd(loaded.text);
      const short = loaded.url.replace(/^https?:\/\/raw\.githubusercontent\.com\//, "");
      setPrdSource(`github:${short}`);
    } finally {
      setPrdLoading(false);
    }
  }, [prdGhUrl]);

  return (
    <div>
      <form onSubmit={submit} className="grid gap-6 max-w-3xl">
        <div>
          <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute mb-2">
            Public GitHub PR URL
          </label>
          <input
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="w-full rounded-md border border-parchment-line bg-parchment px-3.5 py-2.5 font-mono text-sm focus:border-oxblood-600 focus:outline-none transition-colors"
          />
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted hover:text-ink select-none">
            …or paste a raw diff (private PRs / local changes)
          </summary>
          <textarea
            value={diff}
            onChange={(e) => setDiff(e.target.value)}
            placeholder="diff --git a/foo.ts b/foo.ts ..."
            rows={6}
            className="mt-3 w-full rounded-md border border-parchment-line bg-parchment px-3.5 py-2.5 font-mono text-xs focus:border-oxblood-600 focus:outline-none transition-colors"
          />
        </details>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="block font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
              PRD <span className="normal-case tracking-normal text-ink-ghost">(optional — describe what the PR is supposed to do)</span>
            </label>
            {prdSource && (
              <span className="font-mono text-[11px] text-oxblood-600">
                ↳ {prdSource}
              </span>
            )}
          </div>

          {/* PRD ingest tabs: drag/drop, file picker, GitHub URL fetch.
              All three feed the same `prd` string so submit logic stays
              identical. */}
          <div
            className={`rounded-md border-2 border-dashed transition-colors ${
              dropping
                ? "border-oxblood-600 bg-oxblood-50"
                : "border-parchment-line bg-parchment-dim/40 hover:border-ink/30"
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDropping(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={onDrop}
          >
            <div className="px-4 py-5 text-center text-sm text-ink-muted">
              <p className="font-medium text-ink mb-1">
                Drag & drop a <span className="font-mono text-oxblood-600">.md</span> file or folder
              </p>
              <p className="text-xs text-ink-mute">
                Folders are walked recursively, every .md concatenated.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 inline-block rounded border border-ink/30 bg-parchment px-3 py-1.5 text-xs hover:bg-parchment-dim transition-colors"
              >
                or pick files…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.markdown,.txt"
                onChange={onFilePick}
                className="hidden"
              />
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] items-stretch">
            <input
              type="url"
              value={prdGhUrl}
              onChange={(e) => setPrdGhUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/blob/main/.conclave/prd.md"
              className="rounded-md border border-parchment-line bg-parchment px-3.5 py-2.5 font-mono text-xs focus:border-oxblood-600 focus:outline-none transition-colors"
            />
            <button
              type="button"
              onClick={fetchFromGitHub}
              disabled={!prdGhUrl.trim() || prdLoading}
              className="rounded-md border border-ink/30 bg-parchment px-4 py-2.5 text-xs font-medium hover:bg-parchment-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {prdLoading ? "Fetching…" : "Fetch from GitHub"}
            </button>
          </div>

          <textarea
            value={prd}
            onChange={(e) => {
              setPrd(e.target.value);
              if (prdSource) setPrdSource("");
            }}
            placeholder="Acceptance criteria, out-of-scope, non-functional requirements…"
            rows={5}
            className="mt-3 w-full rounded-md border border-parchment-line bg-parchment px-3.5 py-2.5 text-sm focus:border-oxblood-600 focus:outline-none transition-colors"
          />

          {prdError && (
            <p className="mt-2 text-xs text-flag">{prdError}</p>
          )}
          <p className="mt-2 text-xs text-ink-mute leading-relaxed">
            With a PRD, agents flag spec-mismatches as first-class blockers — the moat single-LLM reviews miss.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || (!prUrl.trim() && !diff.trim())}
          className="rounded-md bg-oxblood-600 hover:bg-oxblood-500 disabled:bg-ink-ghost disabled:cursor-not-allowed transition-colors text-parchment-light px-6 py-3.5 font-medium tracking-tight w-fit shadow-plate"
        >
          {pending ? "Reviewing…" : "Review with Claude (1/3 council)"}
        </button>
      </form>

      {error && (
        <div className="mt-8 rounded-md border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 max-w-3xl">
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
        <div className="mt-10 grid gap-4 max-w-3xl">
          <div className={`rounded-md border-2 p-5 ${verdictTone(result.verdict)}`}>
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] opacity-70">Verdict</p>
              <p className="text-xs opacity-70 font-mono">
                {result.remaining_today} review{result.remaining_today === 1 ? "" : "s"} left today
              </p>
            </div>
            <p className="font-display text-3xl font-bold mt-2 tracking-tightxx">
              {result.verdict.toUpperCase()}
            </p>
            <p className="text-sm mt-3 leading-[1.6]">{result.summary}</p>
            {result.prd_aware && (
              <p className="mt-3 text-xs font-medium opacity-80">
                ✓ PRD-aware review — spec-mismatch blockers included
              </p>
            )}
          </div>

          {result.blockers.length === 0 ? (
            <p className="text-sm text-ink-muted italic">No blockers — clean PR.</p>
          ) : (
            <div className="grid gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-mute">
                {result.blockers.length} blocker{result.blockers.length === 1 ? "" : "s"} flagged
              </p>
              {result.blockers.map((b, i) => (
                <article
                  key={i}
                  className="rounded-md border border-parchment-line bg-parchment p-4 shadow-plate"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-display font-semibold text-ink text-[15px] tracking-tight">{b.title}</h4>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${sevTone(b.severity)}`}>
                      {b.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-mono text-ink-mute">{b.category}</p>
                  <p className="mt-2 text-sm text-ink-muted leading-[1.65]">{b.rationale}</p>
                  {b.file && (
                    <p className="mt-2 text-xs font-mono text-ink-mute">
                      {b.file}{b.line ? `:${b.line}` : ""}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}

          <p className="text-xs text-ink-mute mt-3 leading-relaxed">
            This is one agent (Claude). The full council runs Claude + GPT-5 + Gemini in parallel
            and escalates disagreements — typically 3× more blockers caught.{" "}
            <a href="#pricing" className="text-oxblood-600 link-anim">See pricing →</a>
          </p>
        </div>
      )}
    </div>
  );
}

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
    : "text-ink-mute bg-parchment-dim border-parchment-line";

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

// --- GitHub URL ingest ------------------------------------------------------

/**
 * Generate raw-content URL candidates from a GitHub URL.
 *
 * Accepted shapes:
 *   - https://github.com/owner/repo/blob/branch/path/to/file.md
 *   - https://github.com/owner/repo (try common PRD locations on default branches)
 *   - https://raw.githubusercontent.com/... (returned as-is)
 *
 * Returns ordered candidates — caller fetches in order, takes first
 * 200 OK with non-empty body.
 */
function resolveGitHubMarkdownUrls(url: string): string[] {
  if (/^https?:\/\/raw\.githubusercontent\.com\//.test(url)) return [url];
  const ghBlob = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (ghBlob) {
    const [, owner, repo, branch, path] = ghBlob;
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`];
  }
  // Bare repo URL — probe for common PRD paths on main/master.
  const ghRepo = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/);
  if (ghRepo) {
    const [, owner, repo] = ghRepo;
    const cleanRepo = repo!.replace(/\.git$/, "");
    const paths = [".conclave/prd.md", "PRD.md", "prd.md", "docs/prd.md", "docs/PRD.md", "README.md"];
    const branches = ["main", "master"];
    const out: string[] = [];
    for (const branch of branches) {
      for (const path of paths) {
        out.push(`https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/${path}`);
      }
    }
    return out;
  }
  // Last resort — try the URL verbatim. fetch() will fail and we'll
  // surface a clear error.
  return [url];
}

// --- FileSystemEntry recursive collect --------------------------------------

async function collectFilesFromEntries(entries: FileSystemEntry[], out: File[]): Promise<void> {
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => {
        (entry as FileSystemFileEntry).file(
          (f) => resolve(f),
          () => resolve(null),
        );
      });
      if (file) out.push(file);
    } else if (entry.isDirectory) {
      const dir = entry as FileSystemDirectoryEntry;
      const reader = dir.createReader();
      // readEntries returns batches — call until empty.
      let batch: FileSystemEntry[] = [];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(
            (es) => resolve(es),
            () => resolve([]),
          );
        });
        await collectFilesFromEntries(batch, out);
      } while (batch.length > 0);
    }
  }
}
