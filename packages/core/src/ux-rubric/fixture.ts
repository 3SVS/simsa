/**
 * Baseline UX QA — dogfood fixture for the §8 acceptance scaffold.
 *
 * Four synthetic detector signals, one per statically-runnable rule, that a
 * clean classification must map 4/4. Paired with an empty CLEAN_SIGNALS set that
 * must yield zero findings — the false-positive floor. Real browser detection
 * lands in a later PR; this fixture is what PR2's detectors must reproduce.
 */
import type { RawSignal } from "./schema.js";

/** One violation per static (gating) rule — the "known-bad" surface. */
export const DOGFOOD_SIGNALS: RawSignal[] = [
  {
    ruleId: "L1-a11y-button-name",
    evidence: "<button> with no text, aria-label, or aria-labelledby",
    url: "https://example.test/",
    selector: "header > button:nth-child(2)",
  },
  {
    ruleId: "L1-link-broken",
    evidence: 'Footer link "Docs" resolves to HTTP 404',
    url: "https://example.test/",
    selector: "footer a[href='/docs']",
  },
  {
    ruleId: "L2-escape-hatch",
    evidence: "Project detail view renders no back, close, or home control",
    url: "https://example.test/projects/1",
  },
  {
    ruleId: "L2-silent-failure",
    evidence: 'Result panel shows "예시 초안입니다" placeholder while data-degraded="true" is set',
    url: "https://example.test/projects/1/spec",
    selector: "[data-degraded='true']",
  },
];

/** A clean surface emits nothing — classification must return zero findings. */
export const CLEAN_SIGNALS: RawSignal[] = [];
