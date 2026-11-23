import { Injectable, computed, signal } from '@angular/core';
import {
  AccountDraft,
  COMPOUNDING_OPTIONS,
  Compounding,
  CreditAccount,
  DEFAULT_PLANNER,
  PlannerSettings,
  Promotion,
  SyncDoc,
  Tombstone,
} from './account.model';
import { COLOR_SLOTS, normalizeDoc, parsePlanner } from './sync-merge';

const ACCOUNTS_KEY = 'debt-dashboard.accounts.v1';
const DELETED_KEY = 'debt-dashboard.deleted.v1';
const PLANNER_KEY = 'debt-dashboard.planner.v1';
/** Where earlier versions kept the planner settings (browser only). */
const OLD_PLANNER_KEYS = {
  budget: 'debt-dashboard.planner-budget.v1',
  strategy: 'debt-dashboard.planner-strategy.v1',
  changes: 'debt-dashboard.planner-changes.v1',
};
export { COLOR_SLOTS };

/** Holds all accounts and planner settings in signals and persists them to localStorage. */
@Injectable({ providedIn: 'root' })
export class AccountStore {
  private readonly _accounts = signal<CreditAccount[]>(loadAccounts());
  private readonly _deleted = signal<Tombstone[]>(loadDeleted());
  private readonly _planner = signal<PlannerSettings>(loadPlanner());
  private readonly _localEdits = signal(0);

  readonly accounts = this._accounts.asReadonly();
  readonly planner = this._planner.asReadonly();
  readonly isEmpty = computed(() => this._accounts().length === 0);
  /** Goes up by one on every change made in this browser (accounts or planner settings). */
  readonly localEdits = this._localEdits.asReadonly();

  add(draft: AccountDraft): void {
    // Strictly after the newest account, so accounts added in the same
    // millisecond (e.g. the samples) keep the order they were added in.
    const createdAt = Math.max(Date.now(), ...this._accounts().map((a) => a.createdAt + 1));
    this.commit(
      (list) => [
        ...list,
        { ...clean(draft), id: newId(), colorSlot: nextFreeSlot(list), createdAt, updatedAt: createdAt },
      ],
      this._deleted(),
    );
  }

  update(id: string, draft: AccountDraft): void {
    const now = Date.now();
    this.commit(
      (list) => list.map((a) => (a.id === id ? { ...a, ...clean(draft), updatedAt: Math.max(now, a.updatedAt + 1) } : a)),
      this._deleted(),
    );
  }

  remove(id: string): void {
    const target = this._accounts().find((a) => a.id === id);
    const deletedAt = Math.max(Date.now(), (target?.updatedAt ?? 0) + 1);
    this.commit(
      (list) => list.filter((a) => a.id !== id),
      [...this._deleted().filter((t) => t.id !== id), { id, deletedAt }],
    );
  }

  /** Changes planner settings (synced like accounts). */
  setPlanner(patch: Partial<Omit<PlannerSettings, 'updatedAt'>>): void {
    const prev = this._planner();
    this._planner.set({ ...prev, ...patch, updatedAt: Math.max(Date.now(), prev.updatedAt + 1) });
    this.persist();
    this._localEdits.update((n) => n + 1);
  }

  loadSample(): void {
    for (const draft of SAMPLE) this.add(draft);
  }

  /** The current local state, in the format that syncs. */
  toDoc(): SyncDoc {
    const planner = this._planner();
    return {
      version: 1,
      accounts: this._accounts(),
      deleted: this._deleted(),
      ...(planner.updatedAt > 0 ? { planner } : {}),
    };
  }

  /** Replaces local state with data from sync. Not counted as a local edit. */
  applySynced(doc: SyncDoc): void {
    const n = normalizeDoc(doc);
    this._accounts.set(n.accounts);
    this._deleted.set(n.deleted);
    if (n.planner) this._planner.set(n.planner);
    this.persist();
  }

  /** Removes every account, deletion record and planner setting from this browser. */
  clearAll(): void {
    this._accounts.set([]);
    this._deleted.set([]);
    this._planner.set(DEFAULT_PLANNER);
    this.persist();
  }

  private commit(fn: (list: CreditAccount[]) => CreditAccount[], deleted: Tombstone[]): void {
    this._accounts.update(fn);
    this._deleted.set(deleted);
    this.persist();
    this._localEdits.update((n) => n + 1);
  }

  /** Writes to storage immediately (not deferred), so a quick reload can't lose a change. */
  private persist(): void {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(this._accounts()));
      localStorage.setItem(DELETED_KEY, JSON.stringify(this._deleted()));
      localStorage.setItem(PLANNER_KEY, JSON.stringify(this._planner()));
    } catch {
      /* storage full or unavailable: keep working in memory */
    }
  }
}

function nextFreeSlot(list: readonly CreditAccount[]): number | null {
  const used = new Set(list.map((a) => a.colorSlot));
  for (let i = 0; i < COLOR_SLOTS; i++) if (!used.has(i)) return i;
  return null;
}

function clean(d: AccountDraft): AccountDraft {
  return {
    name: d.name.trim(),
    balance: num(d.balance),
    apr: num(d.apr),
    compounding: validCompounding(d.compounding),
    creditLimit: num(d.creditLimit),
    minPayment: num(d.minPayment),
    dueDay: d.dueDay == null || (d.dueDay as unknown) === '' ? null : Math.round(num(d.dueDay)),
    monthlySpending: Math.max(0, num(d.monthlySpending)),
    promo: cleanPromo(d.promo),
  };
}

function cleanPromo(p: AccountDraft['promo']): Promotion | null {
  if (!p || !/^\d{4}-\d{2}$/.test(p.endMonth)) return null;
  return { endMonth: p.endMonth, aprAfter: Math.min(100, Math.max(0, num(p.aprAfter))), deferred: !!p.deferred };
}

function validCompounding(v: unknown): Compounding {
  return COMPOUNDING_OPTIONS.some((o) => o.value === v) ? (v as Compounding) : 'daily365';
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadAccounts(): CreditAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Older saves lack compounding and timestamps. Keep their order with
    // small createdAt values, and updatedAt 0 so any synced edit is newer.
    return parsed.map((a: CreditAccount, i: number) => ({
      ...a,
      compounding: validCompounding(a.compounding),
      createdAt: num(a.createdAt) || i + 1,
      updatedAt: num(a.updatedAt),
    }));
  } catch {
    return [];
  }
}

function loadPlanner(): PlannerSettings {
  try {
    const saved = parsePlanner(JSON.parse(localStorage.getItem(PLANNER_KEY) ?? 'null'));
    if (saved) return saved;
    // Carry over settings from the earlier browser-only storage. They get
    // updatedAt 1, so settings already synced from another device win.
    const budget = Number(localStorage.getItem(OLD_PLANNER_KEYS.budget));
    const strategy = localStorage.getItem(OLD_PLANNER_KEYS.strategy);
    const changes = JSON.parse(localStorage.getItem(OLD_PLANNER_KEYS.changes) ?? '[]');
    const had = Object.values(OLD_PLANNER_KEYS).some((k) => localStorage.getItem(k) != null);
    if (!had) return DEFAULT_PLANNER;
    Object.values(OLD_PLANNER_KEYS).forEach((k) => localStorage.removeItem(k));
    const migrated = parsePlanner({ budget: budget > 0 ? budget : null, strategy, changes, updatedAt: 1 })!;
    localStorage.setItem(PLANNER_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_PLANNER;
  }
}

function loadDeleted(): Tombstone[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SAMPLE: AccountDraft[] = [
  { name: 'Sapphire Visa', balance: 4200, apr: 24.99, compounding: 'daily365', creditLimit: 10000, minPayment: 120, dueDay: 15 },
  { name: 'Freedom Mastercard', balance: 1850, apr: 19.49, compounding: 'daily365', creditLimit: 6000, minPayment: 55, dueDay: 3 },
  { name: 'Store Card', balance: 650, apr: 29.99, compounding: 'daily365', creditLimit: 1500, minPayment: 35, dueDay: 22 },
  { name: 'Credit Union Card', balance: 3100, apr: 12.9, compounding: 'daily365', creditLimit: 8000, minPayment: 75, dueDay: 28 },
];
