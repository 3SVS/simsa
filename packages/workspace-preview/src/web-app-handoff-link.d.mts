// Type declarations for web-app-handoff-link.mjs (Stage 139).

export type WebAppHandoffIntent =
  | "new_intake"
  | "save_workflow"
  | "open_history"
  | "unlock_advanced"
  | "manage_team"
  | "review_preview";

export type WebAppHandoffInput = {
  baseUrl?: string;
  intent?: WebAppHandoffIntent | string;
  intakeType?: string;
  source?: "mcp_basic" | "dashboard" | "unknown" | string;
  title?: string;
  safeSummary?: string;
  previewKind?: string;
  previewId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export type WebAppHandoffLink = {
  url: string;
  path: string;
  query: Record<string, string>;
  omittedFields: string[];
  warnings: string[];
  boundary: {
    containsRawPrivateContent: false;
    containsSecrets: false;
    createsPersistence: false;
    requiresPayment: false;
    assumesPaymentProvider: false;
  };
};

export function buildWebAppHandoffLink(input?: WebAppHandoffInput): WebAppHandoffLink;

export const WEB_APP_HANDOFF_DEFAULT_BASE_URL: string;
