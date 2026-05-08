/**
 * v0.16.7 — bundled default design seeds for the self-evolve substrate.
 *
 * Why: a fresh repo has no `.conclave/answer-keys/design/` and no
 * `.conclave/failure-catalog/design/`. Without seed data, DesignAgent's
 * RAG section is empty for every project's first N reviews, and the
 * "learns from past patterns" promise doesn't kick in until the user
 * has accumulated their own history.
 *
 * Bundled seeds give every project a credible starting baseline drawn
 * from public design-system best-practice (Vercel Design, Linear's
 * pricing patterns, Stripe's contrast discipline, Tailwind UI's
 * accessibility patterns, Refactoring UI's spatial rules). They land
 * on the same wire format as user-written entries, so retrieval +
 * scoring works identically.
 *
 * Bundled entries are tagged with `repo: undefined` so the queryRepo
 * boost in retrieval.ts goes to user-written entries first when both
 * match — bundled is a fallback layer, not a competitor.
 *
 * Adding a new bundled seed: append to the array below with a stable
 * `id` (slug). Update both the AnswerKey and FailureEntry arrays
 * if the pattern has both positive + negative framings.
 */
import type { AnswerKey, FailureEntry } from "./schema.js";

const ISO = "2026-05-09T00:00:00.000Z"; // bundled-seed creation date — never mutates

export const BUNDLED_DESIGN_ANSWER_KEYS: readonly AnswerKey[] = [
  {
    id: "bundled-design-pricing-tier-hierarchy",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/pricing-tier-hierarchy",
    lesson:
      "Pricing pages with three tiers should give the recommended tier visible weight: a thicker outer rule, a small ribbon ('Most popular', 'Recommended'), and a saturated CTA color. The two non-recommended tiers stay neutral. Visual hierarchy speeds the decision; flat rows of identical cards stall it.",
    tags: ["pricing", "card", "hierarchy", "ribbon", "cta"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-single-accent-restraint",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/single-accent-restraint",
    lesson:
      "Use one dominant accent color. Apply it to ~5–10% of the surface (links, primary CTAs, section markers, focused inputs). Do NOT spread the accent thin across the page in big tinted blocks — that flattens contrast and reads as 'AI demo' rather than considered design. Linear, Stripe, Vercel all keep accent surface tiny.",
    tags: ["color", "accent", "contrast", "restraint"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-typography-pairing",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/display-body-typography-pair",
    lesson:
      "Pair a distinctive display face for headings with a calm, well-engineered body face. Examples that work: Bricolage Grotesque + Geist; Bodoni Moda + Crimson Pro; Söhne + Inter Display. Avoid using ONE generic sans (Inter, Roboto) for both — that's the canonical 'AI slop' tell. Distinctive display gives the page a memorable cadence.",
    tags: ["typography", "font-pair", "display", "body"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-section-rhythm",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/alternating-section-bg",
    lesson:
      "When stacking 4+ sections vertically, alternate the section background between two paper tones (e.g. paper #FAFAF7 and paper-dim #F1F0EA). Without this, adjacent section boundaries are invisible at any scroll depth and the page reads as one slab. Editorial print does the same — recto/verso variation gives visual cadence.",
    tags: ["spacing", "background", "section", "rhythm"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-focus-ring-2px",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/focus-ring-2px-offset",
    lesson:
      "Replace the browser-default focus outline with a 2px-offset ring in the brand accent. Pattern: outer 2px = page background, inner 2px = accent. Meets WCAG 2.4.7 visible-focus + matches modern dev-tool aesthetics. Browsers' default `outline: auto` looks dated and fails on some themes.",
    tags: ["accessibility", "focus", "keyboard", "wcag"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-cta-button-weight",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/cta-primary-secondary-weight",
    lesson:
      "Primary CTA: solid accent fill with white text + medium font weight. Secondary CTA: outlined or ghost, same shape, same height. Avoid two filled buttons of equal weight side by side — users hesitate on which is canonical. The visual hierarchy is the answer.",
    tags: ["button", "cta", "hierarchy", "primary", "secondary"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-monospace-meta-rows",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/monospace-meta-rows",
    lesson:
      "Use monospace at small size + uppercase + wide letter-spacing for meta labels (version markers, section numbers, timestamps, deploy IDs). Pattern: `font-mono text-[11px] uppercase tracking-[0.18em]`. Reads as instrument-panel data; signals the product is a real dev tool and not marketing fluff.",
    tags: ["typography", "monospace", "label", "meta", "dev-tool"],
    removedBlockers: [],
  },
  {
    id: "bundled-design-card-keyline-not-shadow",
    createdAt: ISO,
    domain: "design",
    pattern: "by-pattern/card-1px-keyline",
    lesson:
      "On light backgrounds, prefer a 1px hairline border (paper-line) over an offset drop-shadow for card edges. Hairlines feel like printed plate edges; drop-shadows on light bg feel like 2010-era SaaS modals. Only use shadows for the highlight/recommended card to give it lift.",
    tags: ["card", "border", "shadow", "elevation"],
    removedBlockers: [],
  },
];

export const BUNDLED_DESIGN_FAILURES: readonly FailureEntry[] = [
  {
    id: "bundled-design-fail-purple-gradient-ai-slop",
    createdAt: ISO,
    domain: "design",
    category: "other",
    severity: "major",
    title: "Generic AI-tool 'purple gradient on white' aesthetic",
    body:
      "Background: white. Hero: purple→pink gradient text or background. Body font: Inter. CTA: rounded-full with gradient fill. This combination is the canonical AI-product visual cliché — every YC AI demo of 2024–2025 looked the same. It signals 'generic AI tool, not differentiated', regardless of the product's actual value. Replace the gradient with a single saturated accent against a non-white paper bg, swap Inter for a distinctive sans (Bricolage Grotesque, Geist, Söhne), and let restraint do the work.",
    tags: ["aesthetics", "gradient", "ai-slop", "cliche"],
  },
  {
    id: "bundled-design-fail-flat-color-spread",
    createdAt: ISO,
    domain: "design",
    category: "other",
    severity: "minor",
    title: "Single accent color spread thin across the entire page",
    body:
      "When the brand accent is applied at 30%+ surface coverage (large tinted hero sections, full-width accent backgrounds on every other section), contrast collapses. The accent becomes the page's wallpaper and stops drawing the eye. Bring accent surface down to 5–10% — links, primary CTAs, focus rings, one or two highlight rules. Reserve large color blocks for paper / paper-dim neutrals.",
    tags: ["color", "accent", "contrast", "saturation"],
  },
  {
    id: "bundled-design-fail-icon-only-buttons-no-aria",
    createdAt: ISO,
    domain: "design",
    category: "accessibility",
    severity: "blocker",
    title: "Icon-only button without aria-label",
    body:
      "Icon-only interactive elements (close ✕, settings ⚙, menu ≡) must carry `aria-label` or a visually-hidden `<span>` so screen readers announce the action. SVG-icon-as-button without a label is a WCAG 4.1.2 fail. Pattern: `<button aria-label='Close dialog'><CloseIcon /></button>` or wrap a visually-hidden text span.",
    tags: ["accessibility", "wcag", "aria", "icon", "button"],
  },
  {
    id: "bundled-design-fail-color-as-only-meaning",
    createdAt: ISO,
    domain: "design",
    category: "accessibility",
    severity: "major",
    title: "Color is the only carrier of meaning",
    body:
      "Status badges, error states, and chart data that distinguish 'good' vs 'bad' purely by color (green/red) fail WCAG 1.4.1 — colorblind users see no difference. Add a textual label, an icon, or a pattern fill. For a verdict tag, use the verdict word AND the color: '✅ APPROVE' not just a green pill.",
    tags: ["accessibility", "wcag", "colorblind", "status", "badge"],
  },
  {
    id: "bundled-design-fail-hardcoded-color-in-tokenized-repo",
    createdAt: ISO,
    domain: "design",
    category: "other",
    severity: "minor",
    title: "Hardcoded #RRGGBB / rgb() in a repo that has design tokens",
    body:
      "When the repo uses Tailwind theme extensions, CSS variables, or a design-tokens module, but a new component drops in `color: #3b82f6;` or `bg-[#5C111C]`, the system fragments. The next theme change won't propagate. Replace with the token (`text-accent-500`, `var(--color-accent-500)`). Token drift compounds fast — call it out at PR time.",
    tags: ["design-token", "drift", "hardcoded", "tailwind", "css-var"],
  },
  {
    id: "bundled-design-fail-no-focus-state",
    createdAt: ISO,
    domain: "design",
    category: "accessibility",
    severity: "major",
    title: "Interactive element with `outline: none` and no replacement",
    body:
      "Removing the browser default focus outline without supplying a replacement focus ring kills keyboard navigation. WCAG 2.4.7 violation. Pattern fix: `:focus-visible { outline: none; box-shadow: 0 0 0 2px <bg>, 0 0 0 4px <accent>; }` so the ring shows up only on keyboard focus, not on mouse click.",
    tags: ["accessibility", "wcag", "focus", "keyboard", "outline"],
  },
  {
    id: "bundled-design-fail-cropped-truncation",
    createdAt: ISO,
    domain: "design",
    category: "regression",
    severity: "major",
    title: "Cropped text on primary surface — flex child without min-w-0",
    body:
      "A flex child that contains long text without `min-w-0` will refuse to shrink and instead push siblings off-screen or get cropped at the container edge. Pattern: a button label like 'Connect GitHub — install the App' inside a `flex` row truncates as 'Connect GitHub — install the…'. Fix: add `min-w-0` to the flex child or use `flex-wrap` for narrow viewports. Always check primary-surface CTAs at 320px width.",
    tags: ["layout", "flex", "responsive", "truncation", "min-w-0"],
  },
  {
    id: "bundled-design-fail-rainbow-palette",
    createdAt: ISO,
    domain: "design",
    category: "other",
    severity: "minor",
    title: "Rainbow palette across pricing / section / category cards",
    body:
      "Assigning a different bright color to each pricing tier, category card, or section block (red/yellow/green/blue rotation) signals 'I added decoration to compensate for weak hierarchy'. Stick to a single accent + neutrals, and let typography + spacing do the differentiation. Multi-hue rainbows read as primary-school posters, not professional dev tools.",
    tags: ["color", "palette", "rainbow", "decoration", "hierarchy"],
  },
];
