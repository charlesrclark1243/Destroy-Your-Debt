/**
 * Monthly payment schedules: a regular amount plus changes for particular months.
 *
 * Months are numbered from the current calendar month: month 1 is this month's
 * payment, month 2 next month's, and so on. Changes are stored by calendar month
 * ('YYYY-MM') so they stay put as time passes.
 */

export type ChangeKind = 'once' | 'from';

export interface ScheduleChange {
  id: string;
  /** 'once': pay `amount` in that month only. 'from': pay `amount` every month from then on. */
  kind: ChangeKind;
  /** Calendar month, 'YYYY-MM'. */
  month: string;
  amount: number | null;
}

/** 'YYYY-MM' for month k (1 = the current calendar month). */
export function monthKey(k: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() + k - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Month number for a 'YYYY-MM' key (1 = the current calendar month; ≤ 0 is in the past). */
export function monthIndex(key: string, now = new Date()): number {
  const [y, m] = key.split('-').map(Number);
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + 1;
}

/** "Jun 2027" for month k. */
export function monthLabel(k: number, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth() + k - 1, 1).toLocaleDateString([], {
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The amount for each month, as an array whose last entry repeats forever.
 * "From" changes apply from their month on (a later one replaces an earlier one);
 * a "once" change replaces the amount for its month only. A "from" change dated
 * in the past applies from this month; a "once" change in the past is ignored.
 */
export function buildAmounts(base: number, changes: readonly ScheduleChange[], now = new Date()): number[] {
  const valid = changes
    .filter((c) => c.amount != null && Number.isFinite(c.amount) && c.amount >= 0)
    .map((c) => ({ ...c, k: monthIndex(c.month, now), amount: c.amount as number }));

  const froms = valid.filter((c) => c.kind === 'from').map((c) => ({ ...c, k: Math.max(c.k, 1) }));
  const onces = valid.filter((c) => c.kind === 'once' && c.k >= 1);

  // One month past the last change, so the final entry is the amount that repeats.
  const horizon = Math.max(1, ...froms.map((c) => c.k), ...onces.map((c) => c.k + 1));
  const amounts: number[] = [];
  for (let k = 1; k <= horizon; k++) {
    let amount = base;
    // The latest "from" change at or before month k wins (later in the list breaks ties).
    let latest = -Infinity;
    for (const c of froms) {
      if (c.k <= k && c.k >= latest) {
        amount = c.amount;
        latest = c.k;
      }
    }
    const once = onces.filter((c) => c.k === k).pop();
    amounts.push(once ? once.amount : amount);
  }
  return amounts;
}

/** True if the schedule ever differs from paying `base` every month. */
export function isVariable(amounts: readonly number[]): boolean {
  return amounts.some((a) => a !== amounts[0]);
}
