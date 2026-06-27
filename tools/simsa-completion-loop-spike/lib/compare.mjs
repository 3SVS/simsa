/**
 * compare.mjs — Stage 258A spike. Pure, deterministic reproducibility comparison of run-1 vs run-2.
 *
 * Reproducibility is judged on STABLE core findings — target, CTA presence/text, post-click route,
 * whether console/network errors occurred (boolean class), and the final decision. Exact retry
 * COUNTS (how many times a failing request was retried) are timing-sensitive network noise: they are
 * reported as explained "variance", and do NOT by themselves flip a stable result to nondeterministic.
 * If a CORE finding diverges, that nondeterminism IS a finding and the run is not marked success.
 */

/** Compare two receipts. Returns a structured reproducibility verdict. Pure. */
export function compareRuns(r1, r2) {
  const e1 = r1.browserEvidence;
  const e2 = r2.browserEvidence;
  const hasErr = (e) => e.consoleErrors.length > 0;
  const hasNet = (e) => e.networkFailures.length > 0;

  const coreChecks = [
    { name: "same target URL", same: r1.target === r2.target, a: r1.target, b: r2.target },
    { name: "same primary CTA found", same: e1.primaryCtaFound === e2.primaryCtaFound, a: e1.primaryCtaFound, b: e2.primaryCtaFound },
    { name: "same primary CTA text", same: (e1.clickedText ?? null) === (e2.clickedText ?? null), a: e1.clickedText, b: e2.clickedText },
    { name: "same route after click", same: (e1.routeAfterClick ?? null) === (e2.routeAfterClick ?? null), a: e1.routeAfterClick, b: e2.routeAfterClick },
    { name: "console errors present (class)", same: hasErr(e1) === hasErr(e2), a: hasErr(e1), b: hasErr(e2) },
    { name: "network failures present (class)", same: hasNet(e1) === hasNet(e2), a: hasNet(e1), b: hasNet(e2) },
    { name: "same decision", same: r1.decision === r2.decision, a: r1.decision, b: r2.decision },
  ];

  // Informational variance (explained, non-gating).
  const varianceNotes = [];
  if (e1.consoleErrors.length !== e2.consoleErrors.length)
    varianceNotes.push(`console-error count differed (run-1=${e1.consoleErrors.length}, run-2=${e2.consoleErrors.length}) — expected timing/retry variance; error class was the same.`);
  if (e1.networkFailures.length !== e2.networkFailures.length)
    varianceNotes.push(`network-failure count differed (run-1=${e1.networkFailures.length}, run-2=${e2.networkFailures.length}) — expected retry variance against an unreachable host; failure class was the same.`);

  const divergences = coreChecks.filter((c) => !c.same);
  const reproducible = divergences.length === 0;
  return {
    reproducible,
    coreChecks,
    divergences,
    varianceNotes,
    verdict: reproducible
      ? `REPRODUCIBLE (core findings) — run-1 and run-2 agree on target, CTA, route, error class, and decision (${r1.decision}).${varianceNotes.length ? " Non-gating timing variance noted." : ""}`
      : `NONDETERMINISTIC — ${divergences.length} CORE finding(s) diverged between runs (reported as a finding, NOT a success).`,
  };
}

/** Render the comparison as markdown. */
export function renderComparisonMarkdown(cmp, r1, r2) {
  const lines = [];
  lines.push(`# Reproducibility Comparison — run-1 vs run-2`, "");
  lines.push(`**Verdict:** ${cmp.verdict}`, "");
  lines.push(`## Core findings (gate reproducibility)`, "");
  lines.push(`| Check | run-1 | run-2 | match |`, `| --- | --- | --- | --- |`);
  for (const c of cmp.coreChecks) lines.push(`| ${c.name} | ${fmt(c.a)} | ${fmt(c.b)} | ${c.same ? "✓" : "✗"} |`);
  lines.push("");
  if (cmp.varianceNotes.length) {
    lines.push(`## Variance (informational, non-gating)`, "");
    for (const v of cmp.varianceNotes) lines.push(`- ${v}`);
    lines.push("");
  }
  if (!cmp.reproducible) {
    lines.push(`## Core divergences (findings)`, "");
    for (const d of cmp.divergences) lines.push(`- ${d.name}: run-1=${fmt(d.a)} vs run-2=${fmt(d.b)}`);
    lines.push("", `Nondeterminism observed in a core finding — the spike does NOT mark this target as verified.`, "");
  } else {
    lines.push(`Both runs agree on all core findings. The decision **${r1.decision}** is stable across run-1 and run-2.`, "");
  }
  return lines.join("\n");
}

function fmt(v) {
  if (v === null || v === undefined) return "—";
  return String(v);
}
