import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AnswerKeySchema,
  EpisodicEntrySchema,
  FailureEntrySchema,
  SemanticRuleSchema,
  type AnswerKey,
  type EpisodicEntry,
  type FailureEntry,
  type SemanticRule,
} from "./schema.js";
import type { EpisodicPruneResult, MemoryReadQuery, MemoryRetrieval, MemoryStore } from "./store.js";
import { retrieve } from "./retrieval.js";
import {
  BUNDLED_DESIGN_ANSWER_KEYS,
  BUNDLED_DESIGN_FAILURES,
} from "./bundled-design-seeds.js";
import { hashAnswerKey, hashFailure } from "../federated/redact.js";
import { rerankByFrequency } from "../federated/frequency.js";

export interface FsStoreOptions {
  root: string;
  /**
   * v0.16.17 — when true, skip appending the bundled design seed
   * fallback (Phase 3) onto listAnswerKeys / listFailures results.
   * Tests use this to assert exclusively against user-written entries.
   * Production callers leave this unset (default false → bundled seeds
   * load).
   */
  skipBundledSeeds?: boolean;
}

/**
 * FileSystemMemoryStore — JSON-file backend for the self-evolve substrate.
 *
 * Layout under `root`:
 *   episodic/YYYY-MM-DD/pr-{n}.json          (90d TTL — pruning runs out-of-band)
 *   answer-keys/{domain}/{id}.json
 *   failure-catalog/{domain}/{id}.json
 *   semantic/rules.json                       (single JSONL file, appended)
 *
 * All paths are created lazily on first write. Reads are glob-less —
 * we walk only the directories we care about.
 */
export class FileSystemMemoryStore implements MemoryStore {
  private readonly root: string;
  private readonly skipBundledSeeds: boolean;

  constructor(opts: FsStoreOptions) {
    this.root = opts.root;
    this.skipBundledSeeds = opts.skipBundledSeeds === true;
  }

  async retrieve(q: MemoryReadQuery): Promise<MemoryRetrieval> {
    const k = q.k ?? 8;
    const answerKeyCorpus = await this.listAnswerKeys(q.domain);
    const failureCorpus = await this.listFailures(q.domain);
    const ruleCorpus = await this.listRules();

    const answerKeyScored = retrieve(
      answerKeyCorpus,
      q.query,
      {
        // H2 #6 — fold removed-blocker categories + messages into the
        // searchable text so a diff containing "console.log" matches an
        // answer-key whose previous-cycle blocker was about console.log.
        text: (d) => {
          const removed = d.removedBlockers ?? [];
          const removedText = removed.map((b) => `${b.category} ${b.message}`).join("\n");
          return `${d.pattern}\n${d.lesson}\n${d.tags.join(" ")}\n${removedText}`;
        },
        tags: (d) => d.tags,
        repo: (d) => d.repo,
      },
      k,
      { queryRepo: q.repo },
    );

    const failureScored = retrieve(
      failureCorpus,
      q.query,
      {
        text: (d) => `${d.title}\n${d.body}\n${d.category}\n${d.tags.join(" ")}`,
        tags: (d) => [d.category, ...d.tags],
      },
      k,
    );

    const answerKeys = q.federatedFrequency
      ? rerankByFrequency(answerKeyScored, q.federatedFrequency, hashAnswerKey).map((s) => s.doc)
      : answerKeyScored.map((s) => s.doc);

    const failures = q.federatedFrequency
      ? rerankByFrequency(failureScored, q.federatedFrequency, hashFailure).map((s) => s.doc)
      : failureScored.map((s) => s.doc);

    const rules = retrieve(
      ruleCorpus,
      q.query,
      {
        text: (d) => `${d.tag}\n${d.rule}`,
        tags: (d) => [d.tag],
      },
      Math.min(k, 4),
    ).map((s) => s.doc);

    return { answerKeys, failures, rules };
  }

  async writeEpisodic(entry: EpisodicEntry): Promise<void> {
    EpisodicEntrySchema.parse(entry);
    const day = entry.createdAt.slice(0, 10);
    const dir = path.join(this.root, "episodic", day);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `pr-${entry.pullNumber}-${entry.id}.json`),
      JSON.stringify(entry, null, 2),
      "utf8",
    );
  }

  async writeAnswerKey(key: AnswerKey): Promise<void> {
    AnswerKeySchema.parse(key);
    const dir = path.join(this.root, "answer-keys", key.domain);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key.id}.json`), JSON.stringify(key, null, 2), "utf8");
  }

  async writeFailure(entry: FailureEntry): Promise<void> {
    FailureEntrySchema.parse(entry);
    const dir = path.join(this.root, "failure-catalog", entry.domain);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), "utf8");
  }

  async writeRule(rule: SemanticRule): Promise<void> {
    SemanticRuleSchema.parse(rule);
    const dir = path.join(this.root, "semantic");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "rules.jsonl");
    await fs.appendFile(file, JSON.stringify(rule) + "\n", "utf8");
  }

  async listAnswerKeys(domain?: "code" | "design"): Promise<AnswerKey[]> {
    const domains: Array<"code" | "design"> = domain ? [domain] : ["code", "design"];
    const out: AnswerKey[] = [];
    for (const d of domains) {
      const dir = path.join(this.root, "answer-keys", d);
      const files = await safeReaddir(dir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(dir, f), "utf8");
        const parsed = AnswerKeySchema.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      }
    }
    // v0.16.7 — append bundled default seeds when the requested domain
    // includes 'design'. Bundled entries have no `repo` so the
    // queryRepo boost in retrieval prefers user-written entries when
    // both match (bundled is a fallback, not a competitor). v0.16.17 —
    // tests set skipBundledSeeds:true to assert against user-written
    // only.
    if (!this.skipBundledSeeds && (!domain || domain === "design")) {
      out.push(...BUNDLED_DESIGN_ANSWER_KEYS);
    }
    return out;
  }

  async listFailures(domain?: "code" | "design"): Promise<FailureEntry[]> {
    const domains: Array<"code" | "design"> = domain ? [domain] : ["code", "design"];
    const out: FailureEntry[] = [];
    for (const d of domains) {
      const dir = path.join(this.root, "failure-catalog", d);
      const files = await safeReaddir(dir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(dir, f), "utf8");
        const parsed = FailureEntrySchema.safeParse(JSON.parse(raw));
        if (parsed.success) out.push(parsed.data);
      }
    }
    // v0.16.7 — same fallback for design failure catalog. See above.
    if (!this.skipBundledSeeds && (!domain || domain === "design")) {
      out.push(...BUNDLED_DESIGN_FAILURES);
    }
    return out;
  }

  async findEpisodic(id: string): Promise<EpisodicEntry | null> {
    const episRoot = path.join(this.root, "episodic");
    const days = await safeReaddir(episRoot);
    for (const day of days) {
      const dir = path.join(episRoot, day);
      const files = await safeReaddir(dir);
      for (const f of files) {
        if (!f.includes(id) || !f.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(dir, f), "utf8");
          const parsed = EpisodicEntrySchema.safeParse(JSON.parse(raw));
          if (parsed.success && parsed.data.id === id) return parsed.data;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  async listEpisodic(): Promise<EpisodicEntry[]> {
    const episRoot = path.join(this.root, "episodic");
    const days = await safeReaddir(episRoot);
    const out: EpisodicEntry[] = [];
    for (const day of days) {
      const dir = path.join(episRoot, day);
      const files = await safeReaddir(dir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(dir, f), "utf8");
          const parsed = EpisodicEntrySchema.safeParse(JSON.parse(raw));
          if (parsed.success) out.push(parsed.data);
        } catch {
          continue;
        }
      }
    }
    return out;
  }

  /**
   * Enforce the episodic 90-day TTL (decision #17). Day directories are
   * named YYYY-MM-DD, so "older than cutoff" is a plain string compare.
   * Whole day-buckets strictly older than the cutoff are removed; the
   * cutoff day itself is kept. Non-date directories are left untouched.
   * Answer-keys / failure-catalog / semantic rules are never pruned.
   */
  async pruneEpisodic(opts?: { ttlDays?: number; now?: Date }): Promise<EpisodicPruneResult> {
    const ttlDays = opts?.ttlDays ?? 90;
    const now = opts?.now ?? new Date();
    const cutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);
    const cutoffDay = cutoff.toISOString().slice(0, 10);

    const episRoot = path.join(this.root, "episodic");
    const days = await safeReaddir(episRoot);
    let removedDays = 0;
    let removedEntries = 0;
    for (const day of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (day >= cutoffDay) continue;
      const dir = path.join(episRoot, day);
      const files = await safeReaddir(dir);
      removedEntries += files.filter((f) => f.endsWith(".json")).length;
      await fs.rm(dir, { recursive: true, force: true });
      removedDays += 1;
    }
    return { removedDays, removedEntries, cutoffDay };
  }

  async listRules(): Promise<SemanticRule[]> {
    const file = path.join(this.root, "semantic", "rules.jsonl");
    try {
      const raw = await fs.readFile(file, "utf8");
      const out: SemanticRule[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parsed = SemanticRuleSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
