import { Compounding, CreditAccount } from './account.model';

export interface ShareRow {
  id: string;
  name: string;
  colorSlot: number | null;
  /** The quantity being shared out: d_i (debt) or m_i (next month's interest). */
  value: number;
  /** Fraction of the total, 0..1. Shares in one result sum to 1. */
  share: number;
}

/**
 * Effective annual rate r (as a decimal) for a nominal APR (in percent),
 * assuming the balance is carried for a full year with no payments:
 *
 *   daily365:  (1 + APR/365)^365 − 1
 *   daily360:  (1 + APR/360)^365 − 1   (360-day divisor, applied every actual day)
 *   monthly:   (1 + APR/12)^12  − 1
 */
export function effectiveAnnualRate(aprPercent: number, compounding: Compounding): number {
  const apr = aprPercent / 100;
  switch (compounding) {
    case 'daily360':
      return Math.pow(1 + apr / 360, 365) - 1;
    case 'monthly':
      return Math.pow(1 + apr / 12, 12) - 1;
    case 'daily365':
    default:
      return Math.pow(1 + apr / 365, 365) - 1;
  }
}

/** D = Σ d_i */
export function totalDebt(accounts: readonly CreditAccount[]): number {
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}

/** Account i's share of total debt: d_i / D. */
export function debtShares(accounts: readonly CreditAccount[]): ShareRow[] {
  return shares(accounts, (a) => a.balance);
}

/**
 * Interest account i accrues over the next month (1/12 year) at its current
 * balance, using its own compounding:
 *
 *   m_i = d_i · ((1 + r_i)^(1/12) − 1)     r_i = effective annual rate (decimal)
 */
export function nextMonthInterest(a: CreditAccount): number {
  return a.balance * monthlyRate(a);
}

/** Effective monthly rate (decimal): (1 + r_i)^(1/12) − 1. */
export function monthlyRate(a: CreditAccount): number {
  return Math.pow(1 + effectiveAnnualRate(a.apr, a.compounding), 1 / 12) - 1;
}

/**
 * Account i's share of next month's INTEREST (not of debt):
 *
 *   s_i = m_i / Σ_j m_j
 *
 * 0% APR accounts accrue nothing and are omitted from the rows.
 */
export function interestShares(accounts: readonly CreditAccount[]): ShareRow[] {
  return shares(accounts, nextMonthInterest);
}

function shares(accounts: readonly CreditAccount[], weight: (a: CreditAccount) => number): ShareRow[] {
  const weighted = accounts.map((a) => ({ a, w: a.balance > 0 ? weight(a) : 0 })).filter((x) => x.w > 0);
  const total = weighted.reduce((sum, x) => sum + x.w, 0);
  if (total <= 0) return [];
  return weighted.map(({ a, w }) => ({
    id: a.id,
    name: a.name,
    colorSlot: a.colorSlot,
    value: w,
    share: w / total,
  }));
}

/** Balance-weighted average nominal APR, in percent: Σ d_i·apr_i / D. */
export function weightedAverageApr(accounts: readonly CreditAccount[]): number {
  const D = totalDebt(accounts);
  if (D <= 0) return 0;
  return accounts.reduce((sum, a) => sum + a.balance * a.apr, 0) / D;
}

/** Next statement's interest across all accounts: Σ m_i. */
export function estimatedMonthlyInterest(accounts: readonly CreditAccount[]): number {
  return accounts.reduce((sum, a) => sum + nextMonthInterest(a), 0);
}

/** D / Σ limit, 0..∞ (can exceed 1 when over limit). */
export function utilization(accounts: readonly CreditAccount[]): number {
  const limit = accounts.reduce((sum, a) => sum + a.creditLimit, 0);
  return limit > 0 ? totalDebt(accounts) / limit : 0;
}
