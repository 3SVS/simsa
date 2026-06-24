// Stage 105 — deterministic Existing App Recovery Assessment.
//
// Pure, in-browser. NO live app inspection / URL fetch / screenshot / browser
// automation / GitHub API / repo clone / upload / backend / DB. Heuristics over
// the user's own description only — never claims to know actual app behavior.
//
// Framing: AI can create the first draft fast; Simsa helps decide what to
// accept, fix, rebuild, or verify next. Helpful, not judgmental.

function unique(arr) {
  return [...new Set(arr)];
}

const BASE_FOCUS = [
  "Core user journey",
  "Onboarding and empty states",
  "Error and recovery states",
  "Data privacy expectations",
  "Release readiness",
];

const BASE_ITEMS = [
  "A first-time user can understand what the app does and what to do next.",
  "The primary flow can be completed without unclear states.",
  "Empty states guide users instead of leaving blank screens.",
  "Failed actions show a clear recovery path.",
  "Private or sensitive data is not exposed unintentionally.",
  "The app has a release readiness checklist before sharing with users.",
];

const BASE_RISKS = [
  "Looks complete but core flows may not be verified.",
  "Missing empty/error states may block first-time users.",
  "Private data or permissions may not be clearly tested.",
  "Deployment or environment assumptions may not be documented.",
];

/**
 * @param {string} lower
 * @returns {import("./intake-ai-built-app.d.mts").AiBuiltAppSurface}
 */
function detectSurface(lower) {
  if (/\b(ios|android|mobile)\b/.test(lower)) return "mobile";
  if (/\b(dashboard|workspace|portal)\b/.test(lower)) return "dashboard";
  if (/\b(web app|webapp|web application|app)\b/.test(lower)) return "web_app";
  if (/\b(api|backend|endpoint|server)\b/.test(lower)) return "api";
  if (/\b(landing|homepage|marketing)\b/.test(lower)) return "landing";
  if (/\b(prototype|demo|mvp|vibe[- ]?coded|ai[- ]?built)\b/.test(lower))
    return "prototype";
  return "unknown";
}

/**
 * @param {string} rawInput
 * @returns {import("./intake-ai-built-app.d.mts").AiBuiltAppRecoveryPreview}
 */
export function buildAiBuiltAppRecoveryPreview(rawInput) {
  const text = typeof rawInput === "string" ? rawInput.trim() : "";
  const lower = text.toLowerCase();

  const has = {
    auth: /\b(auth|login|log in|sign in|sign-in|session|account)\b/.test(lower),
    payment: /\b(payment|pay|checkout|billing|subscription)\b/.test(lower),
    sharing: /\b(share|sharing|invite|link)\b/.test(lower),
    ai: /\b(ai|llm|model|gpt|prompt|agent)\b/.test(lower),
    deploy: /\b(github|repo|deploy|deployment|env|environment)\b/.test(lower),
    broken: /\b(messy|unusable|does ?n'?t work|broken|cannot build|can'?t build|buggy|bugs?|errors?)\b/.test(lower),
    launch: /\b(launch|release|ship|share|users|customers|early access)\b/.test(lower),
    coreFlow: /\b(user journey|main flow|core flow|primary flow|happy path)\b/.test(lower),
  };

  const likelyProductSurface = detectSurface(lower);

  const currentStateSummary = text
    ? `An AI-built ${
        likelyProductSurface === "unknown" ? "product draft" : likelyProductSurface.replace("_", " ")
      } described as: "${
        text.length > 160 ? `${text.slice(0, 157)}…` : text
      }". It needs structured acceptance review before it can be confidently shared or released.`
    : "This appears to be an AI-built product draft that needs structured acceptance review before it can be confidently shared or released.";

  // Focus areas
  const focus = [...BASE_FOCUS];
  if (has.auth) focus.push("Account and session behavior");
  if (has.payment) focus.push("Payment and billing flow");
  if (has.sharing) focus.push("Sharing and permission boundaries");
  if (has.ai) focus.push("AI output quality and fallback behavior");
  if (has.deploy) focus.push("Build, deploy, and environment verification");
  const recoveryFocusAreas = unique(focus);

  // Acceptance items
  const items = [...BASE_ITEMS];
  if (has.payment) items.push("A payment failure gives the user a clear next step.");
  if (has.auth) items.push("A signed-out user is handled without losing context.");
  if (has.sharing) items.push("Shared links expose only the intended information.");
  if (has.ai)
    items.push("AI-generated output has a fallback or review path when confidence is low.");
  const candidateAcceptanceItems = unique(items);

  // Risks
  const risks = [...BASE_RISKS];
  if (has.payment) risks.push("Payment edge cases (failure, refund) may be unhandled.");
  if (has.sharing) risks.push("Shared links may leak more than intended.");
  if (has.ai) risks.push("AI output may be unreliable without a fallback.");
  const likelyRisks = unique(risks);

  // Fix vs rebuild
  const fixVsRebuildSignals = {
    likelyKeep: [
      "Existing draft can serve as a starting point if the main user journey is visible.",
    ],
    likelyFix: [
      "Onboarding, empty states, and error recovery should be reviewed before release.",
    ],
    likelyRebuild: has.broken
      ? [
          "Some areas may need rebuilding — review whether the core flow and architecture allow safe iteration first.",
        ]
      : [
          "Rebuild only if the core product flow is unclear or the architecture prevents safe iteration.",
        ],
    needsVerification: [
      "Core flow",
      "Data privacy",
      "Build/deploy path",
      "Release readiness",
    ],
  };

  // Recommended next action
  let recommendedNextAction;
  if (!text || text.length < 40) recommendedNextAction = "create_acceptance_map";
  else if (has.broken) recommendedNextAction = "create_fix_stage";
  else if (has.launch) recommendedNextAction = "verify_release_readiness";
  else if (has.coreFlow) recommendedNextAction = "review_core_flow";
  else recommendedNextAction = "create_acceptance_map";

  // Missing questions
  const missingQuestions = unique([
    "What is the primary user journey?",
    "What already works today?",
    "What feels uncertain or unreliable?",
    "What should happen when the main flow fails?",
    "What data must stay private?",
    "What needs to be true before sharing this with users?",
  ]).slice(0, 6);

  // Confidence: more recognized context => higher
  const signalCount =
    (likelyProductSurface !== "unknown" ? 1 : 0) +
    Object.values(has).filter(Boolean).length;
  const confidence = signalCount >= 3 ? "high" : signalCount >= 1 ? "medium" : "low";

  return {
    currentStateSummary,
    likelyProductSurface,
    recoveryFocusAreas,
    candidateAcceptanceItems,
    likelyRisks,
    fixVsRebuildSignals,
    missingQuestions,
    recommendedNextAction,
    confidence,
  };
}

export const SAMPLE_AI_BUILT_APP =
  "I used an AI coding agent to build a task dashboard. It has a landing page, login, task creation, and sharing links. It looks usable, but I am not sure if onboarding, failed saves, mobile layout, and private shared links are safe enough to show early users.";
