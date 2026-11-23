import { Component, computed, inject, signal } from '@angular/core';
import { AccountDraft, COMPOUNDING_OPTIONS, CreditAccount } from './core/account.model';
import { AccountStore } from './core/account.store';
import {
  debtShares,
  effectiveAnnualRate,
  estimatedMonthlyInterest,
  interestShares,
  totalDebt,
  utilization,
  weightedAverageApr,
} from './core/debt-math';
import { fmtApr, fmtPct, fmtUsd, fmtUsd0 } from './core/format';
import { DonutChart } from './components/donut-chart/donut-chart';
import { AccountForm } from './components/account-form/account-form';
import { ConfirmDialog } from './components/confirm-dialog/confirm-dialog';
import { SyncStatus } from './components/sync-status/sync-status';
import { PaymentPlanner } from './components/payment-planner/payment-planner';

type EditorState = { mode: 'add' } | { mode: 'edit'; account: CreditAccount } | null;

@Component({
  selector: 'app-root',
  imports: [DonutChart, AccountForm, ConfirmDialog, SyncStatus, PaymentPlanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(AccountStore);
  protected readonly accounts = this.store.accounts;

  protected readonly editor = signal<EditorState>(null);
  protected readonly pendingDelete = signal<CreditAccount | null>(null);

  protected readonly total = computed(() => totalDebt(this.accounts()));
  protected readonly totalLimit = computed(() => this.accounts().reduce((s, a) => s + a.creditLimit, 0));
  protected readonly totalMin = computed(() => this.accounts().reduce((s, a) => s + a.minPayment, 0));
  protected readonly util = computed(() => utilization(this.accounts()));
  protected readonly avgApr = computed(() => weightedAverageApr(this.accounts()));
  protected readonly monthlyInterest = computed(() => estimatedMonthlyInterest(this.accounts()));

  protected readonly plainShares = computed(() => debtShares(this.accounts()));
  /** Share of next statement's interest, a measure of interest cost, not debt. */
  protected readonly interest = computed(() => interestShares(this.accounts()));

  /** Per-account share lookups for the table. */
  protected readonly shareById = computed(() => new Map(this.plainShares().map((r) => [r.id, r.share])));
  /** Accounts carrying a balance at 0% APR: no interest, so not in the interest chart. */
  protected readonly zeroAprNames = computed(() =>
    this.accounts()
      .filter((a) => a.balance > 0 && a.apr <= 0)
      .map((a) => a.name)
      .join(', '),
  );
  protected readonly interestShareById = computed(() => new Map(this.interest().map((r) => [r.id, r.share])));

  protected readonly fmtUsd = fmtUsd;
  protected readonly fmtUsd0 = fmtUsd0;
  protected readonly fmtPct = fmtPct;
  protected readonly fmtApr = fmtApr;

  protected openAdd(): void {
    this.editor.set({ mode: 'add' });
  }

  protected openEdit(account: CreditAccount): void {
    this.editor.set({ mode: 'edit', account });
  }

  protected save(draft: AccountDraft): void {
    const e = this.editor();
    if (!e) return;
    if (e.mode === 'add') this.store.add(draft);
    else this.store.update(e.account.id, draft);
  }

  protected confirmDelete(): void {
    const a = this.pendingDelete();
    if (a) this.store.remove(a.id);
  }

  protected ear(a: CreditAccount): number {
    return effectiveAnnualRate(a.apr, a.compounding);
  }

  protected compoundingShort(a: CreditAccount): string {
    return COMPOUNDING_OPTIONS.find((o) => o.value === a.compounding)?.short ?? '';
  }

  protected rowUtil(a: CreditAccount): number {
    return a.creditLimit > 0 ? a.balance / a.creditLimit : 0;
  }

  protected color(a: CreditAccount): string {
    return a.colorSlot == null ? 'var(--series-other)' : `var(--series-${a.colorSlot + 1})`;
  }
}
