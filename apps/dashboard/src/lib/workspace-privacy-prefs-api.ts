"use client";

/**
 * Train K — 계약 2: GET/POST /workspace/privacy-prefs.
 *
 * Both calls return the normalized prefs or `null` ("unknown"). `null` covers an
 * old server (no route → 404 without CORS headers, which the browser reports as
 * a network error), a network failure, and an off-contract body alike — the UI
 * treats all three the same: hide the result-screen card and line, disable the
 * settings switch with an explanation. Never a guessed state.
 */

import { normalizePrivacyPrefs, type OpsMeta, type PrivacyPrefs } from "@/lib/privacy-prefs.mjs";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export async function fetchPrivacyPrefs(userKey: string): Promise<PrivacyPrefs | null> {
  try {
    const res = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/privacy-prefs?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    const raw: unknown = await res.json().catch(() => null);
    return normalizePrivacyPrefs(raw);
  } catch {
    return null;
  }
}

export async function savePrivacyPrefs(userKey: string, opsMeta: OpsMeta): Promise<PrivacyPrefs | null> {
  try {
    const res = await fetch(`${CENTRAL_PLANE_URL}/workspace/privacy-prefs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, opsMeta }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json().catch(() => null);
    return normalizePrivacyPrefs(raw);
  } catch {
    return null;
  }
}
