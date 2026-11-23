import type { Strategy } from './payment-plan';
import type { ScheduleChange } from './payment-schedule';

/**
 * How interest compounds. Most US cards use a daily periodic rate of APR/365
 * charged every day (daily compounding); some issuers divide by 360 instead,
 * and a few compound once per billing cycle (monthly).
 */
export type Compounding = 'daily365' | 'daily360' | 'monthly';

export const COMPOUNDING_OPTIONS: { value: Compounding; label: string; short: string }[] = [
  { value: 'daily365', label: 'Daily (APR ÷ 365): most common', short: 'Daily/365' },
  { value: 'daily360', label: 'Daily (APR ÷ 360)', short: 'Daily/360' },
  { value: 'monthly', label: 'Monthly (APR ÷ 12)', short: 'Monthly' },
];

/** A promotional rate (e.g. a 0% balance transfer). The account's `apr` is the promotional rate. */
export interface Promotion {
  /** Last month the promotional rate applies, 'YYYY-MM'. */
  endMonth: string;
  /** APR (%) after the promotion ends. */
  aprAfter: number;
  /**
   * Deferred interest: if any of the balance is left when the promotion ends, the
   * interest that would have accrued at `aprAfter` is charged all at once.
   */
  deferred: boolean;
}

/** A single credit card / revolving credit account. */
export interface CreditAccount {
  id: string;
  name: string;
  /** Current balance owed, in dollars (d_i). */
  balance: number;
  /** Current nominal APR, as a percent (e.g. 24.99 for 24.99%). A promotional rate if `promo` is set. */
  apr: number;
  /** Set when `apr` is a promotional rate with an end date. */
  promo?: Promotion | null;
  /** Expected new charges per month, in dollars (0 if not tracked). */
  monthlySpending?: number;
  /** How the APR compounds. */
  compounding: Compounding;
  /** Total line of credit, in dollars. */
  creditLimit: number;
  /** Minimum monthly payment, in dollars. */
  minPayment: number;
  /** Day of month the payment is due (1-31), or null if not tracked. */
  dueDay: number | null;
  /**
   * Fixed categorical color slot (0-7). Color follows the account for its
   * whole life, so deleting or adding another account never repaints it.
   * null when all eight slots are taken (the account is drawn in "Other").
   */
  colorSlot: number | null;
  /** When the account was added (ms since epoch). Sets display order. */
  createdAt: number;
  /** When the account was last added or edited (ms since epoch). Newest wins when syncing. */
  updatedAt: number;
}

/** Fields the user edits; the rest are managed by the store. */
export type AccountDraft = Omit<CreditAccount, 'id' | 'colorSlot' | 'createdAt' | 'updatedAt'>;

/** Records a deletion so an older copy on another device can't bring the account back. */
export interface Tombstone {
  id: string;
  deletedAt: number;
}

/** The payment planner's inputs. Synced as one unit: the most recent change wins. */
export interface PlannerSettings {
  /** Regular monthly amount. */
  budget: number | null;
  strategy: Strategy;
  /** Months with a different amount. */
  changes: ScheduleChange[];
  /** When these settings were last changed (ms since epoch); 0 = never set. */
  updatedAt: number;
}

export const DEFAULT_PLANNER: PlannerSettings = { budget: null, strategy: 'avalanche', changes: [], updatedAt: 0 };

/** Everything that syncs: the file stored in Google Drive, and the local state. */
export interface SyncDoc {
  version: 1;
  accounts: CreditAccount[];
  deleted: Tombstone[];
  /** Missing in files written before planner settings synced. */
  planner?: PlannerSettings;
}

export const EMPTY_DOC: SyncDoc = { version: 1, accounts: [], deleted: [] };
