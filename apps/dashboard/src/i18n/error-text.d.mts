import type { Dictionary } from "./dictionary.d.mts";

/**
 * Map a raw backend error code / message to a friendly localized string.
 * Unknown codes fall back to `t.errors[fallbackKey]` (default "generic").
 */
export function errorText(
  t: Dictionary,
  codeOrMessage: string | null | undefined,
  fallbackKey?: keyof Dictionary["errors"],
): string;
