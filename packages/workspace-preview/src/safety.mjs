// Stage 135 — workspace-preview safety metadata.
//
// Pure deterministic metadata declaring the package's hard boundaries. This
// package holds ONLY pure preview helpers shared by the dashboard and MCP Basic:
// no React/Next, no browser API, no network, no env, no mutation, no hosted
// execution, no payment provider, no secrets. Payment provider is TBD (Stripe is
// NOT assumed).

export const WORKSPACE_PREVIEW_PACKAGE = {
  name: "@simsa/workspace-preview",
  purpose: "Pure deterministic preview helpers for Simsa workspace planning.",
  isPublished: false,
  allowsNetwork: false,
  allowsMutation: false,
  allowsHostedExecution: false,
  assumesPaymentProvider: false,
  paymentProvider: "TBD",
};

export const WORKSPACE_PREVIEW_SAFETY_RULES = [
  "No React or Next runtime dependency.",
  "No browser API dependency.",
  "No process.env dependency.",
  "No network calls.",
  "No state mutation.",
  "No hosted execution.",
  "No payment provider assumption.",
  "No secret or token handling.",
];

export function getWorkspacePreviewSafetySummary() {
  return {
    package: { ...WORKSPACE_PREVIEW_PACKAGE },
    rules: WORKSPACE_PREVIEW_SAFETY_RULES.slice(),
  };
}
