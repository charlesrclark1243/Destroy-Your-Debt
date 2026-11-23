import { Compounding, CreditAccount } from './account.model';
import { monthlyRate } from './debt-math';
import { amountFor, planPayments, projectPayoff, Strategy } from './payment-plan';

function acct(id: string, balance: number, apr: number, minPayment: number, compounding: Compounding = 'daily365'): CreditAccount {
  return { id, name: id, balance, apr, compounding, creditLimit: 10000, minPayment, dueDay: null, colorSlot: null, createdAt: 0, updatedAt: 0 };
}
const payments = (accounts: CreditAccount[], budget: number, s: Strategy) =>
  Object.fromEntries(planPayments(accounts, budget, s).rows.map((r) => [r.account.id, r.payment]));
const charge = (a: CreditAccount, paid: number) => (a.balance - paid) * monthlyRate(a);

describe('planPayments', () => {
  const accounts = [acct('low', 3000, 12.9, 75), acct('high', 650, 29.99, 35), acct('mid', 4200, 24.99, 120)];

  describe('avalanche', () => {
    it('pays all minimums, then puts the rest on the highest rate first', () => {
      const plan = planPayments(accounts, 1000, 'avalanche');
      // minimums 230; extra 770: high gets 615 more (paid off), mid gets the last 155
      expect(payments(accounts, 1000, 'avalanche')).toEqual({ high: 650, mid: 275, low: 75 });
      expect(plan.rows.map((r) => r.account.id)).toEqual(['high', 'mid', 'low']);
      expect(plan.totalPaid).toBe(1000);
      expect(plan.leftover).toBe(0);
      expect(plan.shortfall).toBe(0);
    });

    it('puts extra on 0% APR cards last', () => {
      const plan = planPayments([acct('promo', 1000, 0, 25), acct('card', 1000, 20, 25)], 300, 'avalanche');
      expect(plan.rows[0].account.id).toBe('card');
      expect(plan.rows.find((r) => r.account.id === 'promo')!.payment).toBe(25);
    });
  });

  describe('snowball', () => {
    it('puts the extra on the smallest balance first', () => {
      const a = [acct('big', 5000, 30, 100), acct('small', 400, 10, 25), acct('medium', 1500, 20, 40)];
      // minimums 165; extra 435: small gets 375 (paid off), medium the last 60
      expect(payments(a, 600, 'snowball')).toEqual({ small: 400, medium: 100, big: 100 });
      expect(planPayments(a, 600, 'snowball').rows.map((r) => r.account.id)).toEqual(['small', 'medium', 'big']);
    });
  });

  describe('level the charges', () => {
    it("lowers the biggest charge to the next card's, then both together", () => {
      const a = [acct('big', 4000, 24.99, 0), acct('small', 1000, 27.99, 0)];
      // big charges ≈ $84/month, small ≈ $23.60; bringing big down to small's level
      // takes ≈ $2,876, so with $3,500 the rest is shared to keep the charges equal
      const plan = planPayments(a, 3500, 'level');
      const by = Object.fromEntries(plan.rows.map((r) => [r.account.id, r.payment]));
      expect(by['big'] + by['small']).toBeCloseTo(3500, 2);
      // after paying, both cards charge the same interest (to the cent)
      expect(charge(a[0], by['big'])).toBeCloseTo(charge(a[1], by['small']), 1);
      expect(by['small']).toBeGreaterThan(0);
    });

    it('only pays the biggest charge while it is still above the others', () => {
      const a = [acct('big', 4000, 24.99, 0), acct('small', 1000, 27.99, 0)];
      // big's charge ≈ $83, small's ≈ $23; $100 isn't enough to bring big down to small's level
      expect(payments(a, 100, 'level')).toEqual({ big: 100, small: 0 });
    });

    it('pays minimums first and leaves 0% cards for last', () => {
      const a = [acct('promo', 500, 0, 25), acct('x', 800, 20, 30), acct('y', 2000, 25, 60)];
      const by = payments(a, 115, 'level');
      expect(by).toEqual({ y: 60, x: 30, promo: 25 });
      expect(payments(a, 3400, 'level')).toEqual({ y: 2000, x: 800, promo: 500 });
    });

    it('keeps the cents adding up to the budget', () => {
      const a = [acct('a', 1234.56, 21.3, 33), acct('b', 2345.67, 24.7, 51), acct('c', 987.65, 28.1, 27)];
      expect(planPayments(a, 777.77, 'level').totalPaid).toBe(777.77);
    });
  });

  it('reports a shortfall, covers minimums in priority order, and skips the projection', () => {
    const plan = planPayments(accounts, 100, 'avalanche');
    expect(payments(accounts, 100, 'avalanche')).toEqual({ high: 35, mid: 65, low: 0 });
    expect(plan.shortfall).toBe(130);
    expect(plan.projection).toBeNull();
    expect(plan.comparison).toBeNull();
  });

  it('pays everything off and reports the leftover when the budget exceeds the debt', () => {
    for (const s of ['avalanche', 'snowball', 'level'] as Strategy[]) {
      const plan = planPayments(accounts, 10000, s);
      expect(plan.rows.every((r) => r.balanceAfter === 0)).toBe(true);
      expect(plan.leftover).toBeCloseTo(10000 - 7850);
      expect(plan.projection).toMatchObject({ months: 1, totalInterest: 0, paysOff: true });
    }
  });

  it('treats a minimum larger than the balance as the balance, and skips paid-off cards', () => {
    const plan = planPayments([acct('tiny', 20, 20, 35), acct('zero', 0, 20, 25)], 20);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].payment).toBe(20);
    expect(plan.totalMinimums).toBe(20);
  });
});

describe('projectPayoff', () => {
  it('matches a hand calculation for one card', () => {
    // $1,000 at 12% compounded monthly (1%/month), paying $510/month:
    // m1: 490 left, +4.90 interest; m2: 494.90 paid off. Total interest $4.90.
    const p = projectPayoff([acct('a', 1000, 12, 0, 'monthly')], 510, 'avalanche');
    expect(p.months).toBe(2);
    expect(p.totalInterest).toBeCloseTo(4.9, 6);
    expect(p.paysOff).toBe(true);
  });

  it('gives each card its payoff month', () => {
    const plan = planPayments([acct('small', 300, 30, 25), acct('big', 3000, 20, 60)], 400, 'avalanche');
    const month = Object.fromEntries(plan.rows.map((r) => [r.account.id, r.payoffMonth]));
    expect(month['small']).toBe(1);
    expect(month['big']).toBe(plan.projection!.months);
  });

  it('reports when the payments never catch up with the interest', () => {
    const p = projectPayoff([acct('a', 20000, 29.99, 100)], 100, 'avalanche');
    expect(p.paysOff).toBe(false);
  });

  it('uses a different amount each month', () => {
    const a = [acct('a', 1000, 12, 0, 'monthly')];
    // month 1: pay 100 → 900 + 9.00; month 2: pay 909 → done
    const p = projectPayoff(a, [100, 2000], 'avalanche');
    expect(p.months).toBe(2);
    expect(p.totalInterest).toBeCloseTo(9, 6);
    expect(amountFor([100, 2000], 1)).toBe(100);
    expect(amountFor([100, 2000], 9)).toBe(2000);
  });

  it('saves more interest when a lump sum comes earlier', () => {
    const a = [acct('a', 4000, 24.74, 185), acct('b', 1000, 27.74, 35)];
    const early = projectPayoff(a, [1500, 400], 'avalanche').totalInterest;
    const late = projectPayoff(a, [400, 400, 400, 400, 400, 400, 400, 1500, 400], 'avalanche').totalInterest;
    expect(early).toBeLessThan(late);
  });

  it('stops and reports a later month that does not cover the minimums', () => {
    const plan = planPayments([acct('a', 3000, 20, 100)], [300, 300, 50, 300], 'avalanche');
    expect(plan.shortfall).toBe(0);
    expect(plan.projection!.paysOff).toBe(false);
    expect(plan.projection!.shortMonth).toEqual({ month: 3, amount: 50, minimums: 100 });
    expect(plan.schedule).toEqual([]);
  });

  it('lists every month, with payments adding up and interest matching the total', () => {
    const a = [acct('x', 2500, 22.9, 50), acct('y', 800, 28.5, 25), acct('z', 300, 0, 25)];
    const plan = planPayments(a, [400, 400, 1200, 350], 'avalanche');
    const months = plan.schedule;
    expect(months.length).toBe(plan.projection!.months);
    expect(months.map((m) => m.amount).slice(0, 4)).toEqual([400, 400, 1200, 350]);
    for (const m of months.slice(0, -1)) expect(m.paid).toBeCloseTo(m.amount, 2);
    expect(months.at(-1)!.paid).toBeLessThanOrEqual(months.at(-1)!.amount);
    expect(months.reduce((s, m) => s + m.interest, 0)).toBeCloseTo(plan.projection!.totalInterest, 6);
    // month 1 of the schedule is this month's plan
    expect(months[0].payments).toEqual(plan.rows.map((r) => r.payment));
    // every card is paid exactly its balance plus its interest overall
    const owed = a.reduce((s, c) => s + c.balance, 0) + plan.projection!.totalInterest;
    expect(months.reduce((s, m) => s + m.paid, 0)).toBeCloseTo(owed, 0);
  });

  it('avalanche never costs more or takes longer than the others with varying amounts (random)', () => {
    let seed = 23;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let compared = 0;
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rnd() * 4);
      const cards = Array.from({ length: n }, (_, i) =>
        acct('c' + i, Math.round(50 + rnd() * 6000), Math.round(rnd() * 3500) / 100, Math.round(rnd() * 150)),
      );
      const mins = cards.reduce((s, c) => s + c.minPayment, 0);
      const amounts = Array.from({ length: 36 }, () => mins + 20 + Math.round(rnd() * 1200));
      const plan = planPayments(cards, amounts, 'avalanche');
      if (!plan.comparison!.every((p) => p.paysOff)) continue;
      compared++;
      const get = (s: Strategy) => plan.comparison!.find((p) => p.strategy === s)!;
      for (const other of ['snowball', 'level'] as Strategy[]) {
        expect(get('avalanche').totalInterest).toBeLessThanOrEqual(get(other).totalInterest + 1e-6);
        expect(get('avalanche').months).toBeLessThanOrEqual(get(other).months);
      }
    }
    expect(compared).toBeGreaterThan(150);
  });

  it('avalanche never costs more in total than snowball or level (random cards)', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let compared = 0;
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(rnd() * 4);
      const cards = Array.from({ length: n }, (_, i) =>
        acct('c' + i, Math.round(50 + rnd() * 6000), Math.round(rnd() * 3500) / 100, Math.round(rnd() * 150)),
      );
      const budget = cards.reduce((s, c) => s + c.minPayment, 0) + 50 + Math.round(rnd() * 800);
      const plan = planPayments(cards, budget, 'avalanche');
      if (!plan.comparison!.every((p) => p.paysOff)) continue;
      compared++;
      const total = (s: Strategy) => plan.comparison!.find((p) => p.strategy === s)!.totalInterest;
      expect(total('avalanche')).toBeLessThanOrEqual(total('snowball') + 1e-6);
      expect(total('avalanche')).toBeLessThanOrEqual(total('level') + 1e-6);
    }
    expect(compared).toBeGreaterThan(200);
  });
});
