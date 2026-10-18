// Type declarations for intent-missing.mjs ("맞나요?" 카드의 빠진 기준 → 항목).

export const MAX_MISSING_ITEMS: number;
export const MAX_MISSING_CHARS: number;
export function missingItemsFromText(
  text: string,
  existingIds?: readonly string[],
): Array<{ id: string; title: string; criteria: string[] }>;
