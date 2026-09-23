// Train N2 — types for login-providers.mjs.
export type LoginProviderId = "google" | "email" | "github";
export type LoginProvider = { id: LoginProviderId; tier: "primary" | "developer"; available: boolean };
export function loginProviderPlan(state?: { googleUnavailable?: boolean; githubUnavailable?: boolean }): LoginProvider[];
export function firstWorkingPrimary(state?: { googleUnavailable?: boolean; githubUnavailable?: boolean }): LoginProviderId;
