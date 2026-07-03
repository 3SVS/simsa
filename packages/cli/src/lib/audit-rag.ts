/**
 * Audit RAG context loader.
 *
 * Unifies the five sources of audit-time retrieval-augmented context:
 *   - local FileSystemMemoryStore (answer-keys + failure-catalog under
 *     `.conclave/answer-keys` and `.conclave/failure-catalog`, optionally
 *     overridden by config)
 *   - promoted seeds (community-derived, Sprint C)
 *   - spec updates (changelog-monitor, Sprint E3)
 *   - OSS PR patterns (oss-pr-miner, Sprint E2)
 *   - external curated references (Phase 4)
 *
 * Pre-refactor each source was fetched serially inside the audit()
 * function. The serial pattern was historical (one source added per
 * sprint, glued on at the bottom of the block); none of them depend
 * on each other so we Promise.all them here.
 *
 * Failure handling is per-source: any individual fetcher rejection
 * degrades into empty arrays for that source rather than aborting the
 * whole context load. The `audit` command was already doing this
 * inline; the behaviour is preserved literally.
 *
 * The ordering of the merged `answerKeys` / `failureCatalog` arrays
 * matches the original implementation byte-for-byte: local, promoted,
 * spec, oss, external. The prompt construction downstream reads this
 * array in order, so any change would silently shift which hints make
 * the prompt cut.
 */
import {
  type FileSystemMemoryStore,
  formatAnswerKeyForPrompt,
  formatFailureForPrompt,
} from "@simsa/core";
import { fetchExternalReferences } from "./external-references.js";
import { fetchPromotedSeeds } from "./promoted-seeds.js";
import { fetchOssPatterns } from "./oss-patterns.js";
import { fetchSpecUpdates } from "./spec-updates.js";
import { fetchExternalIntel } from "./external-intel.js";

export interface AuditRagSourceCounts {
  local: { answerKeys: number; failures: number };
  promoted: { answerKeys: number; failureCatalog: number };
  external: { answerKeys: number; failureCatalog: number };
  ossPatterns: { answerKeys: number; failureCatalog: number };
  specUpdates: { answerKeys: number; failureCatalog: number };
  externalIntel: { answerKeys: number; failureCatalog: number };
}

export interface AuditRagContext {
  /** Flat list ready for `ReviewContext.answerKeys`. */
  answerKeys: string[];
  /** Flat list ready for `ReviewContext.failureCatalog`. */
  failureCatalog: string[];
  /** Per-source counts — used for both stderr telemetry and the
   *  AuditReport.ragInjection field. */
  sources: AuditRagSourceCounts;
}

export async function loadAuditRagContext(opts: {
  memoryStore: FileSystemMemoryStore;
  repo: string;
  domain: "code" | "design";
}): Promise<AuditRagContext> {
  const { memoryStore, repo, domain } = opts;

  const emptyExternal = { answerKeys: [] as string[], failureCatalog: [] as string[] };
  const emptyLocal = {
    answerKeys: [] as Awaited<ReturnType<FileSystemMemoryStore["retrieve"]>>["answerKeys"],
    failures: [] as Awaited<ReturnType<FileSystemMemoryStore["retrieve"]>>["failures"],
    rules: [] as Awaited<ReturnType<FileSystemMemoryStore["retrieve"]>>["rules"],
  };

  const [retrieval, externalRefs, promotedSeeds, ossPatterns, specUpdates, externalIntel] =
    await Promise.all([
      memoryStore
        .retrieve({ query: `audit domain=${domain} repo=${repo}`, repo, domain, k: 8 })
        .catch(() => emptyLocal),
      fetchExternalReferences(domain).catch(() => emptyExternal),
      fetchPromotedSeeds(domain).catch(() => emptyExternal),
      fetchOssPatterns(domain).catch(() => emptyExternal),
      fetchSpecUpdates(domain).catch(() => emptyExternal),
      fetchExternalIntel(domain).catch(() => emptyExternal),
    ]);

  const localAnswerKeys = retrieval.answerKeys.map(formatAnswerKeyForPrompt);
  const localFailures = retrieval.failures.map(formatFailureForPrompt);

  const answerKeys = [
    ...localAnswerKeys,
    ...promotedSeeds.answerKeys,
    ...specUpdates.answerKeys,
    ...ossPatterns.answerKeys,
    ...externalRefs.answerKeys,
    ...externalIntel.answerKeys,
  ];
  const failureCatalog = [
    ...localFailures,
    ...promotedSeeds.failureCatalog,
    ...specUpdates.failureCatalog,
    ...ossPatterns.failureCatalog,
    ...externalRefs.failureCatalog,
    ...externalIntel.failureCatalog,
  ];

  return {
    answerKeys,
    failureCatalog,
    sources: {
      local: {
        answerKeys: localAnswerKeys.length,
        failures: localFailures.length,
      },
      promoted: {
        answerKeys: promotedSeeds.answerKeys.length,
        failureCatalog: promotedSeeds.failureCatalog.length,
      },
      external: {
        answerKeys: externalRefs.answerKeys.length,
        failureCatalog: externalRefs.failureCatalog.length,
      },
      ossPatterns: {
        answerKeys: ossPatterns.answerKeys.length,
        failureCatalog: ossPatterns.failureCatalog.length,
      },
      specUpdates: {
        answerKeys: specUpdates.answerKeys.length,
        failureCatalog: specUpdates.failureCatalog.length,
      },
      externalIntel: {
        answerKeys: externalIntel.answerKeys.length,
        failureCatalog: externalIntel.failureCatalog.length,
      },
    },
  };
}

/**
 * Render the stderr telemetry line the audit command writes after
 * loading RAG context. Returns null when nothing was retrieved (the
 * pre-refactor branch wrote nothing in that case).
 */
export function formatAuditRagTelemetry(
  domain: "code" | "design",
  ctx: AuditRagContext,
): string | null {
  const { answerKeys, failureCatalog, sources } = ctx;
  if (answerKeys.length === 0 && failureCatalog.length === 0) return null;
  return (
    `conclave audit: RAG context — ${answerKeys.length} answer-key(s) ` +
    `(${sources.promoted.answerKeys} promoted, ${sources.specUpdates.answerKeys} spec, ` +
    `${sources.ossPatterns.answerKeys} oss, ${sources.external.answerKeys} external, ` +
    `${sources.externalIntel.answerKeys} intel) + ` +
    `${failureCatalog.length} failure(s) ` +
    `(${sources.promoted.failureCatalog} promoted, ${sources.specUpdates.failureCatalog} spec, ` +
    `${sources.ossPatterns.failureCatalog} oss, ${sources.external.failureCatalog} external, ` +
    `${sources.externalIntel.failureCatalog} intel) ` +
    `from ${domain} domain\n`
  );
}
