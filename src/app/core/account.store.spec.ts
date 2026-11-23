import { TestBed } from '@angular/core/testing';
import { AccountStore } from './account.store';
import { normalizeDoc } from './sync-merge';

describe('AccountStore', () => {
  beforeEach(() => localStorage.clear());

  it('keeps sample accounts in the order added, even after sync normalizes them', () => {
    const store = TestBed.inject(AccountStore);
    store.loadSample();
    const names = store.accounts().map((a) => a.name);
    expect(names).toEqual(['Sapphire Visa', 'Freedom Mastercard', 'Store Card', 'Credit Union Card']);
    expect(normalizeDoc(store.toDoc()).accounts.map((a) => a.name)).toEqual(names);
  });

  it('records a deletion and counts local edits', () => {
    const store = TestBed.inject(AccountStore);
    store.loadSample();
    const id = store.accounts()[0].id;
    const before = store.localEdits();
    store.remove(id);
    expect(store.localEdits()).toBe(before + 1);
    expect(store.toDoc().deleted.map((t) => t.id)).toEqual([id]);
  });

  it('does not count data applied from sync as a local edit', () => {
    const store = TestBed.inject(AccountStore);
    const before = store.localEdits();
    store.applySynced({ version: 1, accounts: [], deleted: [] });
    expect(store.localEdits()).toBe(before);
  });

  it('saves planner settings, counts them as local edits, and includes them in the synced data', () => {
    const store = TestBed.inject(AccountStore);
    const before = store.localEdits();
    store.setPlanner({ budget: 700, strategy: 'level' });
    expect(store.localEdits()).toBe(before + 1);
    expect(store.planner()).toMatchObject({ budget: 700, strategy: 'level' });
    expect(store.toDoc().planner!.budget).toBe(700);
    expect(JSON.parse(localStorage.getItem('debt-dashboard.planner.v1')!).budget).toBe(700);
  });

  it('takes planner settings from sync, and clears them on "remove from this browser"', () => {
    const store = TestBed.inject(AccountStore);
    store.applySynced({ version: 1, accounts: [], deleted: [], planner: { budget: 900, strategy: 'snowball', changes: [], updatedAt: 99 } });
    expect(store.planner().budget).toBe(900);
    store.clearAll();
    expect(store.planner()).toMatchObject({ budget: null, updatedAt: 0 });
  });
});

describe('AccountStore planner migration', () => {
  it('carries over settings saved by the earlier browser-only version', () => {
    localStorage.clear();
    localStorage.setItem('debt-dashboard.planner-budget.v1', '650');
    localStorage.setItem('debt-dashboard.planner-strategy.v1', 'snowball');
    localStorage.setItem(
      'debt-dashboard.planner-changes.v1',
      JSON.stringify([{ id: 'x', kind: 'once', month: '2027-02', amount: 1500 }]),
    );
    TestBed.resetTestingModule();
    const store = TestBed.inject(AccountStore);
    expect(store.planner()).toMatchObject({ budget: 650, strategy: 'snowball', updatedAt: 1 });
    expect(store.planner().changes).toHaveLength(1);
    expect(localStorage.getItem('debt-dashboard.planner-budget.v1')).toBeNull();
  });
});
