/**
 * shadcn community blocks miner — pulls the curated shadcn-compatible
 * component / block catalog so a design-domain review on a UI PR can
 * answer "is there an existing shadcn block for this layout?" with a
 * concrete name + link.
 *
 * Sources (run in order, results merged):
 *   1. `birobirobiro/awesome-shadcn-ui` README — community-curated
 *      list of shadcn-compatible libraries, blocks, themes, tools.
 *   2. `shadcn-ui/ui` registry — fetch the index.json that lists every
 *      official component / block in the canonical registry.
 *
 * Each entry upserts as one external_intel row with domain="design"
 * and kind="answer_key" (these are positive references — what to
 * reach for, not what to avoid).
 *
 * No Haiku call. Both sources are well-structured (markdown list +
 * JSON), parsed deterministically.
 *
 * Cron: weekly Thursday 0800 UTC.
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

const AWESOME_README_RAW =
  "https://raw.githubusercontent.com/birobirobiro/awesome-shadcn-ui/main/README.md";
const SHADCN_REGISTRY_INDEX =
  "https://ui.shadcn.com/r/index.json";
const TIMEOUT_MS = 8_000;

async function timedFetch(url: string, accept: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "conclave-ai/shadcn-block-miner" },
      signal: ctrl.signal,
    });
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface AwesomeEntry {
  name: string;
  url: string;
  description: string;
  section: string;
}

/**
 * Parse `## Section`-grouped markdown bullets in the awesome-shadcn-ui
 * README. We carry the current section header through the loop so each
 * entry's `section` field can route to the right RAG bucket later.
 */
function parseAwesomeReadme(md: string): AwesomeEntry[] {
  const out: AwesomeEntry[] = [];
  const lines = md.split(/\r?\n/);
  let section = "general";
  const sectionRe = /^##\s+(.+)$/;
  const linkedRe = /^[*-]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]\s*(.+)$/;
  for (const raw of lines) {
    const line = raw.trim();
    const sec = sectionRe.exec(line);
    if (sec) {
      section = sec[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      continue;
    }
    const m = linkedRe.exec(line);
    if (!m) continue;
    const name = m[1]!.trim();
    const url = m[2]!.trim();
    let description = m[3]!.trim();
    if (!name || !description) continue;
    if (description.length > 400) description = description.slice(0, 400);
    out.push({ name: name.slice(0, 100), url, description, section });
  }
  return out;
}

interface ShadcnRegistryItem {
  name: string;
  type: string;
  description?: string;
  registryDependencies?: string[];
  dependencies?: string[];
  files?: Array<{ path: string }>;
}

async function fetchShadcnRegistry(): Promise<ShadcnRegistryItem[]> {
  const resp = await timedFetch(SHADCN_REGISTRY_INDEX, "application/json");
  if (!resp?.ok) return [];
  try {
    const data = (await resp.json()) as ShadcnRegistryItem[] | { items?: ShadcnRegistryItem[] };
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  } catch {
    return [];
  }
}

function rowFromAwesome(entry: AwesomeEntry): ExternalIntelRow {
  const sourceId = `awesome:${entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
  const title = `shadcn — ${entry.name}`.slice(0, 180);
  return {
    id: "",
    intel_type: "shadcn-block",
    source_id: sourceId,
    source_url: entry.url,
    source_repo: null,
    domain: "design",
    kind: "answer_key",
    category: "design-component",
    severity: null,
    title,
    body: entry.description,
    tags: ["shadcn", "awesome-list", entry.section],
    prompt_text: renderIntelPrompt({
      intel_type: "shadcn-block",
      source_id: sourceId,
      title,
      body: entry.description,
      tagSuffix: `community: ${entry.section}`,
    }),
    metadata: {
      source: "awesome-shadcn-ui",
      section: entry.section,
      url: entry.url,
    },
  };
}

function rowFromRegistry(item: ShadcnRegistryItem): ExternalIntelRow | null {
  if (!item.name || !item.type) return null;
  const sourceId = `registry:${item.name}`;
  const title = `shadcn-ui/${item.type} — ${item.name}`.slice(0, 180);
  const body =
    item.description ??
    `Official shadcn-ui ${item.type}. Use via \`npx shadcn add ${item.name}\`.`;
  const tags = ["shadcn", "official", `type:${item.type}`];
  if (item.registryDependencies && item.registryDependencies.length > 0) {
    tags.push(`deps:${item.registryDependencies.slice(0, 5).join(",")}`);
  }
  return {
    id: "",
    intel_type: "shadcn-block",
    source_id: sourceId,
    source_url: `https://ui.shadcn.com/docs/components/${item.name}`,
    source_repo: "shadcn-ui/ui",
    domain: "design",
    kind: "answer_key",
    category: "design-component",
    severity: null,
    title,
    body,
    tags,
    prompt_text: renderIntelPrompt({
      intel_type: "shadcn-block",
      source_id: sourceId,
      title,
      body,
      tagSuffix: `official ${item.type}`,
    }),
    metadata: {
      source: "shadcn-registry",
      type: item.type,
      registry_dependencies: item.registryDependencies ?? [],
      npm_dependencies: item.dependencies ?? [],
      file_count: item.files?.length ?? 0,
    },
  };
}

export async function runShadcnBlockMiner(env: Env): Promise<{
  inserted: number;
  awesome_entries: number;
  registry_entries: number;
}> {
  const awesomeResp = await timedFetch(AWESOME_README_RAW, "text/plain");
  const awesomeText = awesomeResp?.ok ? await awesomeResp.text() : null;
  const awesomeEntries = awesomeText ? parseAwesomeReadme(awesomeText) : [];

  const registryItems = await fetchShadcnRegistry();

  let inserted = 0;
  for (const entry of awesomeEntries) {
    const row = rowFromAwesome(entry);
    row.id = await makeIntelId("shadcn-block", row.source_id);
    await upsertIntel(env, row);
    inserted += 1;
  }
  for (const item of registryItems) {
    const row = rowFromRegistry(item);
    if (!row) continue;
    row.id = await makeIntelId("shadcn-block", row.source_id);
    await upsertIntel(env, row);
    inserted += 1;
  }

  await writeIntelState(env, "shadcn-block", "registry", {
    last_seen_at: new Date().toISOString(),
    last_seen_marker: `awesome:${awesomeEntries.length}|registry:${registryItems.length}`,
  });

  return {
    inserted,
    awesome_entries: awesomeEntries.length,
    registry_entries: registryItems.length,
  };
}
