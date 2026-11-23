import { buildAmounts, isVariable, monthIndex, monthKey, monthLabel, ScheduleChange } from './payment-schedule';

const NOW = new Date(2026, 10, 23); // 23 Nov 2026
const change = (kind: ScheduleChange['kind'], month: string, amount: number | null): ScheduleChange => ({
  id: kind + month + amount,
  kind,
  month,
  amount,
});

describe('payment schedule', () => {
  it('numbers months from the current calendar month', () => {
    expect(monthKey(1, NOW)).toBe('2026-11');
    expect(monthKey(3, NOW)).toBe('2027-01');
    expect(monthIndex('2026-11', NOW)).toBe(1);
    expect(monthIndex('2027-03', NOW)).toBe(5);
    expect(monthIndex('2026-09', NOW)).toBe(-1);
    expect(monthLabel(8, NOW)).toMatch(/Jun.*2027/);
  });

  it('is just the regular amount with no changes', () => {
    expect(buildAmounts(700, [], NOW)).toEqual([700]);
    expect(isVariable([700])).toBe(false);
  });

  it('replaces a single month for a one-off change', () => {
    // Nov, Dec, Jan, Feb(1500), then 400 repeats
    expect(buildAmounts(400, [change('once', '2027-02', 1500)], NOW)).toEqual([400, 400, 400, 1500, 400]);
  });

  it('changes every month from a "from" change on, and a later one wins', () => {
    const a = buildAmounts(400, [change('from', '2027-01', 600), change('from', '2027-03', 300)], NOW);
    expect(a).toEqual([400, 400, 600, 600, 300]);
  });

  it('lets a one-off override a "from" change for its month', () => {
    const a = buildAmounts(400, [change('from', '2026-12', 600), change('once', '2027-01', 2000)], NOW);
    expect(a).toEqual([400, 600, 2000, 600]);
  });

  it('applies a past "from" change from now on and ignores a past one-off', () => {
    expect(buildAmounts(400, [change('from', '2026-06', 550)], NOW)).toEqual([550]);
    expect(buildAmounts(400, [change('once', '2026-06', 5000)], NOW)).toEqual([400]);
  });

  it('ignores changes without a valid amount', () => {
    expect(buildAmounts(400, [change('once', '2027-01', null), change('from', '2027-01', -5)], NOW)).toEqual([400]);
  });
});
