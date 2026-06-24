// Type declarations for safety.mjs (Stage 135).

export const WORKSPACE_PREVIEW_PACKAGE: {
  name: string;
  purpose: string;
  isPublished: boolean;
  allowsNetwork: boolean;
  allowsMutation: boolean;
  allowsHostedExecution: boolean;
  assumesPaymentProvider: boolean;
  paymentProvider: string;
};

export const WORKSPACE_PREVIEW_SAFETY_RULES: string[];

export function getWorkspacePreviewSafetySummary(): {
  package: typeof WORKSPACE_PREVIEW_PACKAGE;
  rules: string[];
};
