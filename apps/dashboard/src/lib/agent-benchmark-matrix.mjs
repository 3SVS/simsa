// Stage 69: candidate × acceptance-item matrix from a saved benchmark's
// itemOutcomesByCandidate. PURE — no LLM, no network. Rendering aid only:
// best/worst are computed for light visual hints, not strong claims.

const STATUS_RANK = { passed: 4, inconclusive: 3, needs_decision: 2, failed: 1, missing: 0 };

/**
 * Build the comparison matrix. Returns `available: false` when the benchmark
 * predates item-level outcomes (Stage 68) — the UI then shows its fallback.
 *
 * Rules:
 *  - candidate order = the benchmark's candidate order
 *  - item order = first candidate's items, then items only seen later, appended
 *  - a candidate missing an item's outcome → "missing"
 *  - hasDisagreement = candidates' statuses are not all identical
 */
export function buildBenchmarkMatrix({ candidates, itemOutcomesByCandidate }) {
  if (!itemOutcomesByCandidate) {
    return { available: false, rows: [], itemsCompared: 0, disagreementCount: 0 };
  }

  const candList = candidates ?? [];

  // candidateId → Map(itemId → outcome) (first outcome wins on duplicates)
  const byCand = {};
  for (const c of candList) {
    const m = new Map();
    for (const o of itemOutcomesByCandidate[c.id] ?? []) {
      if (!m.has(o.itemId)) m.set(o.itemId, o);
    }
    byCand[c.id] = m;
  }

  // Stable item order + best-known title per item.
  const order = [];
  const seen = new Set();
  const titleById = new Map();
  for (const c of candList) {
    for (const o of itemOutcomesByCandidate[c.id] ?? []) {
      if (!seen.has(o.itemId)) {
        seen.add(o.itemId);
        order.push(o.itemId);
      }
      if (!titleById.has(o.itemId) && typeof o.title === "string" && o.title) {
        titleById.set(o.itemId, o.title);
      }
    }
  }

  const rows = order.map((itemId) => {
    const statusesByCandidate = {};
    const evidenceByCandidate = {};
    let hasEvidence = false;
    const statusValues = [];

    for (const c of candList) {
      const o = byCand[c.id].get(itemId);
      const status = o ? o.status : "missing";
      statusesByCandidate[c.id] = status;
      statusValues.push(status);
      if (o && o.evidence) {
        evidenceByCandidate[c.id] = o.evidence;
        hasEvidence = true;
      }
    }

    const hasDisagreement = new Set(statusValues).size > 1;

    let bestStatus;
    let worstStatus;
    for (const s of statusValues) {
      if (bestStatus === undefined || STATUS_RANK[s] > STATUS_RANK[bestStatus]) bestStatus = s;
      if (worstStatus === undefined || STATUS_RANK[s] < STATUS_RANK[worstStatus]) worstStatus = s;
    }

    const row = {
      itemId,
      title: titleById.get(itemId) ?? itemId,
      statusesByCandidate,
      hasDisagreement,
      bestStatus,
      worstStatus,
    };
    if (hasEvidence) row.evidenceByCandidate = evidenceByCandidate;
    return row;
  });

  return {
    available: true,
    rows,
    itemsCompared: rows.length,
    disagreementCount: rows.filter((r) => r.hasDisagreement).length,
  };
}
