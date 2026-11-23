import { CreditAccount, EMPTY_DOC, PlannerSettings, SyncDoc, Tombstone } from './account.model';

export const COLOR_SLOTS = 8;

/**
 * Merges two copies of the data, account by account:
 *  - the version of an account with the newest `updatedAt` wins;
 *  - a deletion wins over any version edited at or before the deletion;
 *    an account edited *after* it was deleted elsewhere is kept;
 *  - the most recently changed planner settings win, as a whole.
 * The result is the same whichever order the arguments come in, so every
 * device converges on the same data.
 */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const deletedAt = new Map<string, number>();
  for (const t of [...a.deleted, ...b.deleted]) {
    deletedAt.set(t.id, Math.max(deletedAt.get(t.id) ?? 0, t.deletedAt));
  }

  const byId = new Map<string, CreditAccount>();
  for (const acc of [...a.accounts, ...b.accounts]) {
    const cur = byId.get(acc.id);
    if (!cur || newer(acc, cur)) byId.set(acc.id, acc);
  }

  const accounts = [...byId.values()].filter((acc) => {
    const d = deletedAt.get(acc.id);
    return d === undefined || acc.updatedAt > d;
  });
  const live = new Set(accounts.map((acc) => acc.id));
  const deleted: Tombstone[] = [...deletedAt]
    .filter(([id]) => !live.has(id))
    .map(([id, at]) => ({ id, deletedAt: at }))
    .sort((x, y) => cmp(x.id, y.id));

  accounts.sort((x, y) => x.createdAt - y.createdAt || cmp(x.id, y.id));
  const planner = newerPlanner(a.planner, b.planner);
  return { version: 1, accounts: dedupeColorSlots(accounts), deleted, ...(planner ? { planner } : {}) };
}

function newerPlanner(x?: PlannerSettings, y?: PlannerSettings): PlannerSettings | undefined {
  if (!x || !y) return x ?? y;
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
  return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
}

/** Puts a doc in canonical order (and fixes clashing colors) without merging anything in. */
export function normalizeDoc(doc: SyncDoc): SyncDoc {
  return mergeDocs(doc, EMPTY_DOC);
}

export function sameDoc(a: SyncDoc, b: SyncDoc): boolean {
  return JSON.stringify(normalizeDoc(a)) === JSON.stringify(normalizeDoc(b));
}

/** Validates a doc read from Drive, filling defaults for missing fields. */
export function parseDoc(raw: unknown): SyncDoc {
  const r = raw as Partial<SyncDoc> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.accounts)) {
    throw new Error('The sync file in Google Drive is not in the expected format.');
  }
  const planner = parsePlanner(r.planner);
  return {
    version: 1,
    accounts: r.accounts.filter((x) => x && typeof x.id === 'string'),
    deleted: Array.isArray(r.deleted) ? r.deleted.filter((t) => t && typeof t.id === 'string') : [],
    ...(planner ? { planner } : {}),
  };
}

/** Validates planner settings from storage or Drive; undefined if unusable. */
export function parsePlanner(raw: unknown): PlannerSettings | undefined {
  const p = raw as Partial<PlannerSettings> | null | undefined;
  if (!p || typeof p !== 'object' || typeof p.updatedAt !== 'number') return undefined;
  const budget = typeof p.budget === 'number' && Number.isFinite(p.budget) && p.budget >= 0 ? p.budget : null;
  const strategy = p.strategy === 'snowball' || p.strategy === 'level' ? p.strategy : 'avalanche';
  const changes = Array.isArray(p.changes)
    ? p.changes.filter(
        (c) => c && typeof c.id === 'string' && (c.kind === 'once' || c.kind === 'from') && /^\d{4}-\d{2}$/.test(c.month),
      )
    : [];
  return { budget, strategy, changes, updatedAt: p.updatedAt };
}

function newer(x: CreditAccount, y: CreditAccount): boolean {
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt;
  // Same timestamp, different content: pick deterministically so devices agree.
  return JSON.stringify(x) > JSON.stringify(y);
}

/**
 * Two devices can each give a new account the same color. The earlier account
 * keeps it; the later one moves to the lowest free slot (or "Other" if none).
 */
function dedupeColorSlots(accounts: CreditAccount[]): CreditAccount[] {
  const used = new Set<number>();
  const clashes: number[] = [];
  accounts.forEach((acc, i) => {
    if (acc.colorSlot == null) return;
    if (used.has(acc.colorSlot)) clashes.push(i);
    else used.add(acc.colorSlot);
  });
  if (!clashes.length) return accounts;
  const out = [...accounts];
  for (const i of clashes) {
    let slot: number | null = null;
    for (let s = 0; s < COLOR_SLOTS; s++) {
      if (!used.has(s)) {
        slot = s;
        break;
      }
    }
    if (slot != null) used.add(slot);
    out[i] = { ...out[i], colorSlot: slot };
  }
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
