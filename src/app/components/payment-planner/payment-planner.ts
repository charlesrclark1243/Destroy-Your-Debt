import { Component, computed, inject, input } from '@angular/core';
import { CreditAccount } from '../../core/account.model';
import { AccountStore } from '../../core/account.store';
import { PlanRow, Projection, STRATEGIES, Strategy, planPayments } from '../../core/payment-plan';
import {
  ChangeKind,
  ScheduleChange,
  buildAmounts,
  isVariable,
  monthIndex,
  monthKey,
  monthLabel,
} from '../../core/payment-schedule';
import { fmtApr, fmtUsd } from '../../core/format';

/** How far ahead the month pickers offer. */
const PICKER_MONTHS = 36;

/** Splits a monthly budget across accounts using the chosen payoff strategy. */
@Component({
  selector: 'app-payment-planner',
  templateUrl: './payment-planner.html',
  styleUrl: './payment-planner.css',
})
export class PaymentPlanner {
  readonly accounts = input.required<CreditAccount[]>();

  protected readonly strategies = STRATEGIES;
  private readonly store = inject(AccountStore);
  // Settings live in the store, so they're saved and synced with the accounts.
  protected readonly budget = computed(() => this.store.planner().budget);
  protected readonly strategy = computed(() => this.store.planner().strategy);
  protected readonly changes = computed(() => this.store.planner().changes);

  /** The amount for each month (the last repeats). */
  protected readonly amounts = computed(() => buildAmounts(this.budget() ?? 0, this.changes()));
  protected readonly variable = computed(() => isVariable(this.amounts()));

  protected readonly monthOptions = Array.from({ length: PICKER_MONTHS }, (_, i) => ({
    key: monthKey(i + 1),
    label: monthLabel(i + 1),
  }));

  protected readonly totalMinimums = computed(() =>
    this.accounts().reduce((s, a) => s + Math.min(Math.max(a.minPayment, 0), Math.max(a.balance, 0)), 0),
  );

  protected readonly plan = computed(() => {
    const b = this.budget();
    if (b == null || !(b > 0) || !this.accounts().some((a) => a.balance > 0)) return null;
    return planPayments(this.accounts(), this.amounts(), this.strategy());
  });

  /** The lowest total interest (in cents) among strategies that pay everything off. */
  protected readonly cheapest = computed(() => {
    const c = this.plan()?.comparison?.filter((p) => p.paysOff);
    return c?.length ? Math.min(...c.map((p) => cents(p.totalInterest))) : null;
  });

  protected readonly selectedInfo = computed(() => STRATEGIES.find((s) => s.value === this.strategy())!);

  protected readonly fmtUsd = fmtUsd;
  protected readonly fmtApr = fmtApr;

  protected onBudget(value: string): void {
    const n = value === '' ? null : Number(value);
    const b = n == null || !Number.isFinite(n) || n < 0 ? null : n;
    this.store.setPlanner({ budget: b });
  }

  protected addChange(): void {
    const last = this.changes().at(-1);
    const next = last ? Math.max(monthIndex(last.month) + 1, 2) : 2;
    this.saveChanges([
      ...this.changes(),
      { id: newId(), kind: 'once', month: monthKey(Math.min(next, PICKER_MONTHS)), amount: null },
    ]);
  }

  protected updateChange(id: string, patch: { kind?: string; month?: string; amount?: string }): void {
    this.saveChanges(
      this.changes().map((c) => {
        if (c.id !== id) return c;
        const n = patch.amount === undefined ? c.amount : patch.amount === '' ? null : Number(patch.amount);
        return {
          ...c,
          kind: (patch.kind as ChangeKind) ?? c.kind,
          month: patch.month ?? c.month,
          amount: n == null || !Number.isFinite(n) || n < 0 ? null : n,
        };
      }),
    );
  }

  protected removeChange(id: string): void {
    this.saveChanges(this.changes().filter((c) => c.id !== id));
  }

  /** Options for a change's month picker, including its own month if it has slipped into the past. */
  protected optionsFor(c: ScheduleChange): { key: string; label: string }[] {
    if (this.monthOptions.some((o) => o.key === c.month)) return this.monthOptions;
    const k = monthIndex(c.month);
    return [{ key: c.month, label: `${monthLabel(k)} (past)` }, ...this.monthOptions];
  }

  protected isPast(c: ScheduleChange): boolean {
    return c.kind === 'once' && monthIndex(c.month) < 1;
  }

  private saveChanges(list: ScheduleChange[]): void {
    this.store.setPlanner({ changes: list });
  }

  protected setStrategy(s: Strategy): void {
    this.store.setPlanner({ strategy: s });
  }

  protected label(s: Strategy): string {
    return STRATEGIES.find((x) => x.value === s)!.label;
  }

  /** Extra cost versus the cheapest strategy (0 for the cheapest itself). */
  protected extraCost(p: Projection): number | null {
    const best = this.cheapest();
    // From the rounded totals, so the difference matches the amounts shown.
    return best == null || !p.paysOff ? null : (cents(p.totalInterest) - best) / 100;
  }

  protected isCheapest(p: Projection): boolean {
    return this.extraCost(p) === 0;
  }

  /** "Jun 2027" for month k (1 = this month's payment). */
  protected monthName(k: number): string {
    return monthLabel(k);
  }

  protected duration(months: number): string {
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const y = Math.floor(months / 12);
    const m = months % 12;
    return `${y} ${y === 1 ? 'year' : 'years'}${m ? `, ${m} ${m === 1 ? 'month' : 'months'}` : ''}`;
  }

  protected sum(rows: PlanRow[], field: 'balance' | 'balanceAfter'): number {
    return rows.reduce((s, r) => s + (field === 'balance' ? r.account.balance : r.balanceAfter), 0);
  }

  protected color(a: CreditAccount): string {
    return a.colorSlot == null ? 'var(--series-other)' : `var(--series-${a.colorSlot + 1})`;
  }
}

function cents(n: number): number {
  return Math.round(n * 100);
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
