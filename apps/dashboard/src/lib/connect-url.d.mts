/** Type declarations for connect-url.mjs (D1-b re-entry deploy-URL normaliser). */

export type NormalizeDeployUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "invalid" | "scheme" | "host" };

export function normalizeDeployUrl(input: unknown): NormalizeDeployUrlResult;
