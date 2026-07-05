/**
 * feedback-api.ts — submit in-app feedback to the central plane.
 * Replaces the mailto: flow (non-developers often have no mail client).
 */
const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export type FeedbackKind = "bug" | "question" | "suggestion";

/** Send feedback with auto-attached context. Returns ok/false; never throws. */
export async function sendFeedback(input: {
  userKey: string;
  kind: FeedbackKind;
  message: string;
  route?: string;
  projectId?: string;
}): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`${CENTRAL_PLANE_URL}/workspace/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
