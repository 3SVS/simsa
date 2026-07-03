"use client";

/**
 * Dashboard API client for training-data consent. The consent is stored
 * server-side against the current clause version; `active` means consented to
 * the CURRENT version (the exact gate the capture path uses).
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export type TrainingConsentResponse = {
  ok: boolean;
  consented: boolean;
  consentVersion: string | null;
  currentVersion: string;
  active: boolean;
  storageConfigured?: boolean;
  error?: string;
};

export async function fetchTrainingConsent(userKey: string): Promise<TrainingConsentResponse> {
  try {
    const res = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/training-consent?userKey=${encodeURIComponent(userKey)}`,
    );
    return (await res.json()) as TrainingConsentResponse;
  } catch {
    return { ok: false, consented: false, consentVersion: null, currentVersion: "", active: false, error: "network" };
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
    });
    return (await res.json()) as TrainingConsentResponse;
  } catch {
    return { ok: false, consented: false, consentVersion: null, currentVersion: "", active: false, error: "network" };
  }
}
