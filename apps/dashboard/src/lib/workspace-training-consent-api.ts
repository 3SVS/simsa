"use client";

/**
 * Dashboard API client for training-data consent. The consent is stored
 * server-side against the current clause version; `active` means consented to
 * the CURRENT version (the exact gate the capture path uses).
 *
 * Train K: responses go through `normalizeTrainingConsent` (the boundary check —
 * no `as` cast of the wire value). POST `{ consented:false }` is a real "no" on a
 * Train K server (stored with the current version + decided_at, never re-asked)
 * and, after a previous "yes", starts deleting the saved training copies.
 */

import { normalizeTrainingConsent, type LegacyTrainingConsent } from "@/lib/privacy-prefs.mjs";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export type TrainingConsentResponse = LegacyTrainingConsent;

const FAILED: TrainingConsentResponse = { ok: false, active: false, storageConfigured: false };

export async function fetchTrainingConsent(userKey: string): Promise<TrainingConsentResponse> {
  try {
    const res = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/training-consent?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const raw: unknown = await res.json().catch(() => null);
    return normalizeTrainingConsent(raw);
  } catch {
    return FAILED;
  }
}

export async function saveTrainingConsent(
  userKey: string,
  consented: boolean,
): Promise<TrainingConsentResponse> {
  try {
    const res = await fetch(`${CENTRAL_PLANE_URL}/workspace/training-consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, consented }),
      signal: AbortSignal.timeout(15000),
    });
    const raw: unknown = await res.json().catch(() => null);
    return normalizeTrainingConsent(raw);
  } catch {
    return FAILED;
  }
}
