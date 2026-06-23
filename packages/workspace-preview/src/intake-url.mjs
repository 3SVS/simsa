// Stage 103 — deterministic Product URL intake preview.
//
// Pure, in-browser, NO live crawl / fetch / screenshot / HTML parse / API / DB.
// A URL is a product artifact: from its shape (domain + path + subdomain) we
// build a review PLAN — what to check before this surface can be accepted,
// fixed, or released. We never claim to know the real page content.

const PATH_SURFACE = {
  homepage: "Public landing surface",
  pricing: "Pricing and conversion surface",
  docs: "Developer or documentation surface",
  app: "Product application surface",
  demo: "Public demo surface",
  blog: "Content or education surface",
  unknown: "Product surface",
};

const FOCUS_AREAS = {
  homepage: [
    "Value proposition clarity",
    "Primary user and use case",
    "Call-to-action clarity",
    "Trust and proof",
    "Product promise vs available evidence",
  ],
  pricing: [
    "Plan clarity",
    "Feature-to-price mapping",
    "Billing expectations",
    "Refund / cancellation clarity",
    "Conversion friction",
  ],
  docs: [
    "Getting started path",
    "API / key handling guidance",
    "Examples and integration steps",
    "Developer trust",
    "Version or support expectations",
  ],
  app: [
    "Onboarding",
    "Empty states",
    "Error states",
    "Account / session behavior",
    "Data privacy expectations",
  ],
  demo: [
    "Fictional vs real data labeling",
    "Demo completeness",
    "Next-step CTA",
    "Evidence and limitations",
  ],
  blog: [
    "Content intent and audience",
    "Accuracy and claims",
    "Calls to action",
    "Links and navigation",
  ],
  unknown: [
    "Product intent",
    "Primary flow",
    "User promise",
    "Risk areas",
    "Release readiness",
  ],
};

const CANDIDATE_ITEMS = [
  "A first-time visitor can understand who the product is for.",
  "The primary CTA clearly explains the next step.",
  "Claims on the page are supported by visible evidence or clear limitations.",
  "Error, empty, and unavailable states are handled where relevant.",
  "The surface does not expose private or misleading information.",
];

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * Best-effort, throw-free URL parse. Returns null shape pieces on failure.
 * @param {string} raw
 */
function parseUrlSafe(raw) {
  const trimmed = (typeof raw === "string" ? raw : "").trim();
  if (!trimmed) return { ok: false, normalizedUrl: "", host: "", pathname: "/" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) {
      return { ok: false, normalizedUrl: trimmed, host: "", pathname: "/" };
    }
    return {
      ok: true,
      normalizedUrl: u.toString().replace(/\/$/, "") || u.toString(),
      host: u.hostname.toLowerCase(),
      pathname: u.pathname || "/",
    };
  } catch {
    return { ok: false, normalizedUrl: trimmed, host: "", pathname: "/" };
  }
}

/**
 * @param {string} host
 * @param {string} pathname
 * @returns {import("./intake-url.d.mts").ProductUrlPathType}
 */
function detectPathType(host, pathname) {
  if (host.startsWith("app.")) return "app";
  const p = pathname.toLowerCase().replace(/\/+$/, "");
  if (p === "" || p === "/") return "homepage";
  if (/^\/pricing/.test(p)) return "pricing";
  if (/^\/(docs|developers?|documentation)/.test(p)) return "docs";
  if (/^\/app(\/|$)/.test(p)) return "app";
  if (/^\/demo/.test(p)) return "demo";
  if (/^\/blog/.test(p)) return "blog";
  return "unknown";
}

/**
 * @param {string} rawInput
 * @returns {import("./intake-url.d.mts").ProductUrlIntakePreview}
 */
export function buildProductUrlIntakePreview(rawInput) {
  const parsed = parseUrlSafe(rawInput);

  if (!parsed.ok) {
    return {
      normalizedUrl: parsed.normalizedUrl,
      domain: "Unknown",
      pathType: "unknown",
      likelySurface: PATH_SURFACE.unknown,
      reviewFocusAreas: FOCUS_AREAS.unknown,
      candidateAcceptanceItems: CANDIDATE_ITEMS,
      missingQuestions: baseQuestions("unknown"),
      confidence: "low",
    };
  }

  const pathType = detectPathType(parsed.host, parsed.pathname);
  const confidence = pathType === "unknown" ? "medium" : "high";

  return {
    normalizedUrl: parsed.normalizedUrl,
    domain: parsed.host,
    pathType,
    likelySurface: PATH_SURFACE[pathType],
    reviewFocusAreas: FOCUS_AREAS[pathType],
    candidateAcceptanceItems: CANDIDATE_ITEMS,
    missingQuestions: baseQuestions(pathType),
    confidence,
  };
}

/** @param {import("./intake-url.d.mts").ProductUrlPathType} pathType */
function baseQuestions(pathType) {
  const q = [
    "What is the primary action this page should drive?",
    "Who is the intended user?",
    "What claims need evidence?",
    "What should be verified before sharing this surface publicly?",
    "What data, if any, should remain private?",
  ];
  if (pathType === "pricing")
    q.push("What billing terms need to be explained before launch?");
  if (pathType === "app")
    q.push("What should happen for new users with no data?");
  if (pathType === "docs")
    q.push("What is the first successful developer action?");
  return unique(q).slice(0, 6);
}

export const SAMPLE_PRODUCT_URL = "https://trysimsa.com/demo";
