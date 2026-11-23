import { CreditAccount } from './account.model';
import { effectiveAnnualRate } from './debt-math';
import { monthIndex } from './payment-schedule';

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
  /** Effective monthly rate this month (decimal). */
  rate: number;
  /** Required minimum, capped at the balance. */
  minimum: number;
  /** This month's payment. */
  payment: number;
  balanceAfter: number;
  /** Next statement's interest: on the balance left after this payment, plus this month's new charges. */
  interestAfter: number;
  /** Expected new charges per month. */
  spending: number;
  /** Months from now until this card's balance is paid off, if following the plan. */
  payoffMonth: number | null;
}

/** Deferred interest charged because a promotion ended with a balance left. */
export interface DeferredCharge {
  account: CreditAccount;
  month: number;
  amount: number;
}

export interface Projection {
  strategy: Strategy;
  /** Interest paid until no card carries a balance. */
  totalInterest: number;
  /** Months until debt-free (or MAX_MONTHS if it never gets there). */
  months: number;
  paysOff: boolean;
  /** The first later month whose amount doesn't cover the minimums; the projection stops there. */
  shortMonth: { month: number; amount: number; minimums: number } | null;
  /** Deferred interest charged along the way (empty if every deferred promotion is cleared in time). */
  deferredCharges: DeferredCharge[];
}

/** One month of the projection. `payments` is in the same order as PaymentPlan.rows. */
export interface MonthRow {
  month: number;
  /** The amount set aside for this month. */
  amount: number;
  payments: number[];
  /** Total actually paid (less than `amount` in the final month). */
  paid: number;
  /** Interest added at the end of the month (including any deferred interest). */
  interest: number;
  /** New charges added during the month. */
  charges: number;
  /** Total balance carried after this month's payments (before new charges and interest). */
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
  /** Expected new charges per month, across all cards. */
  spending: number;
  /** Following the plan; null when this month's amount doesn't cover the minimums. */
  projection: Projection | null;
  /** Month-by-month payments for the selected strategy (empty without a projection). */
  schedule: MonthRow[];
  /** Every strategy projected with the same amounts; null when this month's amount doesn't cover the minimums. */
  comparison: Projection[] | null;
}

interface Card {
  account: CreditAccount;
  index: number;
  minPayment: number;
  spending: number;
  /** Effective monthly rate in month k (1 = this month). */
  rateAt: (k: number) => number;
  /** Deferred-interest promotion: last promotional month and the monthly rate afterwards. */
  deferred: { endIdx: number; rateAfter: number } | null;
}

/** Where the projection stands at the start of a month. */
interface State {
  balances: number[];
  /** Paid in full last month, so new charges don't accrue interest. */
  grace: boolean[];
  /** Deferred interest building up during a deferred-interest promotion. */
  accrued: number[];
}

/**
 * Splits this month's amount across the accounts using `strategy`, and projects
 * following the plan month after month until no card carries a balance.
 *
 * Each month, in order: pay every minimum; pay new charges in full on cards
 * already paid off (so they stay interest-free); set aside enough for each
 * deferred-interest promotion to be cleared by its end date; then the strategy
 * decides where the rest goes. Promotional rates switch to the later rate after
 * their end month, and new charges are added to each card every month.
 */
export function planPayments(
  accounts: readonly CreditAccount[],
  amounts: Amounts,
  strategy: Strategy = 'avalanche',
): PaymentPlan {
  const B = amountFor(amounts, 1);
  const cards = toCards(accounts);
  const start = initialState(cards);
  const minimums = cards.map((c, i) => minimumFor(c, start.balances[i]));
  const totalMinimums = sum(minimums);
  const shortfall = Math.max(0, round2(totalMinimums - B));

  const payments = roundToCents(allocate(cards, start, B, strategy, 1), start.balances);
  const first = step(cards, start, payments, 1);
  const runs = shortfall > 0 ? null : STRATEGIES.map((s) => simulate(cards, amounts, s.value));
  const run = runs?.find((r) => r.projection.strategy === strategy) ?? null;

  const order = priority(cards, start.balances, strategy, 1);
  const rows = order.map(
    (i): PlanRow => ({
      account: cards[i].account,
      rate: cards[i].rateAt(1),
      minimum: minimums[i],
      payment: payments[i],
      balanceAfter: round2(first.left[i]),
      interestAfter: first.interest[i],
      spending: cards[i].spending,
      payoffMonth: run?.payoffMonth[i] ?? null,
    }),
  );

  const totalPaid = round2(sum(payments));
  return {
    strategy,
    rows,
    budget: B,
    totalMinimums,
    totalPaid,
    leftover: Math.max(0, round2(B - totalPaid)),
    shortfall,
    interest: sum(first.interest),
    spending: sum(cards.map((c) => c.spending)),
    projection: run?.projection ?? null,
    schedule: (run?.months ?? []).map((m) => ({ ...m, payments: order.map((i) => m.payments[i]) })),
    comparison: runs?.map((r) => r.projection) ?? null,
  };
}

/** Projects following `strategy` with `amounts` until no card carries a balance. */
export function projectPayoff(accounts: readonly CreditAccount[], amounts: Amounts, strategy: Strategy): Projection {
  return simulate(toCards(accounts), amounts, strategy).projection;
}

/** The amount for month k (1-based); an array's last entry repeats. */
export function amountFor(amounts: Amounts, k: number): number {
  const a = typeof amounts === 'number' ? amounts : (amounts[Math.min(k, amounts.length) - 1] ?? 0);
  return Math.max(0, Number.isFinite(a) ? a : 0);
}

/** Effective monthly rate (decimal) for an APR in percent. */
function monthly(apr: number, compounding: CreditAccount['compounding']): number {
  return Math.pow(1 + effectiveAnnualRate(apr, compounding), 1 / 12) - 1;
}

// ---------------------------------------------------------------------------

function toCards(accounts: readonly CreditAccount[], now = new Date()): Card[] {
  return accounts
    .filter((a) => a.balance > 0 || spendingOf(a) > 0)
    .map((account, index): Card => {
      const current = monthly(account.apr, account.compounding);
      const base = { account, index, minPayment: Math.max(account.minPayment, 0), spending: spendingOf(account) };
      const promo = account.promo;
      if (!promo) return { ...base, rateAt: () => current, deferred: null };
      const endIdx = monthIndex(promo.endMonth, now);
      const after = monthly(promo.aprAfter, account.compounding);
      return {
        ...base,
        rateAt: (k) => (k <= endIdx ? current : after),
        deferred: promo.deferred && endIdx >= 1 ? { endIdx, rateAfter: after } : null,
      };
    });
}

function spendingOf(a: CreditAccount): number {
  const s = Number(a.monthlySpending ?? 0);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

function initialState(cards: Card[]): State {
  const balances = cards.map((c) => Math.max(c.account.balance, 0));
  return { balances, grace: balances.map((b) => b <= PAID), accrued: cards.map(() => 0) };
}

function minimumFor(card: Card, balance: number): number {
  return balance > PAID ? Math.min(card.minPayment, balance) : 0;
}

function simulate(cards: Card[], amounts: Amounts, strategy: Strategy) {
  let state = initialState(cards);
  const payoffMonth: (number | null)[] = cards.map(() => null);
  const rows: MonthRow[] = [];
  const deferredCharges: DeferredCharge[] = [];
  let shortMonth: Projection['shortMonth'] = null;
  let totalInterest = 0;
  let months = 0;
  let debtFree = false;

  while (months < MAX_MONTHS) {
    months++;
    const amount = amountFor(amounts, months);
    const minimums = sum(cards.map((c, i) => minimumFor(c, state.balances[i])));
    if (amount < minimums - 1e-9) {
      shortMonth = { month: months, amount, minimums };
      break;
    }
    const pay = allocate(cards, state, amount, strategy, months);
    const paid = roundToCents(pay, state.balances);
    const result = step(cards, state, pay, months);

    result.left.forEach((l, i) => {
      if (l <= PAID && state.balances[i] > PAID && !state.grace[i] && payoffMonth[i] == null) payoffMonth[i] = months;
    });
    result.deferredHit.forEach((amt, i) => {
      if (amt > 0) deferredCharges.push({ account: cards[i].account, month: months, amount: amt });
    });
    const interest = sum(result.interest);
    totalInterest += interest;
    rows.push({
      month: months,
      amount,
      payments: paid,
      paid: round2(sum(paid)),
      interest,
      charges: sum(cards.map((c) => c.spending)),
      owedAfter: sum(result.left),
    });
    state = result.next;
    if (result.left.every((l) => l <= PAID)) {
      debtFree = true;
      break;
    }
  }

  const paysOff = !shortMonth && debtFree;
  return {
    projection: { strategy, totalInterest, months, paysOff, shortMonth, deferredCharges },
    payoffMonth,
    months: paysOff ? rows : [],
  };
}

/** Applies one month's payments: what's left, the interest charged, and the next month's state. */
function step(cards: Card[], state: State, pay: number[], k: number) {
  const left: number[] = [];
  const interest: number[] = [];
  const deferredHit: number[] = [];
  const next: State = { balances: [], grace: [], accrued: [] };

  cards.forEach((card, i) => {
    const remaining = state.balances[i] - pay[i];
    if (remaining <= PAID) {
      // Paid in full: this month's new charges are interest-free, and any deferred interest is waived.
      left.push(0);
      interest.push(0);
      deferredHit.push(0);
      next.balances.push(card.spending);
      next.grace.push(true);
      next.accrued.push(0);
      return;
    }
    // Carrying a balance: new charges accrue interest from mid-month (no grace period).
    const rate = card.rateAt(k);
    const average = remaining + card.spending / 2;
    let charge = average * rate;
    let accrued = state.accrued[i];
    let hit = 0;
    const d = card.deferred;
    if (d && k <= d.endIdx) {
      accrued += average * Math.max(d.rateAfter - rate, 0);
      if (k === d.endIdx) {
        hit = accrued;
        charge += accrued;
        accrued = 0;
      }
    }
    left.push(remaining);
    interest.push(charge);
    deferredHit.push(hit);
    next.balances.push(remaining + card.spending + charge);
    next.grace.push(false);
    next.accrued.push(accrued);
  });
  return { left, interest, deferredHit, next };
}

/** One month's payments (unrounded), indexed like `cards`. */
function allocate(cards: Card[], state: State, budget: number, strategy: Strategy, k: number): number[] {
  const balances = state.balances;
  const minimums = cards.map((c, i) => minimumFor(c, balances[i]));
  const order = priority(cards, balances, strategy, k);

  // Not enough for every minimum: cover them in the strategy's priority order.
  if (budget < sum(minimums) - 1e-9) {
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
  /** Raise card i's payment toward `target`, within its balance and what's left. */
  const give = (i: number, target: number) => {
    const x = Math.min(target - pay[i], balances[i] - pay[i], left);
    if (x > 0) {
      pay[i] += x;
      left -= x;
    }
  };

  // 1. Cards already paid off: pay their new charges in full so they stay interest-free.
  for (const i of byRate(cards, k)) if (state.grace[i]) give(i, balances[i]);

  // 2. Deferred-interest promotions: enough each month to clear the balance by the end date.
  const deferredSoonestFirst = cards
    .map((c, i) => i)
    .filter((i) => cards[i].deferred && k <= cards[i].deferred!.endIdx && balances[i] > PAID)
    .sort((a, b) => cards[a].deferred!.endIdx - cards[b].deferred!.endIdx);
  for (const i of deferredSoonestFirst) give(i, balances[i] / (cards[i].deferred!.endIdx - k + 1));

  // 3. The strategy places the rest.
  if (strategy === 'level') {
    const remaining = balances.map((b, i) => Math.max(b - pay[i], 0));
    const extra = levelCharges(remaining, cards.map((c) => c.rateAt(k)), left);
    extra.forEach((x, i) => (pay[i] += x));
    left -= sum(extra);
  }
  // Avalanche and snowball: fill cards in priority order. For "level", this
  // only places money left after every interest-charging card is paid off.
  for (const i of order) {
    if (left <= 1e-9) break;
    give(i, balances[i]);
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
  for (let n = 0; n < 100; n++) {
    const mid = (lo + hi) / 2;
    if (sum(spend(mid)) > amount) lo = mid;
    else hi = mid;
  }
  return spend(hi);
}

function byRate(cards: Card[], k: number): number[] {
  return cards
    .map((_, i) => i)
    .sort((a, b) => cards[b].rateAt(k) - cards[a].rateAt(k) || cards[a].index - cards[b].index);
}

/** Order the rows are shown in, and the order extra (or a short budget) is applied. */
function priority(cards: Card[], balances: number[], strategy: Strategy, k: number): number[] {
  const idx = cards.map((_, i) => i);
  const rate = (i: number) => cards[i].rateAt(k);
  const byRateThenIndex = (a: number, b: number) => rate(b) - rate(a) || cards[a].index - cards[b].index;
  if (strategy === 'snowball') return idx.sort((a, b) => balances[a] - balances[b] || byRateThenIndex(a, b));
  if (strategy === 'level') return idx.sort((a, b) => balances[b] * rate(b) - balances[a] * rate(a) || byRateThenIndex(a, b));
  return idx.sort(byRateThenIndex);
}

/**
 * Rounds payments to cents while keeping their total: floor each, then hand
 * the leftover cents to the largest remainders (never above a balance).
 */
function roundToCents(pay: number[], balances: number[]): number[] {
  const target = Math.round(sum(pay) * 100);
  const cents = pay.map((p) => Math.floor(p * 100 + 1e-6));
  let extra = target - sum(cents);
  const order = pay.map((p, i) => i).sort((a, b) => ((pay[b] * 100) % 1) - ((pay[a] * 100) % 1));
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
