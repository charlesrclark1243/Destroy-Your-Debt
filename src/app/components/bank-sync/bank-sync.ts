import { Component, computed, inject, signal } from '@angular/core';
import { AccountStore } from '../../core/account.store';
import { BankSync } from '../../core/bank-sync.service';
import { BankAccount, accountKind, bankLabel, buildUpdates, guessPositive, owedFrom, suggestLinks } from '../../core/bank-match';
import { fmtUsd } from '../../core/format';

interface Choice {
  cardId: string | null;
  positive: boolean;
}

/** "Bank sync" panel: pair with the local Destroy Your Debt server, match bank accounts to cards, apply balances. */
@Component({
  selector: 'app-bank-sync',
  templateUrl: './bank-sync.html',
  styleUrl: './bank-sync.css',
})
export class BankSyncPanel {
  protected readonly bank = inject(BankSync);
  private readonly store = inject(AccountStore);
  protected readonly cards = this.store.accounts;

  protected readonly code = signal('');
  /** Choices the user changed in the review table; the rest come from links and suggestions. */
  private readonly overrides = signal(new Map<string, Choice>());
  protected readonly applied = signal<string | null>(null);

  protected readonly showOthers = signal(false);

  /** The effective choice for each bank account: the user's change, else the existing link or a suggestion. */
  protected readonly choices = computed(() => {
    const accounts = this.bank.accounts() ?? [];
    const suggested = suggestLinks(accounts, this.cards());
    const map = new Map<string, Choice>();
    for (const a of accounts) {
      const override = this.overrides().get(a.id);
      if (override) {
        map.set(a.id, override);
        continue;
      }
      const linked = this.cards().find((c) => c.bank?.accountId === a.id);
      map.set(a.id, { cardId: suggested.get(a.id) ?? null, positive: linked?.bank ? linked.bank.positive : guessPositive(a.balance) });
    }
    return map;
  });

  /** Linked accounts and likely cards are shown; investment, checking and savings accounts are tucked away. */
  protected readonly rows = computed(() => {
    const accounts = this.bank.accounts() ?? [];
    const rank = (a: BankAccount) => (this.choices().get(a.id)?.cardId ? 0 : accountKind(a) === 'other' ? 2 : 1);
    const sorted = [...accounts].sort((x, y) => rank(x) - rank(y));
    return { main: sorted.filter((a) => rank(a) < 2), others: sorted.filter((a) => rank(a) === 2) };
  });

  /** Card-like accounts with nothing linked: usually a card that hasn't been added to the dashboard yet. */
  protected readonly unlinkedCards = computed(() =>
    this.rows().main.filter((a) => !this.choices().get(a.id)?.cardId && accountKind(a) === 'card'),
  );

  protected readonly updates = computed(() => buildUpdates(this.bank.accounts() ?? [], this.cards(), this.choices()));
  protected readonly changed = computed(() => this.updates().filter((u) => Math.abs(u.newBalance - u.oldBalance) >= 0.005 || !u.card.bank));

  protected readonly fmtUsd = fmtUsd;
  protected readonly label = bankLabel;

  protected async pair(): Promise<void> {
    if (await this.bank.pair(this.code())) {
      this.code.set('');
      await this.bank.fetchAccounts();
    }
  }

  protected async update(refresh: boolean): Promise<void> {
    this.applied.set(null);
    await this.bank.fetchAccounts(refresh);
  }

  protected choose(a: BankAccount, cardId: string): void {
    const current = this.choices().get(a.id)!;
    this.setChoice(a.id, { ...current, cardId: cardId || null });
  }

  protected flip(a: BankAccount): void {
    const current = this.choices().get(a.id)!;
    this.setChoice(a.id, { ...current, positive: !current.positive });
  }

  protected owed(a: BankAccount): number {
    return owedFrom(a.balance, this.choices().get(a.id)?.positive ?? false);
  }

  /** A card already chosen by another bank account can't be picked again. */
  protected takenByOther(a: BankAccount, cardId: string): boolean {
    for (const [id, c] of this.choices()) if (id !== a.id && c.cardId === cardId) return true;
    return false;
  }

  protected apply(): void {
    const updates = this.updates();
    this.store.applyBankBalances(updates.map((u) => ({ id: u.card.id, balance: u.newBalance, bank: u.link })));
    this.overrides.set(new Map());
    this.applied.set(`Updated ${updates.length} ${updates.length === 1 ? 'card' : 'cards'} from the bank.`);
  }

  protected time(ms: number | null): string {
    return ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }

  protected date(ms: number | null): string {
    return ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  }

  private setChoice(id: string, choice: Choice): void {
    const next = new Map(this.overrides());
    // Keep the other rows' current effective choices so suggestions don't shift under the user.
    for (const [otherId, c] of this.choices()) if (!next.has(otherId) && otherId !== id) next.set(otherId, c);
    next.set(id, choice);
    this.overrides.set(next);
  }
}
