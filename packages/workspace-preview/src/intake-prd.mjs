// Stage 102 — deterministic PRD / spec intake preview.
//
// Heuristic, pure, in-browser. NO AI, no backend, no fetch, no DB. Turns pasted
// PRD/spec text into a draft preview: product intent, likely users, candidate
// flows, candidate acceptance items, and missing questions. A PRD is an
// artifact Simsa converts into acceptance work — not the final source of truth,
// so everything here is "candidate / likely / preview".

const INTENT_SIGNALS = [
  "goal",
  "problem",
  "overview",
  "summary",
  "purpose",
  "objective",
  "we need",
  "we want",
];

const USER_SIGNALS = [
  "user",
  "admin",
  "owner",
  "team",
  "customer",
  "mentor",
  "founder",
  "operator",
  "manager",
  "member",
  "guest",
];

// action -> flow phrasing
const ACTION_FLOWS = {
  create: "create the main item",
  submit: "submit a request",
  invite: "invite others",
  login: "log in",
  "sign up": "sign up",
  signup: "sign up",
  upload: "upload content",
  connect: "connect an external source",
  review: "review results",
  approve: "approve work",
  reject: "reject work",
  pay: "pay or check out",
  share: "share with others",
  export: "export data",
  download: "download data",
  comment: "leave a comment",
};

function cap(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * @param {string} rawInput
 * @returns {import("./intake-prd.d.mts").PrdIntakePreview}
 */
export function buildPrdIntakePreview(rawInput) {
  const text = typeof rawInput === "string" ? rawInput.trim() : "";
  const lower = text.toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let signals = 0;

  // ── Product intent ─────────────────────────────────────────────────────────
  const intentLine = lines.find((l) =>
    INTENT_SIGNALS.some((sig) => l.toLowerCase().includes(sig)),
  );
  let productIntent;
  if (intentLine) {
    signals += 1;
    // strip a leading "Label:" prefix if present
    productIntent = intentLine.replace(/^[A-Za-z /]+:\s*/, "").trim() || intentLine;
  } else {
    productIntent =
      "This PRD describes a product or feature that needs to be converted into acceptance items and staged review work.";
  }

  // ── Likely users ───────────────────────────────────────────────────────────
  const likelyUsers = unique(
    USER_SIGNALS.filter((u) => lower.includes(u)).map((u) => cap(u)),
  );
  if (likelyUsers.length) signals += 1;
  const users = likelyUsers.length ? likelyUsers : ["User", "Operator"];

  // ── Candidate user flows ───────────────────────────────────────────────────
  const detectedActions = Object.keys(ACTION_FLOWS).filter((a) =>
    lower.includes(a),
  );
  const actorForFlow = users[0] ?? "User";
  let candidateUserFlows;
  if (detectedActions.length) {
    signals += 1;
    candidateUserFlows = unique(
      detectedActions.map((a) => `${actorForFlow} can ${ACTION_FLOWS[a]}.`),
    );
  } else {
    candidateUserFlows = [
      `${actorForFlow} can complete the product's main action.`,
    ];
  }

  // ── Candidate acceptance items ─────────────────────────────────────────────
  const flowItems = detectedActions.length
    ? [
        "A user can complete the main action without errors.",
        "The system records the user's decision or submission.",
        "The user receives clear feedback after submission.",
      ]
    : [];
  const genericItems = [
    "Primary flow is clear on first use.",
    "Empty and error states explain what to do next and are recoverable.",
    "Sensitive data is not exposed unintentionally.",
    "Release readiness is reviewed before sharing with users.",
  ];
  const candidateAcceptanceItems = unique([...flowItems, ...genericItems]);

  // ── Missing questions ──────────────────────────────────────────────────────
  const missingQuestions = [];
  if (!likelyUsers.length) missingQuestions.push("Who is the primary user?");
  if (!detectedActions.length)
    missingQuestions.push("What is the first action they need to complete?");
  missingQuestions.push("What counts as a successful outcome?");
  missingQuestions.push("What should happen when the flow fails?");
  missingQuestions.push("What data should be private?");
  missingQuestions.push("What needs to be verified before release?");
  if (/\b(pay|payment|checkout|billing|subscription)\b/.test(lower)) {
    missingQuestions.push(
      "How are payment failures and refunds handled?",
    );
  }
  if (/\b(github|repo|repository|pull request|\bpr\b)\b/.test(lower)) {
    missingQuestions.push(
      "Which repository or branch is the source of truth for implementation?",
    );
  }
  // keep it to 3–6 useful questions
  const trimmedQuestions = unique(missingQuestions).slice(0, 6);

  // ── Confidence ─────────────────────────────────────────────────────────────
  const confidence = signals >= 3 ? "high" : signals === 2 ? "medium" : "low";

  return {
    productIntent,
    likelyUsers: users,
    candidateUserFlows,
    candidateAcceptanceItems,
    missingQuestions: trimmedQuestions,
    confidence,
  };
}

export const SAMPLE_PRD = [
  "Overview: We want to help founders review AI-built apps before launch.",
  "Users: Founder, product operator.",
  "Main flow: A founder submits a GitHub repo or product URL, reviews acceptance items, and decides what to fix before release.",
  "Success: The founder receives a staged plan with evidence-backed next steps.",
  "Risks: The app may miss onboarding, error states, privacy checks, or release readiness.",
].join("\n");
