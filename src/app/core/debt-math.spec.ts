import { Compounding, CreditAccount } from './account.model';
import {
  debtShares,
  effectiveAnnualRate,
  estimatedMonthlyInterest,
  totalDebt,
  utilization,
  weightedAverageApr,
  interestShares,
  nextMonthInterest,
} from './debt-math';

function acct(id: string, balance: number, apr: number, compounding: Compounding = 'monthly'): CreditAccount {
  return { id, name: id, balance, apr, compounding, creditLimit: 10000, minPayment: 0, dueDay: null, colorSlot: 0, createdAt: 0, updatedAt: 0 };
}

describe('debt math', () => {
  const accounts = [acct('a', 1000, 20), acct('b', 3000, 10), acct('c', 0, 25)];

  it('totals debt', () => {
    expect(totalDebt(accounts)).toBe(4000);
  });

  it('computes plain shares d_i / D and skips zero balances', () => {
    const rows = debtShares(accounts);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0].share).toBeCloseTo(0.25);
    expect(rows[1].share).toBeCloseTo(0.75);
  });

  describe('effectiveAnnualRate', () => {
    it('is 0 at 0% APR for every method', () => {
      for (const c of ['daily365', 'daily360', 'monthly'] as const) expect(effectiveAnnualRate(0, c)).toBe(0);
    });
    it('matches the closed forms', () => {
      expect(effectiveAnnualRate(24, 'monthly')).toBeCloseTo(Math.pow(1.02, 12) - 1, 10);
      expect(effectiveAnnualRate(24, 'daily365')).toBeCloseTo(Math.pow(1 + 0.24 / 365, 365) - 1, 10);
      expect(effectiveAnnualRate(24, 'daily360')).toBeCloseTo(Math.pow(1 + 0.24 / 360, 365) - 1, 10);
    });
    it('orders monthly < daily/365 < daily/360', () => {
      const m = effectiveAnnualRate(24, 'monthly');
      const d365 = effectiveAnnualRate(24, 'daily365');
      const d360 = effectiveAnnualRate(24, 'daily360');
      expect(m).toBeLessThan(d365);
      expect(d365).toBeLessThan(d360);
    });
  });

  it("computes next month's interest from the effective rate", () => {
    // monthly compounding: exactly one period, d·APR/12
    expect(nextMonthInterest(acct('m', 1200, 24, 'monthly'))).toBeCloseTo(24);
    // daily/365: (1 + r)^(1/12) − 1 with r = (1 + APR/365)^365 − 1
    const r = effectiveAnnualRate(24, 'daily365');
    expect(nextMonthInterest(acct('d', 1200, 24, 'daily365'))).toBeCloseTo(1200 * (Math.pow(1 + r, 1 / 12) - 1));
  });

  it("shares out next month's interest: m_i / Σ m_j", () => {
    const rows = interestShares(accounts);
    const wa = nextMonthInterest(accounts[0]);
    const wb = nextMonthInterest(accounts[1]);
    expect(rows[0].value).toBeCloseTo(wa);
    expect(rows[0].share).toBeCloseTo(wa / (wa + wb));
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });

  it('gives higher-rate accounts more weight than their plain share', () => {
    const plain = debtShares(accounts);
    const interest = interestShares(accounts);
    expect(interest[0].share).toBeGreaterThan(plain[0].share); // 20% APR
    expect(interest[1].share).toBeLessThan(plain[1].share); // 10% APR
  });

  it('omits 0% APR accounts (weight 0) from interest shares', () => {
    const rows = interestShares([acct('promo', 500, 0), acct('x', 500, 20)]);
    expect(rows.map((r) => r.id)).toEqual(['x']);
    expect(rows[0].share).toBe(1);
  });

  it('returns no interest shares when every balance is at 0% APR', () => {
    expect(interestShares([acct('promo', 500, 0)])).toEqual([]);
  });

  it('returns empty results with no debt', () => {
    expect(debtShares([])).toEqual([]);
    expect(interestShares([acct('z', 0, 20)])).toEqual([]);
  });

  it('computes summary figures', () => {
    expect(weightedAverageApr(accounts)).toBeCloseTo((1000 * 20 + 3000 * 10) / 4000);
    // monthly compounding: one month of interest is exactly d·APR/12
    expect(estimatedMonthlyInterest(accounts)).toBeCloseTo((1000 * 0.2 + 3000 * 0.1) / 12);
    expect(utilization(accounts)).toBeCloseTo(4000 / 30000);
  });
});
