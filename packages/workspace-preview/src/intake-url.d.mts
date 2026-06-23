// Type declarations for intake-url.mjs (Stage 103 — Product URL intake preview).

export type ProductUrlPathType =
  | "homepage"
  | "pricing"
  | "docs"
  | "app"
  | "demo"
  | "blog"
  | "unknown";

export type ProductUrlIntakePreview = {
  normalizedUrl: string;
  domain: string;
  pathType: ProductUrlPathType;
  likelySurface: string;
  reviewFocusAreas: string[];
  candidateAcceptanceItems: string[];
  missingQuestions: string[];
  confidence: "low" | "medium" | "high";
};

export function buildProductUrlIntakePreview(
  rawInput: string,
): ProductUrlIntakePreview;
export const SAMPLE_PRODUCT_URL: string;
