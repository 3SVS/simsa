/**
 * workspace-admin-credits-api.ts
 *
 * Client for admin credit ledger endpoints.
 * Admin key is entered at query time — never stored.
 *
 * GET  /admin/credits?userKey=...        — list balances
 * POST /admin/credits/grant             — manual grant
 * GET  /admin/credits/ledger?userKey=.. — ledger entries
 * GET  /admin/credits/preview?range=..  — dry-run preview
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";

export type CreditType = "review" | "fix" | "workspace";
export type LedgerDirection = "grant" | "debit" | "adjustment" | "preview";
export type UsageRange = "24h" | "7d" | "30d";

export type CreditBalance = {
  creditType: CreditType;
  balance: number;
  updatedAt: string;
};

export type LedgerEntry = {
  id: string;
  creditType: CreditType;
  amount: number;
  direction: LedgerDirection;
  reason: string;
  projectId?: string;
  sourceEventId?: string;
  createdAt: string;
};

export type GrantInput = {
  userKey: string;
  creditType: CreditType;
  amount: number;
  reason: string;
};

export type GrantResult = {
  ok: true;
  balance: { userKey: string; creditType: CreditType; balance: number };
  ledgerEntry: LedgerEntry;
};

export type PreviewEntry = {
  userKey: string;
  projectId?: string;
  eventType: string;
  creditType: CreditType;
  estimatedAmount: number;
  currentBalance?: number;
  wouldBlockIfEnforced?: boolean;
  reason: string;
  createdAt: string;
};

export type EnforcementPreview = {
  actualDebitsEnabled: false;
  wouldBlockCount: number;
  checkedEventCount: number;
};

export type PreviewResult = {
  ok: true;
  actualDebitsEnabled: false;
  range: UsageRange;
  totalEstimatedCredits: number;
  previewEntries: PreviewEntry[];
  enforcementPreview?: EnforcementPreview;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function headers(adminKey: string) {
  return { "x-admin-key": adminKey, "content-type": "application/json" };
}

export async function fetchCreditBalances(
  adminKey: string,
  userKey: string,
): Promise<CreditBalance[]> {
  const res = await fetch(
    `${BASE_URL}/admin/credits?userKey=${encodeURIComponent(userKey)}`,
    { headers: headers(adminKey) },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: true; balances: CreditBalance[] };
  return body.balances;
}

export async function grantCredits(
  adminKey: string,
  input: GrantInput,
): Promise<GrantResult> {
  const res = await fetch(`${BASE_URL}/admin/credits/grant`, {
    method: "POST",
    headers: headers(adminKey),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<GrantResult>;
}

export async function fetchCreditLedger(
  adminKey: string,
  userKey: string,
  limit = 50,
): Promise<LedgerEntry[]> {
  const params = new URLSearchParams({ userKey, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/admin/credits/ledger?${params}`, {
    headers: headers(adminKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: true; entries: LedgerEntry[] };
  return body.entries;
}

export async function fetchCreditPreview(
  adminKey: string,
  range: UsageRange,
  userKey?: string,
): Promise<PreviewResult> {
  const params = new URLSearchParams({ range });
  if (userKey) params.set("userKey", userKey);
  const res = await fetch(`${BASE_URL}/admin/credits/preview?${params}`, {
    headers: headers(adminKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PreviewResult>;
}
