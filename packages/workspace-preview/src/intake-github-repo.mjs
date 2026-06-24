// Stage 104 — deterministic GitHub Repo intake preview.
//
// Pure, in-browser. NO GitHub API, clone, remote file fetch, package.json fetch,
// dependency/security scan, or auth. A repo is an implementation artifact mapped
// back to product acceptance: from owner/repo (and path hints) we build a review
// PLAN. We never claim to know the repo contents (they aren't fetched).

const NAME_SIGNALS = [
  "dashboard",
  "app",
  "web",
  "frontend",
  "api",
  "server",
  "worker",
  "backend",
  "docs",
  "documentation",
  "landing",
  "mcp",
  "sdk",
  "package",
  "lib",
  "library",
  "client",
  "monorepo",
  "workspace",
];

const FOCUS_AREAS = {
  app: [
    "Product flow and navigation",
    "Onboarding and empty states",
    "Error and recovery states",
    "Environment / config expectations",
    "Release readiness",
  ],
  api: [
    "Endpoint contract clarity",
    "Error handling",
    "Auth and permission boundaries",
    "Rate limits and abuse handling",
    "Deployment and environment requirements",
  ],
  docs: [
    "Getting started path",
    "Installation or setup accuracy",
    "Examples and expected outputs",
    "Version / support expectations",
    "Developer trust",
  ],
  library: [
    "Public API shape",
    "Usage examples",
    "Versioning and compatibility",
    "Test coverage expectations",
    "Release / package readiness",
  ],
  monorepo: [
    "App / package boundaries",
    "Shared model consistency",
    "Build / test commands",
    "Deployment surfaces",
    "Release coordination",
  ],
  unknown: [
    "Repo purpose",
    "Primary product surface",
    "Build / test evidence",
    "Environment requirements",
    "Release readiness",
  ],
};

const CANDIDATE_ITEMS = [
  "The repo has a clear purpose and primary product surface.",
  "A reviewer can identify how to build and test the project.",
  "Required environment variables are documented without exposing secrets.",
  "Main user or API flows have acceptance checks.",
  "Error states and edge cases are represented in the review plan.",
  "Release readiness is reviewed before sharing with users.",
];

function unique(arr) {
  return [...new Set(arr)];
}

/**
 * Throw-free parse of `owner/repo`, a github URL, or a PR/tree URL.
 * @param {string} raw
 */
function parseRepoSafe(raw) {
  const trimmed = (typeof raw === "string" ? raw : "").trim();
  if (!trimmed) return { ok: false, owner: "", repo: "", isPr: false };

  let path = trimmed;
  // Strip scheme + github.com host if present.
  const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
  if (m) path = m[1];
  path = path.replace(/^\/+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  if (segs.length < 2) return { ok: false, owner: "", repo: "", isPr: false };

  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/i, "");
  // valid-ish owner/repo characters
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return { ok: false, owner: "", repo: "", isPr: false };
  }
  const isPr = segs[2] === "pull";
  return { ok: true, owner, repo, isPr };
}

/**
 * @param {string} owner
 * @param {string} repo
 * @returns {{ type: import("./intake-github-repo.d.mts").GitHubRepoType, signals: string[] }}
 */
function detectRepoType(owner, repo) {
  const hay = `${owner}/${repo}`.toLowerCase();
  const signals = unique(NAME_SIGNALS.filter((s) => hay.includes(s)));
  let type = "unknown";
  if (/docs|documentation/.test(hay)) type = "docs";
  else if (/api|server|worker|backend/.test(hay)) type = "api";
  else if (/sdk|package|\blib\b|library|client/.test(hay)) type = "library";
  else if (/monorepo|workspace/.test(hay)) type = "monorepo";
  else if (/app|web|dashboard|landing|frontend/.test(hay)) type = "app";
  return { type, signals };
}

/**
 * @param {string} rawInput
 * @returns {import("./intake-github-repo.d.mts").GitHubRepoIntakePreview}
 */
export function buildGitHubRepoIntakePreview(rawInput) {
  const parsed = parseRepoSafe(rawInput);

  if (!parsed.ok) {
    return {
      normalizedRepo: (typeof rawInput === "string" ? rawInput : "").trim(),
      owner: "Unknown",
      repo: "Unknown",
      repoUrl: "",
      repoNameSignals: [],
      likelyRepoType: "unknown",
      reviewFocusAreas: FOCUS_AREAS.unknown,
      candidateAcceptanceItems: CANDIDATE_ITEMS,
      missingQuestions: baseQuestions("unknown", false),
      confidence: "low",
    };
  }

  const { owner, repo, isPr } = parsed;
  const { type, signals } = detectRepoType(owner, repo);
  const confidence = type === "unknown" ? "medium" : "high";

  return {
    normalizedRepo: `${owner}/${repo}`,
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    repoNameSignals: signals,
    likelyRepoType: type,
    reviewFocusAreas: FOCUS_AREAS[type],
    candidateAcceptanceItems: CANDIDATE_ITEMS,
    missingQuestions: baseQuestions(type, isPr),
    confidence,
  };
}

/**
 * @param {import("./intake-github-repo.d.mts").GitHubRepoType} type
 * @param {boolean} isPr
 */
function baseQuestions(type, isPr) {
  const q = [
    "What is the primary product or package in this repo?",
    "What command builds and tests the project?",
    "Which flows must work before release?",
    "What environment variables are required?",
  ];
  // PR-vs-repo is the highest-signal question — add it before type-specific ones
  // so it survives the 6-question cap.
  if (isPr)
    q.push("This looks like a pull request URL. Should Simsa review the PR change or the whole repo?");
  if (type === "app") q.push("What is the first user journey to verify?");
  if (type === "api") q.push("Which endpoints are required for the first release?");
  if (type === "library") q.push("What is the minimum supported usage example?");
  if (type === "monorepo") q.push("Which app/package is the release target?");
  q.push("What evidence should prove this repo is ready?");
  return unique(q).slice(0, 6);
}

export const SAMPLE_GITHUB_REPO = "example/ai-built-task-app";
