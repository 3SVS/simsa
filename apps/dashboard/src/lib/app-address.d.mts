// Types for app-address.mjs (2026-09-28, D4 inline address start).

export function normalizeAppAddress(
  input: unknown,
): { ok: true; url: string } | { ok: false; error: "empty" | "invalid" };

export type AppAddressErrorKey = "invalid" | "limit" | "notSaved" | "forbidden" | "busy" | "generic";

export function appAddressErrorKey(code: unknown): AppAddressErrorKey;
