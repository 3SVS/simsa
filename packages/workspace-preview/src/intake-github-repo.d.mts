// Type declarations for intake-github-repo.mjs (Stage 104 — GitHub repo intake).

export type GitHubRepoType =
  | "app"
  | "docs"
  | "api"
  | "library"
  | "monorepo"
  | "unknown";

export type GitHubRepoIntakePreview = {
  normalizedRepo: string;
  owner: string;
  repo: string;
  repoUrl: string;
  repoNameSignals: string[];
  likelyRepoType: GitHubRepoType;
  reviewFocusAreas: string[];
  candidateAcceptanceItems: string[];
  missingQuestions: string[];
  confidence: "low" | "medium" | "high";
};

export function buildGitHubRepoIntakePreview(
  rawInput: string,
): GitHubRepoIntakePreview;
export const SAMPLE_GITHUB_REPO: string;
