/**
 * built-with.ts
 *
 * "Which AI tool(s) built this?" — the single most defensible axis of Simsa's
 * data moat. Only Simsa sits across many agents' outputs judging them against
 * user intent, so a per-agent failure map is uniquely ours — but ONLY if every
 * captured record carries the tool tag. The tag can only be attached at capture
 * time (the user tells us when they create the project); it cannot be
 * backfilled. So this is deliberately flexible: multi-select, an optional
 * "primary", a free-text "other" (which doubles as a new-tool market radar),
 * and an optional model note for later GPT-vs-Claude failure-pattern analysis.
 */

/** Canonical tool ids. `other` is a sentinel; the real value lives in `other` free text. */
export const KNOWN_BUILT_WITH_TOOLS = [
  "v0",
  "lovable",
  "bolt",
  "cursor",
  "claude-code",
  "replit",
  "windsurf",
  "codex",
  "hand-coded",
  "other",
] as const;

export type BuiltWithTool = (typeof KNOWN_BUILT_WITH_TOOLS)[number];

export type BuiltWith = {
  /** Normalized canonical tool ids, deduped. May include "other". */
  tools: string[];
  /** The main tool, if the user marked one. Always a member of `tools`. */
  primary?: string;
  /** Free text when "other" is selected — preserved verbatim (trimmed/clamped). */
  other?: string;
  /** Optional model/version note, e.g. "Cursor (Claude Sonnet)". */
  modelNote?: string;
};

const KNOWN = new Set<string>(KNOWN_BUILT_WITH_TOOLS);

/** Loose aliases → canonical id, so free-form input still normalizes. */
const ALIASES: Record<string, BuiltWithTool> = {
  "v0.dev": "v0",
  vercel_v0: "v0",
  "claude code": "claude-code",
  claudecode: "claude-code",
  "hand coded": "hand-coded",
  handcoded: "hand-coded",
  manual: "hand-coded",
  "bolt.new": "bolt",
};

const MAX_TOOLS = 10;
const MAX_OTHER_LEN = 200;
const MAX_MODEL_NOTE_LEN = 200;

function canonicalize(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (KNOWN.has(s)) return s;
  if (ALIASES[s]) return ALIASES[s];
  return null; // unknown — caller routes it into `other`
}

/**
 * Normalize arbitrary client input into a BuiltWith, or null if nothing usable.
 * Never throws. Unknown tool strings are folded into `other` free text so a new
 * tool that isn't in our list is still captured (market radar), not dropped.
 */
export function normalizeBuiltWith(input: unknown): BuiltWith | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const rawTools = Array.isArray(o["tools"]) ? o["tools"] : [];
  const canonical: string[] = [];
  const unknowns: string[] = [];
  for (const t of rawTools) {
    if (typeof t !== "string") continue;
    const c = canonicalize(t);
    if (c) {
      if (!canonical.includes(c)) canonical.push(c);
    } else {
      const trimmed = t.trim();
      if (trimmed) unknowns.push(trimmed);
    }
  }

  // Explicit other free text + any unknown tool strings.
  let other = typeof o["other"] === "string" ? o["other"].trim() : "";
  if (unknowns.length) {
    other = [other, ...unknowns].filter(Boolean).join("; ");
  }
  other = other.slice(0, MAX_OTHER_LEN);
  if (other && !canonical.includes("other")) canonical.push("other");

  const tools = canonical.slice(0, MAX_TOOLS);
  if (tools.length === 0 && !other) return null;

  const result: BuiltWith = { tools };

  const primaryRaw = typeof o["primary"] === "string" ? canonicalize(o["primary"]) : null;
  if (primaryRaw && tools.includes(primaryRaw)) result.primary = primaryRaw;

  if (other) result.other = other;

  const modelNote = typeof o["modelNote"] === "string" ? o["modelNote"].trim().slice(0, MAX_MODEL_NOTE_LEN) : "";
  if (modelNote) result.modelNote = modelNote;

  return result;
}
