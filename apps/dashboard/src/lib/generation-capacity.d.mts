// Type declarations for generation-capacity.mjs (비용 권고 ③, 2026-09-30).
import type { Dictionary } from "../i18n/dictionary.mjs";

export const GENERATION_CAPACITY: "generation_capacity";

/** What an API client returns for the service-wide capacity answer. */
export type GenerationCapacityError = { ok: false; error: "generation_capacity"; resetAt: string | null };

export function readGenerationCapacity(body: unknown): { resetAt: string | null } | null;

export function capacityFromResponse(resp: Response): Promise<{ resetAt: string | null } | null>;

export function generationCapacityText(
  t: Dictionary,
  resetAt: string | null | undefined,
  opts?: { now?: Date; timeZone?: string },
): string;
