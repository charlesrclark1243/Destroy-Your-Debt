import { CreditAccount, EMPTY_DOC, PlannerSettings, SyncDoc } from './account.model';
import { mergeDocs, parseDoc, sameDoc } from './sync-merge';

function acc(id: string, updatedAt: number, extra: Partial<CreditAccount> = {}): CreditAccount {
  return {
    id,
    name: id,
    balance: 100,
    apr: 20,
    compounding: 'daily365',
    creditLimit: 1000,
    minPayment: 0,
    dueDay: null,
    colorSlot: null,
    createdAt: 1,
    updatedAt,
    ...extra,
  };
}
const doc = (accounts: CreditAccount[], deleted: SyncDoc['deleted'] = []): SyncDoc => ({ version: 1, accounts, deleted });

describe('mergeDocs', () => {
  it('unions accounts that exist on only one side', () => {
    const m = mergeDocs(doc([acc('a', 1)]), doc([acc('b', 1)]));
    expect(m.accounts.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('keeps the newest edit of the same account', () => {
    const m = mergeDocs(doc([acc('a', 5, { balance: 500 })]), doc([acc('a', 9, { balance: 900 })]));
    expect(m.accounts[0].balance).toBe(900);
  });

  it('keeps edits to different accounts from different devices', () => {
    const base = [acc('a', 1, { balance: 1 }), acc('b', 1, { balance: 1 })];
    const laptop = doc([{ ...base[0], balance: 111, updatedAt: 10 }, base[1]]);
    const phone = doc([base[0], { ...base[1], balance: 222, updatedAt: 11 }]);
    const m = mergeDocs(laptop, phone);
    expect(m.accounts.map((a) => a.balance)).toEqual([111, 222]);
  });

  it('does not bring back an account deleted on another device', () => {
    const m = mergeDocs(doc([acc('a', 5)]), doc([], [{ id: 'a', deletedAt: 6 }]));
    expect(m.accounts).toEqual([]);
    expect(m.deleted).toEqual([{ id: 'a', deletedAt: 6 }]);
  });

  it('keeps an account edited after it was deleted elsewhere', () => {
    const m = mergeDocs(doc([acc('a', 8)]), doc([], [{ id: 'a', deletedAt: 6 }]));
    expect(m.accounts.map((a) => a.id)).toEqual(['a']);
    expect(m.deleted).toEqual([]);
  });

  it('gives the same result in either order (devices converge)', () => {
    const x = doc([acc('a', 3, { balance: 1 }), acc('b', 2)], [{ id: 'c', deletedAt: 4 }]);
    const y = doc([acc('a', 3, { balance: 2 }), acc('c', 3)], []);
    expect(JSON.stringify(mergeDocs(x, y))).toBe(JSON.stringify(mergeDocs(y, x)));
  });

  it('orders accounts by when they were added', () => {
    const m = mergeDocs(doc([acc('late', 1, { createdAt: 50 })]), doc([acc('early', 1, { createdAt: 10 })]));
    expect(m.accounts.map((a) => a.id)).toEqual(['early', 'late']);
  });

  it('gives a new color to the later of two accounts that picked the same one', () => {
    const m = mergeDocs(
      doc([acc('a', 1, { colorSlot: 0, createdAt: 1 }), acc('x', 1, { colorSlot: 4, createdAt: 2 })]),
      doc([acc('y', 1, { colorSlot: 4, createdAt: 3 })]),
    );
    expect(m.accounts.map((a) => a.colorSlot)).toEqual([0, 4, 1]);
  });

  it('is a no-op against an empty doc for already-normal data', () => {
    const d = doc([acc('a', 1, { colorSlot: 0 })]);
    expect(sameDoc(mergeDocs(d, EMPTY_DOC), d)).toBe(true);
  });
});

describe('planner settings in sync', () => {
  const planner = (budget: number, updatedAt: number): PlannerSettings => ({
    budget,
    strategy: 'snowball',
    changes: [{ id: 'c1', kind: 'once', month: '2027-02', amount: 1500 }],
    updatedAt,
  });

  it('keeps the most recently changed settings, in either order', () => {
    const a = { ...doc([]), planner: planner(400, 10) };
    const b = { ...doc([]), planner: planner(700, 20) };
    expect(mergeDocs(a, b).planner!.budget).toBe(700);
    expect(mergeDocs(b, a).planner!.budget).toBe(700);
  });

  it('keeps settings when only one side has them (e.g. a file from before they synced)', () => {
    expect(mergeDocs(doc([]), { ...doc([]), planner: planner(400, 10) }).planner!.budget).toBe(400);
    expect(mergeDocs(doc([]), doc([])).planner).toBeUndefined();
  });

  it('reads settings from a Drive file and drops malformed changes', () => {
    const raw = {
      accounts: [],
      planner: { ...planner(400, 5), changes: [{ id: 'ok', kind: 'from', month: '2027-01', amount: 600 }, { id: 'bad', kind: 'x', month: 'soon' }] },
    };
    const parsed = parseDoc(raw);
    expect(parsed.planner!.changes.map((c) => c.id)).toEqual(['ok']);
    expect(parsed.planner!.strategy).toBe('snowball');
  });
});

describe('parseDoc', () => {
  it('rejects files that are not sync docs', () => {
    expect(() => parseDoc(null)).toThrow();
    expect(() => parseDoc({ hello: 1 })).toThrow();
  });
  it('fills in a missing deleted list', () => {
    expect(parseDoc({ accounts: [] })).toEqual(EMPTY_DOC);
  });
});
