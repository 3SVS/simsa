// Type declarations for write-consent.mjs (읽기 전용 런 → 동의하고 다시 확인).
export function reportNeedsWriteConsent(report: unknown): boolean;
export const RECHECK_WITH_CONSENT: Record<"ko" | "en", { lead: string; button: string }>;
