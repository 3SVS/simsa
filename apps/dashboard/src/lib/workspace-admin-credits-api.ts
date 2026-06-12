/**
 * workspace-admin-credits-api.ts
 *
 * Client for admin credit ledger endpoints.
 * Admin key is entered at query time — never stored.
 *
 * GET  /admin/credits?userKey=...                   — list balances
 * POST /admin/credits/grant                         — manual grant
 * GET  /admin/credits/ledger?userKey=..             — ledger entries
 * GET  /admin/credits/preview?range=..              — dry-run preview
 * GET  /admin/credits/monthly-preview?month=YYYY-MM — monthly breakdown
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

export type LedgerStatus = "pending" | "applied" | "failed";

export type LedgerEntry = {
  id: string;
  creditType: CreditType;
  amount: number;
  direction: LedgerDirection;
  status: LedgerStatus;
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
  rawEventCount?: number;
  currentBalance?: number;
  wouldBlockIfEnforced?: boolean;
  allowance?: {
    periodKey: string;
    includedRuns: number;
    usedBeforeThisEvent: number;
    coveredByAllowance: boolean;
  };
  reason: string;
  createdAt: string;
};

// Stage 23: preview-only ledger entry — direction is "preview_debit", never written to D1
export type CreditLedgerPreviewEntry = {
  id: string;
  userKey: string;
  projectId?: string;
  eventType: string;
  creditType: CreditType;
  amount: number;
  direction: "preview_debit";
  reason: string;
  allowance?: {
    periodKey: string;
    includedRuns: number;
    usedBeforeThisEvent: number;
    coveredByAllowance: boolean;
  };
  balance: {
    currentBalance: number;
    wouldHaveRemainingBalance: number;
    wouldBlockIfEnforced: boolean;
  };
  createdAt: string;
};

export type AllowanceSummary = {
  enabled: true;
  rule: string;
  totalCoveredByAllowance: number;
  totalBillableAfterAllowance: number;
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
  allowanceSummary?: AllowanceSummary;
  previewEntries: PreviewEntry[];
  enforcementPreview?: EnforcementPreview;
  enforcementSummary?: EnforcementPreview;
  ledgerPreview?: CreditLedgerPreviewEntry[];
};

// Stage 23: monthly breakdown types
export type MonthlyUserSummary = {
  userKey: string;
  totalPrReviewRuns: number;
  coveredByAllowance: number;
  billableRuns: number;
  estimatedReviewCredits: number;
  currentReviewBalance: number;
  wouldBlockCount: number;
};

export type MonthlyProjectSummary = {
  projectId: string;
  totalPrReviewRuns: number;
  billableRuns: number;
  estimatedReviewCredits: number;
};

export type MonthlyCreditPreviewResult = {
  ok: true;
  actualDebitsEnabled: false;
  month: string;
  userKey?: string;
  allowanceRule: {
    eventType: string;
    includedRuns: number;
    creditType: string;
  };
  users: MonthlyUserSummary[];
  projects: MonthlyProjectSummary[];
};

// Stage 24: credit execution config
export type CreditExecutionConfigResult = {
  ok: true;
  actualDebitsEnabled: boolean;
  blockingEnabled: boolean;
  envFlags: {
    ENABLE_ACTUAL_CREDIT_DEBITS: string;
    ENABLE_CREDIT_BLOCKING: string;
  };
};

// Stage 29: rollout checklist types
export type RolloutCheckStatus = "manual" | "passed" | "warning" | "blocked";

export type RolloutCheck = {
  id: string;
  label: string;
  status: RolloutCheckStatus;
  description: string;
};

export type RolloutScenario = {
  id: string;
  label: string;
  flags: { actualDebitsEnabled: boolean; blockingEnabled: boolean };
  expectedOutcome: string;
};

export type AdminCreditRolloutChecklistResponse = {
  ok: true;
  productionSafety: {
    actualDebitsEnabled: boolean;
    blockingEnabled: boolean;
    safeForProductionDefault: boolean;
  };
  requiredChecks: RolloutCheck[];
  recommendedScenarios: RolloutScenario[];
  productionEnableCriteria: string[];
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

export async function fetchCreditConfig(adminKey: string): Promise<CreditExecutionConfigResult> {
  const res = await fetch(`${BASE_URL}/admin/credits/config`, {
    headers: headers(adminKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CreditExecutionConfigResult>;
}

export async function fetchRolloutChecklist(
  adminKey: string,
): Promise<AdminCreditRolloutChecklistResponse> {
  const res = await fetch(`${BASE_URL}/admin/credits/rollout-checklist`, {
    headers: headers(adminKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<AdminCreditRolloutChecklistResponse>;
}

export async function fetchMonthlyCreditPreview(
  adminKey: string,
  month?: string,
  userKey?: string,
): Promise<MonthlyCreditPreviewResult> {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (userKey) params.set("userKey", userKey);
  const res = await fetch(`${BASE_URL}/admin/credits/monthly-preview?${params}`, {
    headers: headers(adminKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<MonthlyCreditPreviewResult>;
}
