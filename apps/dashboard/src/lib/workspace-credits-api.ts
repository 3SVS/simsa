/**
 * workspace-credits-api.ts
 *
 * Stage 33: user-facing credit API client.
 * No admin key required — caller provides their own userKey.
 *
 * GET  /workspace/credits?userKey=...
 * POST /workspace/credits/top-up-requests
 * GET  /workspace/credits/top-up-requests?userKey=...
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";

export type CreditType = "review" | "fix" | "workspace";
export type TopUpStatus = "requested" | "fulfilled" | "rejected";

export type WorkspaceCreditBalance = {
  creditType: CreditType;
  label: string;
  balance: number;
};

export type WorkspaceAllowanceInfo = {
  period: "monthly";
  periodKey: string;
  includedRuns: number;
  usedThisPeriod: number;
  remainingIncludedRuns: number;
};

export type MarketplaceEntitlement = {
  planName: string;
  includedRunsPerMonth: number;
  source: "github_marketplace";
};

export type WorkspaceCreditsResponse = {
  ok: true;
  userKey: string;
  balances: WorkspaceCreditBalance[];
  allowance: {
    review: WorkspaceAllowanceInfo;
  };
  /** Present when a paid GitHub Marketplace plan raises the monthly included runs. */
  entitlement?: MarketplaceEntitlement;
  actualDebitsEnabled: boolean;
  actualDebitAllowedForUser: boolean;
};

export type TopUpRequest = {
  id: string;
  creditType: CreditType;
  requestedAmount: number;
  status: TopUpStatus;
  note?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type CreateTopUpInput = {
  userKey: string;
  creditType?: CreditType;
  requestedAmount: number;
  note?: string;
};

export type TopUpRequestsResponse = {
  ok: true;
  requests: TopUpRequest[];
};

export async function fetchWorkspaceCredits(
  userKey: string,
): Promise<WorkspaceCreditsResponse> {
  const res = await fetch(
    `${BASE_URL}/workspace/credits?userKey=${encodeURIComponent(userKey)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<WorkspaceCreditsResponse>;
}

export async function createTopUpRequest(
  input: CreateTopUpInput,
): Promise<{ ok: true; request: TopUpRequest }> {
  const res = await fetch(`${BASE_URL}/workspace/credits/top-up-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      (body as { error?: string; message?: string }).message ??
        (body as { error?: string }).error ??
        `HTTP ${res.status}`,
    );
  }
  return body as { ok: true; request: TopUpRequest };
}

export async function fetchTopUpRequests(
  userKey: string,
): Promise<TopUpRequest[]> {
  const res = await fetch(
    `${BASE_URL}/workspace/credits/top-up-requests?userKey=${encodeURIComponent(userKey)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as TopUpRequestsResponse;
  return body.requests;
}
