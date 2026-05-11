/**
 * MCP server registry miner — discovers publicly available Model
 * Context Protocol servers so a review on a PR that wires AI coding
 * (Claude Code, Cursor, Windsurf) integration can answer "is there
 * already an MCP server for this?"
 *
 * Source mix (run in order, results merged into external_intel):
 *   1. npm registry search for `scope:modelcontextprotocol` + the
 *      common `mcp-server-*` keyword convention.
 *   2. Curated list parsed from the official catalog README at
 *      `modelcontextprotocol/servers` (raw GitHub).
 *
 * Both sources upsert by stable id = npm package name (or the README
 * slug when the entry doesn't have a published npm package). The
 * unique (intel_type, source_id) key in `external_intel` dedupes the
 * overlap between the two sources.
 *
 * Cost: no Haiku call. npm + GitHub raw are unauthenticated 60/h
 * which is plenty (we make ~3 calls per pass).
 *
 * Cron: weekly Wednesday 0800 UTC. MCP server ecosystem moves slowly
 * — daily polling would burn API for nothing.
 */
import type { Env } from "./env.js";
import {
  type ExternalIntelRow,
  makeIntelId,
  readIntelState,
  renderIntelPrompt,
  upsertIntel,
  writeIntelState,
} from "./external-intel.js";

const NPM_SEARCH_URL =
  "https://registry.npmjs.org/-/v1/search?text=scope:modelcontextprotocol&size=100";
const README_RAW =
  "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md";
const TIMEOUT_MS = 8_000;

interface NpmSearchHit {
  package: {
    name: string;
    description?: string;
    version?: string;
    keywords?: string[];
    links?: { homepage?: string; repository?: string; npm?: string };
  };
}

interface NpmSearchResponse {
  objects: NpmSearchHit[];
  total: number;
}

async function timed<T>(url: string, init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNpmHits(): Promise<NpmSearchHit[]> {
  const resp = await timed(NPM_SEARCH_URL, {
    headers: { Accept: "application/json", "User-Agent": "conclave-ai/mcp-registry-miner" },
  });
  if (!resp?.ok) return [];
  const body = (await resp.json()) as NpmSearchResponse;
  return body.objects ?? [];
}

async function fetchReadmeText(): Promise<string | null> {
  const resp = await timed(README_RAW, {
    headers: { Accept: "text/plain", "User-Agent": "conclave-ai/mcp-registry-miner" },
  });
  if (!resp?.ok) return null;
  return await resp.text();
}

/**
 * Parse "- **Name** - description" / "* [Name](url) — description" style
 * bullets from the README. Returns one entry per recognised line. We
 * intentionally accept a loose grammar; the README format drifts over
 * time and we'd rather pick up new entries than block on perfect parse.
 */
function parseReadmeServers(md: string): Array<{
  slug: string;
  name: string;
  description: string;
  url: string | null;
}> {
  const out: Array<{ slug: string; name: string; description: string; url: string | null }> = [];
  const lines = md.split(/\r?\n/);
  const bold = /^[*-]\s+\*\*([^*]+)\*\*\s*[-–—:]\s*(.+)$/;
  const linked = /^[*-]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]\s*(.+)$/;
  for (const raw of lines) {
    const line = raw.trim();
    let name = "";
    let description = "";
    let url: string | null = null;
    const m1 = bold.exec(line);
    if (m1) {
      name = m1[1]!.trim();
      description = m1[2]!.trim();
    } else {
      const m2 = linked.exec(line);
      if (!m2) continue;
      name = m2[1]!.trim();
      url = m2[2]!.trim();
      description = m2[3]!.trim();
    }
    if (!name || !description || name.length > 80) continue;
    if (description.length > 400) description = description.slice(0, 400);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (!slug) continue;
    out.push({ slug, name, description, url });
  }
  return out;
}

function rowFromNpm(hit: NpmSearchHit): ExternalIntelRow | null {
  const pkg = hit.package;
  if (!pkg?.name) return null;
  const sourceId = pkg.name;
  const url = pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`;
  const description = (pkg.description ?? "").slice(0, 400);
  if (!description) return null;
  const title = pkg.name.replace(/^@modelcontextprotocol\//, "MCP — ").slice(0, 180);
  const body = description;
  return {
    id: "", // assigned by caller via makeIntelId
    intel_type: "mcp-server",
    source_id: sourceId,
    source_url: url,
    source_repo: pkg.links?.repository
      ? pkg.links.repository.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "")
      : null,
    domain: "code",
    kind: "answer_key", // discovering an existing MCP is a positive recommendation, not a warning
    category: "mcp-integration",
    severity: null,
    title,
    body,
    tags: ["mcp", "npm", ...(pkg.keywords ?? []).slice(0, 5)],
    prompt_text: renderIntelPrompt({
      intel_type: "mcp-server",
      source_id: sourceId,
      title,
      body,
      tagSuffix: pkg.version ? `npm v${pkg.version}` : "npm",
    }),
    metadata: {
      source: "npm",
      version: pkg.version,
      homepage: pkg.links?.homepage,
      repository: pkg.links?.repository,
      keywords: pkg.keywords ?? [],
    },
  };
}

function rowFromReadme(entry: {
  slug: string;
  name: string;
  description: string;
  url: string | null;
}): ExternalIntelRow {
  const sourceId = `readme:${entry.slug}`;
  const title = `MCP — ${entry.name}`.slice(0, 180);
  return {
    id: "",
    intel_type: "mcp-server",
    source_id: sourceId,
    source_url: entry.url ?? "https://github.com/modelcontextprotocol/servers",
    source_repo: "modelcontextprotocol/servers",
    domain: "code",
    kind: "answer_key",
    category: "mcp-integration",
    severity: null,
    title,
    body: entry.description,
    tags: ["mcp", "readme-catalog"],
    prompt_text: renderIntelPrompt({
      intel_type: "mcp-server",
      source_id: sourceId,
      title,
      body: entry.description,
      tagSuffix: "official catalog",
    }),
    metadata: {
      source: "readme",
      slug: entry.slug,
      url: entry.url,
    },
  };
}

export async function runMcpRegistryMiner(env: Env): Promise<{
  inserted: number;
  npm_hits: number;
  readme_entries: number;
}> {
  const state = await readIntelState(env, "mcp-server", "registry");
  const lastRun = state?.last_seen_at ?? null;
  // Light incremental hint — the registry doesn't expose a clean delta
  // feed, so we re-upsert the full set each pass and rely on the
  // (intel_type, source_id) unique key. `last_seen_at` is just for
  // operator observability.

  const npmHits = await fetchNpmHits();
  const readmeText = await fetchReadmeText();
  const readmeEntries = readmeText ? parseReadmeServers(readmeText) : [];

  let inserted = 0;
  for (const hit of npmHits) {
    const row = rowFromNpm(hit);
    if (!row) continue;
    row.id = await makeIntelId("mcp-server", row.source_id);
    await upsertIntel(env, row);
    inserted += 1;
  }
  for (const entry of readmeEntries) {
    const row = rowFromReadme(entry);
    row.id = await makeIntelId("mcp-server", row.source_id);
    await upsertIntel(env, row);
    inserted += 1;
  }

  await writeIntelState(env, "mcp-server", "registry", {
    last_seen_at: new Date().toISOString(),
    last_seen_marker: `npm:${npmHits.length}|readme:${readmeEntries.length}`,
  });

  // Silence unused-var lint on lastRun (kept for operator/debug clarity)
  void lastRun;

  return {
    inserted,
    npm_hits: npmHits.length,
    readme_entries: readmeEntries.length,
  };
}
