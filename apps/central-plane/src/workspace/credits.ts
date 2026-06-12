/**
 * workspace/credits.ts
 *
 * Credit balance + ledger helpers for the workspace.
 *
 * IMPORTANT: Stage 20 — manual grant and preview only.
 * - No debit on feature execution.
 * - actualDebitsEnabled is always false.
 * - The debit helper exists but is NOT exported.
 */
import type { Env } from "../env.js";
import { getBillingRule } from "./billing-rules.js";

export type CreditType = "review" | "fix" | "workspace";
export type LedgerDirection = "grant" | "debit" | "adjustment" | "preview";

// ─── ID generator ────────────────────────────────────────────────────────────

function randId(prefix: string): string {
  const ts = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${r}`;
}

// ─── DB row types ─────────────────────────────────────────────────────────────

type BalanceRow = {
  id: string;
  user_key: string;
  credit_type: string;
  balance: number;
  created_at: string;
  updated_at: string;
};

type LedgerRow = {
  id: string;
  user_key: string;
  project_id: string | null;
  credit_type: string;
  amount: number;
  direction: string;
  reason: string;
  source_event_id: string | null;
  metadata_json: string | null;
  created_at: string;
};

// ─── Balance queries ──────────────────────────────────────────────────────────

export type CreditBalance = {
  creditType: CreditType;
  balance: number;
  updatedAt: string;
};

export async function getCreditBalance(
  env: Env,
  userKey: string,
  creditType: CreditType,
): Promise<CreditBalance | null> {
  const row = await env.DB.prepare(
    `SELECT credit_type, balance, updated_at FROM workspace_credit_balances
     WHERE user_key = ? AND credit_type = ?`,
  )
    .bind(userKey, creditType)
    .first<BalanceRow>();

  if (!row) return null;
  return { creditType: row.credit_type as CreditType, balance: row.balance, updatedAt: row.updated_at };
}

export async function listCreditBalances(
  env: Env,
  userKey: string,
): Promise<CreditBalance[]> {
  const result = await env.DB.prepare(
    `SELECT credit_type, balance, updated_at FROM workspace_credit_balances
     WHERE user_key = ?
     ORDER BY credit_type ASC`,
  )
    .bind(userKey)
    .all<BalanceRow>();
  return (result.results ?? []).map((r) => ({
    creditType: r.credit_type as CreditType,
    balance: r.balance,
    updatedAt: r.updated_at,
  }));
}

// ─── Ledger queries ───────────────────────────────────────────────────────────

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

export async function listCreditLedger(
  env: Env,
  userKey: string,
  limit = 50,
): Promise<LedgerEntry[]> {
  const result = await env.DB.prepare(
    `SELECT id, credit_type, amount, direction, reason, project_id, source_event_id, created_at
     FROM workspace_credit_ledger
     WHERE user_key = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userKey, limit)
    .all<LedgerRow>();
  return (result.results ?? []).map((r) => ({
    id: r.id,
    creditType: r.credit_type as CreditType,
    amount: r.amount,
    direction: r.direction as LedgerDirection,
    reason: r.reason,
    ...(r.project_id ? { projectId: r.project_id } : {}),
    ...(r.source_event_id ? { sourceEventId: r.source_event_id } : {}),
    createdAt: r.created_at,
  }));
}

// ─── Grant ────────────────────────────────────────────────────────────────────

export type GrantCreditsInput = {
  userKey: string;
  creditType: CreditType;
  amount: number;
  reason: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
};

export type GrantCreditsResult = {
  balance: { userKey: string; creditType: CreditType; balance: number };
  ledgerEntry: LedgerEntry;
};

export async function grantCredits(env: Env, input: GrantCreditsInput): Promise<GrantCreditsResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive integer");
  }

  const now = new Date().toISOString();
  const balanceId = randId("wcb");
  const ledgerId = randId("wcl");

  // UPSERT balance
  await env.DB.prepare(
    `INSERT INTO workspace_credit_balances (id, user_key, credit_type, balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_key, credit_type) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`,
  )
    .bind(balanceId, input.userKey, input.creditType, input.amount, now, now)
    .run();

  // Read back the updated balance
  const balanceRow = await env.DB.prepare(
    `SELECT balance FROM workspace_credit_balances WHERE user_key = ? AND credit_type = ?`,
  )
    .bind(input.userKey, input.creditType)
    .first<{ balance: number }>();

  const newBalance = balanceRow?.balance ?? input.amount;

  // Insert ledger entry
  await env.DB.prepare(
    `INSERT INTO workspace_credit_ledger
       (id, user_key, project_id, credit_type, amount, direction, reason, source_event_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'grant', ?, NULL, ?, ?)`,
  )
    .bind(
      ledgerId,
      input.userKey,
      input.projectId ?? null,
      input.creditType,
      input.amount,
      input.reason,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    )
    .run();

  const entry: LedgerEntry = {
    id: ledgerId,
    creditType: input.creditType,
    amount: input.amount,
    direction: "grant",
    reason: input.reason,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    createdAt: now,
  };

  return {
    balance: { userKey: input.userKey, creditType: input.creditType, balance: newBalance },
    ledgerEntry: entry,
  };
}

// ─── Preview (no ledger write) ─────────────────────────────────────────────────

type UsageEventForPreview = {
  user_key: string;
  project_id: string | null;
  event_type: string;
  count: number;
  sample_created_at: string;
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

function rangeToSeconds(range: string): number {
  if (range === "24h") return 86400;
  if (range === "30d") return 86400 * 30;
  return 86400 * 7;
}

export async function previewCreditDebitFromUsageEvents(
  env: Env,
  opts: { range?: string; userKey?: string },
): Promise<PreviewEntry[]> {
  const range = opts.range ?? "7d";
  const cutoffMs = Date.now() - rangeToSeconds(range) * 1000;
  const cutoff = new Date(cutoffMs).toISOString();

  let stmt;
  if (opts.userKey) {
    stmt = env.DB.prepare(
      `SELECT user_key, project_id, event_type, COUNT(*) as count, MAX(created_at) as sample_created_at
       FROM workspace_usage_events
       WHERE created_at >= ? AND user_key = ?
       GROUP BY user_key, project_id, event_type`,
    ).bind(cutoff, opts.userKey);
  } else {
    stmt = env.DB.prepare(
      `SELECT user_key, project_id, event_type, COUNT(*) as count, MAX(created_at) as sample_created_at
       FROM workspace_usage_events
       WHERE created_at >= ?
       GROUP BY user_key, project_id, event_type`,
    ).bind(cutoff);
  }

  const result = await stmt.all<UsageEventForPreview>();
  const rows = result.results ?? [];

  // Build candidate entries first
  const entries: PreviewEntry[] = [];
  for (const row of rows) {
    const rule = getBillingRule(row.event_type);
    if (rule.billingStatus !== "billable_candidate" || !rule.creditType) continue;
    const estimatedAmount = rule.creditCost * row.count;
    if (estimatedAmount <= 0) continue;
    entries.push({
      userKey: row.user_key,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      eventType: row.event_type,
      creditType: rule.creditType as CreditType,
      estimatedAmount,
      reason: `${rule.label} × ${row.count}회 예상`,
      createdAt: row.sample_created_at,
    });
  }

  // Annotate with current balances — collect unique (userKey, creditType) pairs
  const pairs = new Map<string, { userKey: string; creditType: CreditType }>();
  for (const e of entries) {
    const key = `${e.userKey}:${e.creditType}`;
    if (!pairs.has(key)) pairs.set(key, { userKey: e.userKey, creditType: e.creditType });
  }

  const balanceMap = new Map<string, number>();
  await Promise.all(
    Array.from(pairs.values()).map(async ({ userKey, creditType }) => {
      try {
        const bal = await getCreditBalance(env, userKey, creditType);
        balanceMap.set(`${userKey}:${creditType}`, bal?.balance ?? 0);
      } catch {
        balanceMap.set(`${userKey}:${creditType}`, 0);
      }
    }),
  );

  for (const e of entries) {
    const currentBalance = balanceMap.get(`${e.userKey}:${e.creditType}`) ?? 0;
    e.currentBalance = currentBalance;
    e.wouldBlockIfEnforced = currentBalance < e.estimatedAmount;
  }

  return entries.sort((a, b) => b.estimatedAmount - a.estimatedAmount);
}
