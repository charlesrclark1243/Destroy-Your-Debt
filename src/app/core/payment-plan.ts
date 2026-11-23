import { CreditAccount } from './account.model';
import { monthlyRate } from './debt-math';

export type Strategy = 'avalanche' | 'snowball' | 'level';

export const STRATEGIES: { value: Strategy; label: string; description: string }[] = [
  {
    value: 'avalanche',
    label: 'Avalanche',
    description: 'Extra goes to the highest-rate card first.',
  },
  {
    value: 'snowball',
    label: 'Snowball',
    description: 'Extra goes to the smallest balance first, so whole cards get paid off sooner.',
  },
  {
    value: 'level',
    label: 'Level the charges',
    description:
      "Extra goes to the card with the biggest monthly interest charge until it's down to the next card's, then to both, and so on.",
  },
];

/** Stop projecting after 50 years; a budget that slow is reported as never paying off. */
const MAX_MONTHS = 600;
const PAID = 0.005;

export interface PlanRow {
  account: CreditAccount;
  /** Effective monthly rate (decimal). */
  rate: number;
  /** Required minimum, capped at the balance. */
  minimum: number;
  /** This month's payment. */
  payment: number;
  balanceAfter: number;
  /** Next statement's interest on the balance left after this payment. */
  interestAfter: number;
  /** Months from now until this card is paid off, if paying this way every month. */
  payoffMonth: number | null;
}

export interface Projection {
  strategy: Strategy;
  /** Interest paid until every card is paid off. */
  totalInterest: number;
  /** Months until debt-free (or MAX_MONTHS if it never gets there). */
  months: number;
  paysOff: boolean;
  /** The first later month whose amount doesn't cover the minimums; the projection stops there. */
  shortMonth: { month: number; amount: number; minimums: number } | null;
}

/** One month of the projection. `payments` is in the same order as PaymentPlan.rows. */
export interface MonthRow {
  month: number;
  /** The amount set aside for this month. */
  amount: number;
  payments: number[];
  /** Total actually paid (less than `amount` in the final month). */
  paid: number;
  /** Interest added at the end of the month. */
  interest: number;
  /** Total owed after this month's payments (before the interest). */
  owedAfter: number;
}

/** A single amount every month, or one amount per month (the last repeats). */
export type Amounts = number | readonly number[];

export interface PaymentPlan {
  strategy: Strategy;
  rows: PlanRow[];
  /** This month's amount. */
  budget: number;
  totalMinimums: number;
  totalPaid: number;
  /** Budget left after every balance is paid off this month. */
  leftover: number;
  /** How far the budget falls short of the minimums (0 if it covers them). */
  shortfall: number;
  /** Next statement's interest with this month's payments. */
  interest: number;
  /** Paying this way every month; null when this month's amount doesn't cover the minimums. */
  projection: Projection | null;
  /** Month-by-month payments for the selected strategy (empty without a projection). */
  schedule: MonthRow[];
  /** Every strategy projected with the same budget; null when the budget doesn't cover the minimums. */
  comparison: Projection[] | null;
}

interface Card {
  account: CreditAccount;
  index: number;
  rate: number;
  minPayment: number;
}

/**
 * Splits this month's amount across the accounts using `strategy`, and projects
 * paying the given amounts month after month until everything is paid off.
 * Every strategy pays all minimums first; they differ only in where the extra goes.
 */
export function planPayments(
  accounts: readonly CreditAccount[],
  amounts: Amounts,
  strategy: Strategy = 'avalanche',
): PaymentPlan {
  const B = amountFor(amounts, 1);
  const cards = toCards(accounts);
  const balances = cards.map((c) => c.account.balance);
  const minimums = cards.map((c, i) => Math.min(c.minPayment, balances[i]));
  const totalMinimums = sum(minimums);
  const shortfall = Math.max(0, round2(totalMinimums - B));

  const payments = roundToCents(allocate(cards, balances, B, strategy), balances);
  const runs = shortfall > 0 ? null : STRATEGIES.map((s) => simulate(cards, amounts, s.value));
  const run = runs?.find((r) => r.projection.strategy === strategy) ?? null;

  const order = priority(cards, balances, strategy);
  const rows = order.map((i): PlanRow => {
    const balanceAfter = round2(balances[i] - payments[i]);
    return {
      account: cards[i].account,
      rate: cards[i].rate,
      minimum: minimums[i],
      payment: payments[i],
      balanceAfter,
      interestAfter: balanceAfter * cards[i].rate,
      payoffMonth: run?.payoffMonth[i] ?? null,
    };
  });

  const totalPaid = round2(sum(payments));
  return {
    strategy,
    rows,
    budget: B,
    totalMinimums,
    totalPaid,
    leftover: Math.max(0, round2(B - totalPaid)),
    shortfall,
    interest: sum(rows.map((r) => r.interestAfter)),
    projection: run?.projection ?? null,
    schedule: (run?.months ?? []).map((m) => ({ ...m, payments: order.map((i) => m.payments[i]) })),
    comparison: runs?.map((r) => r.projection) ?? null,
  };
}

/** Projects paying `amounts` with `strategy` until everything is paid off. */
export function projectPayoff(accounts: readonly CreditAccount[], amounts: Amounts, strategy: Strategy): Projection {
  return simulate(toCards(accounts), amounts, strategy).projection;
}

/** The amount for month k (1-based); an array's last entry repeats. */
export function amountFor(amounts: Amounts, k: number): number {
  const a = typeof amounts === 'number' ? amounts : (amounts[Math.min(k, amounts.length) - 1] ?? 0);
  return Math.max(0, Number.isFinite(a) ? a : 0);
}

// ---------------------------------------------------------------------------

function toCards(accounts: readonly CreditAccount[]): Card[] {
  return accounts
    .filter((a) => a.balance > 0)
    .map((account, index) => ({
      account,
      index,
      rate: monthlyRate(account),
      minPayment: Math.max(account.minPayment, 0),
    }));
}

function simulate(cards: Card[], amounts: Amounts, strategy: Strategy) {
  let balances = cards.map((c) => c.account.balance);
  const payoffMonth: (number | null)[] = cards.map(() => null);
  const rows: MonthRow[] = [];
  let shortMonth: Projection['shortMonth'] = null;
  let totalInterest = 0;
  let months = 0;

  while (balances.some((b) => b > PAID) && months < MAX_MONTHS) {
    months++;
    const amount = amountFor(amounts, months);
    const minimums = sum(cards.map((c, i) => Math.min(c.minPayment, balances[i])));
    if (amount < minimums - 1e-9) {
      shortMonth = { month: months, amount, minimums };
      break;
    }
    const pay = allocate(cards, balances, amount, strategy);
    const paid = roundToCents(pay, balances);
    let interest = 0;
    let owedAfter = 0;
    balances = balances.map((b, i) => {
      const left = b - pay[i];
      if (left <= PAID) {
        if (payoffMonth[i] == null && b > PAID) payoffMonth[i] = months;
        return 0;
      }
      const charge = left * cards[i].rate;
      interest += charge;
      owedAfter += left;
      return left + charge;
    });
    totalInterest += interest;
    rows.push({ month: months, amount, payments: paid, paid: round2(sum(paid)), interest, owedAfter });
  }

  const paysOff = !shortMonth && balances.every((b) => b <= PAID);
  return {
    projection: { strategy, totalInterest, months, paysOff, shortMonth },
    payoffMonth,
    months: paysOff ? rows : [],
  };
}

/** One month's payments (unrounded), indexed like `cards`. */
function allocate(cards: Card[], balances: number[], budget: number, strategy: Strategy): number[] {
  const minimums = cards.map((c, i) => Math.min(c.minPayment, Math.max(balances[i], 0)));
  const order = priority(cards, balances, strategy);

  // Not enough for every minimum: cover them in the strategy's priority order.
  if (budget < sum(minimums)) {
    const pay = cards.map(() => 0);
    let left = budget;
    for (const i of order) {
      pay[i] = Math.min(minimums[i], left);
      left -= pay[i];
    }
    return pay;
  }

  const pay = [...minimums];
  let left = budget - sum(minimums);

  if (strategy === 'level') {
    const remaining = balances.map((b, i) => Math.max(b - pay[i], 0));
    const extra = levelCharges(remaining, cards.map((c) => c.rate), left);
    extra.forEach((x, i) => (pay[i] += x));
    left -= sum(extra);
  }

  // Avalanche and snowball: fill cards in priority order. For "level", this
  // only places money left after every interest-charging card is paid off.
  for (const i of order) {
    if (left <= 1e-9) break;
    const x = Math.min(balances[i] - pay[i], left);
    if (x > 0) {
      pay[i] += x;
      left -= x;
    }
  }
  return pay;
}

/**
 * Lowers the biggest monthly interest charges (remaining_i × rate_i) to a common
 * level L, spending `amount`: card i gets max(0, remaining_i − L / rate_i).
 * Cards at 0% are left out (they have no charge to lower).
 */
function levelCharges(remaining: number[], rates: number[], amount: number): number[] {
  const charged = remaining.map((r, i) => r > 0 && rates[i] > 0);
  const payable = sum(remaining.filter((_, i) => charged[i]));
  if (amount >= payable) return remaining.map((r, i) => (charged[i] ? r : 0));

  const spend = (L: number) => remaining.map((r, i) => (charged[i] ? Math.max(0, r - L / rates[i]) : 0));
  let lo = 0;
  let hi = Math.max(...remaining.map((r, i) => (charged[i] ? r * rates[i] : 0)));
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (sum(spend(mid)) > amount) lo = mid;
    else hi = mid;
  }
  return spend(hi);
}

/** Order the rows are shown in, and the order extra (or a short budget) is applied. */
function priority(cards: Card[], balances: number[], strategy: Strategy): number[] {
  const idx = cards.map((_, i) => i);
  const byRate = (a: number, b: number) => cards[b].rate - cards[a].rate || cards[a].index - cards[b].index;
  if (strategy === 'snowball') return idx.sort((a, b) => balances[a] - balances[b] || byRate(a, b));
  if (strategy === 'level')
    return idx.sort((a, b) => balances[b] * cards[b].rate - balances[a] * cards[a].rate || byRate(a, b));
  return idx.sort(byRate);
}

/**
 * Rounds payments to cents while keeping their total: floor each, then hand
 * the leftover cents to the largest remainders (never above a balance).
 */
function roundToCents(pay: number[], balances: number[]): number[] {
  const target = Math.round(sum(pay) * 100);
  const cents = pay.map((p) => Math.floor(p * 100 + 1e-6));
  let extra = target - sum(cents);
  const order = pay.map((p, i) => i).sort((a, b) => (pay[b] * 100) % 1 - (pay[a] * 100) % 1);
  for (const i of order) {
    if (extra <= 0) break;
    if (cents[i] + 1 <= Math.round(balances[i] * 100)) {
      cents[i]++;
      extra--;
    }
  }
  return cents.map((c) => c / 100);
}

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
