/**
 * receipt.mjs — Stage 258A spike. Pure, deterministic Internal Completion Receipt + Fix Brief.
 *
 * Receipt and Fix Brief are assembled from the factual evidence + decision + opinion. They keep
 * Browser Evidence and AI Opinion in clearly separated sections, and carry NO numeric score.
 */

/** Guard: reject any numeric score sneaking into a receipt object. Returns true or throws. */
export function assertNoNumericScores(obj) {
  const walk = (v, path) => {
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (/score/i.test(k)) throw new Error(`numeric scoring forbidden: field "${path}${k}"`);
        walk(val, `${path}${k}.`);
      }
    } else if (typeof v === "string") {
      if (/\b\d{1,3}\s*\/\s*100\b/.test(v)) throw new Error(`numeric scoring forbidden: "${v}"`);
    }
  };
  walk(obj, "");
  return true;
}

/** Build the structured Internal Completion Receipt (JSON-friendly). Deterministic. */
export function buildReceipt({ run, config, evidence, decision, opinion }) {
  const receipt = {
    receiptType: "external_completion_loop",
    run,
    target: config.targetUrl,
    intentAnchor: config.intentAnchor,
    browserEvidence: {
      loaded: evidence.urlLoaded,
      loadStatus: evidence.loadStatus,
      viewport: evidence.viewport,
      primaryCtaFound: evidence.primaryCtaFound,
      detectedInputs: evidence.detectedInputs ?? [],
      clickedText: evidence.clickedText,
      clickedSelector: evidence.clickedSelector,
      routeAfterClick: evidence.routeAfterClick,
      routeChanged: evidence.routeChanged,
      consoleErrors: evidence.consoleErrors,
      networkFailures: evidence.networkFailures,
      screenshots: evidence.screenshots,
      timestamp: evidence.timestamp,
    },
    aiOpinion: opinion,
    notVerified: deriveNotVerified(evidence),
    skipped: evidence.skipped,
    userDecisionNeeded:
      decision.decision === "User Acceptance Required"
        ? decision.reasons
        : [],
    decision: decision.decision,
    decisionReasons: decision.reasons,
    limitations: [
      "Single core flow only (homepage → primary intent CTA/input → next screen).",
      "No visual oracle: the spike confirms navigation/console/network facts but does NOT judge whether the next screen is genuinely usable.",
      "Does not log in, does not click destructive/forbidden actions, does not bypass auth.",
      "Not a claim that all bugs are found or that the product is complete.",
    ],
  };
  assertNoNumericScores(receipt);
  return receipt;
}

function deriveNotVerified(evidence) {
  const items = [];
  if (!evidence.primaryCtaFound) {
    items.push(
      (evidence.detectedInputs?.length ? "Primary intent CTA — none matched (an intent-relevant input was detected instead)." : "Primary intent CTA/input — none detected."),
    );
  }
  if (evidence.primaryCtaFound && !evidence.clicked) items.push("CTA click outcome — CTA found but not safely clickable.");
  items.push("Next-screen usability — no visual/interaction oracle in this spike.");
  return items;
}

/** Render the receipt as markdown (human-readable, evidence/opinion clearly separated). */
export function renderReceiptMarkdown(receipt) {
  const lines = [];
  lines.push(`# Internal Completion Receipt — ${receipt.run}`, "");
  lines.push(`**Target:** ${receipt.target}`, "");
  lines.push(`**Intent Anchor:**`, `> ${receipt.intentAnchor}`, "");
  const e = receipt.browserEvidence;
  lines.push(`## Browser Evidence (facts)`, "");
  lines.push(`- Loaded: ${e.loaded} (HTTP ${e.loadStatus})`);
  lines.push(`- Viewport: ${e.viewport.width}x${e.viewport.height}`);
  lines.push(`- Primary intent CTA found: ${e.primaryCtaFound ? "yes" : "no"}`);
  lines.push(`- Visible text inputs detected: ${(e.detectedInputs ?? []).length}${(e.detectedInputs ?? []).length ? ` (e.g. ${e.detectedInputs.slice(0, 3).map((i) => i.placeholder || i.type).join(", ")})` : ""}`);
  if (e.clickedText) lines.push(`- Clicked: "${e.clickedText}"  (selector: \`${e.clickedSelector}\`)`);
  lines.push(`- Route after click: ${e.routeAfterClick ?? "(no click)"} ${e.routeChanged ? "(route changed)" : "(no route change)"}`);
  lines.push(`- Console errors: ${e.consoleErrors.length ? e.consoleErrors.join(" | ") : "none"}`);
  lines.push(`- Network failures: ${e.networkFailures.length ? e.networkFailures.join(" | ") : "none"}`);
  lines.push(`- Screenshots: ${e.screenshots.join(", ")}`);
  lines.push(`- Timestamp: ${e.timestamp}`, "");
  lines.push(`## AI Opinion (interpretation — NOT a measured fact)`, "");
  lines.push(`- Likely intent mismatch: ${receipt.aiOpinion.likelyIntentMismatch}`);
  lines.push(`- Likely implementation choice: ${receipt.aiOpinion.likelyImplementationChoice}`);
  lines.push(`- Suggested severity: ${receipt.aiOpinion.suggestedSeverity}`);
  for (const r of receipt.aiOpinion.whyThisMayBlockCompletion) lines.push(`  - ${r}`);
  lines.push(`- Recommended fix direction: ${receipt.aiOpinion.recommendedFixDirection}`, "");
  if (receipt.skipped.length) {
    lines.push(`## Skipped (forbidden/unclear actions, not clicked)`, "");
    for (const s of receipt.skipped) lines.push(`- "${s.text}" — ${s.reason}`);
    lines.push("");
  }
  lines.push(`## Not Verified`, "");
  for (const n of receipt.notVerified) lines.push(`- ${n}`);
  lines.push("");
  if (receipt.userDecisionNeeded.length) {
    lines.push(`## User Decision Needed`, "");
    for (const u of receipt.userDecisionNeeded) lines.push(`- ${u}`);
    lines.push("");
  }
  lines.push(`## Decision`, "", `**${receipt.decision}**`);
  for (const r of receipt.decisionReasons) lines.push(`- ${r}`);
  lines.push("", `## Limitations`, "");
  for (const l of receipt.limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}

/** Build the Fix Brief (actionable repair instruction for a Claude/Codex-style loop). */
export function renderFixBrief({ config, evidence, decision, opinion }) {
  const lines = [];
  lines.push(`# Fix Brief — ${config.targetUrl}`, "");
  lines.push(`## Observed failure`, "");
  lines.push(decision.reasons.join(" "), "");
  lines.push(`## Reproduction steps`, "");
  config.coreFlow.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  if (evidence.clickedText) lines.push(`${config.coreFlow.length + 1}. (spike clicked "${evidence.clickedText}")`);
  lines.push("");
  lines.push(`## Expected behavior (from intent anchor)`, "");
  lines.push(`> ${config.intentAnchor}`, "");
  lines.push(`Interacting with the primary intent CTA/input should advance the user to a usable next screen that serves the stated intent, with no console/network errors.`, "");
  lines.push(`## Suspected area`, "");
  lines.push(opinion.recommendedFixDirection, "");
  if (config.repoContext?.finding) {
    lines.push(`Read-only repo context (no code modified): ${config.repoContext.finding}`, "");
  }
  lines.push(`## Specific repair instruction`, "");
  if (evidence.networkFailures?.length) {
    lines.push(`- The page's required backend/API requests are failing (host unreachable). Restore the data dependency: verify the deployed environment's backend URL points to a live host, re-provision the backing service if it was paused/deleted, then redeploy and re-run this flow.`);
    if (/supabase/i.test(config.repoContext?.finding ?? "")) {
      lines.push(`- Repo context indicates the backend URL comes from \`NEXT_PUBLIC_SUPABASE_URL\`; confirm that env var (in the deploy target) resolves to a live Supabase project. Do NOT commit secrets.`);
    }
  } else if (!evidence.primaryCtaFound) {
    lines.push(`- Add a homepage primary CTA with clear onboarding text (e.g. "Get started"), linking to a valid onboarding route.`);
  } else if (/\/undefined|\/null|\/404|error|not-found/i.test(String(evidence.routeAfterClick ?? ""))) {
    lines.push(`- Fix the primary CTA target so it resolves to a real onboarding route; ensure that route renders.`);
  } else if (!evidence.routeChanged) {
    lines.push(`- If the CTA opens an in-page/modal onboarding step, ensure a verifiable signal (URL change or a visible onboarding region) so completion can be confirmed.`);
  } else {
    lines.push(`- Verify the onboarding screen reached at "${evidence.routeAfterClick}" is usable end-to-end.`);
  }
  lines.push("");
  lines.push(`## Rerun command`, "", "```", `node tools/simsa-completion-loop-spike/run.mjs`, "```", "");
  lines.push(`## Acceptance condition`, "");
  lines.push(`- Interacting with the primary intent CTA/input advances to a usable next screen that serves the intent anchor.`);
  lines.push(`- No console errors and no failed network requests during the flow.`);
  lines.push(`- The same result is observed on two consecutive runs.`, "");
  return lines.join("\n");
}
