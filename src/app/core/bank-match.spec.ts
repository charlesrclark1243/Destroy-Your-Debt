import { CreditAccount } from './account.model';
import { BankAccount, accountKind, bankLabel, buildUpdates, guessPositive, owedFrom, suggestLinks } from './bank-match';

const card = (id: string, name: string, extra: Partial<CreditAccount> = {}): CreditAccount => ({
  id, name, balance: 100, apr: 20, compounding: 'daily365', creditLimit: 1000, minPayment: 25, dueDay: null,
  colorSlot: null, createdAt: 0, updatedAt: 0, ...extra,
});
const bank = (id: string, org: string, name: string, balance: number): BankAccount => ({
  id, org, name, balance, available: null, balanceDate: 1795564800000, currency: 'USD',
});

describe('bank matching', () => {
  it('turns the bank balance into the amount owed', () => {
    expect(owedFrom(-3512.1, false)).toBe(3512.1);
    expect(owedFrom(3512.1, true)).toBe(3512.1);
    expect(owedFrom(25, false)).toBe(0); // card in credit: nothing owed
    expect(guessPositive(-10)).toBe(false);
    expect(guessPositive(10)).toBe(true);
  });

  it('tells card accounts from investment and bank accounts', () => {
    expect(accountKind(bank('1', 'Robinhood', 'individual (8953)', 0))).toBe('other');
    expect(accountKind(bank('2', 'Robinhood', 'Roth IRA (9183)', 25.14))).toBe('other');
    expect(accountKind(bank('3', 'Robinhood', 'Crypto · MCP (1449)', 0))).toBe('other');
    expect(accountKind(bank('4', 'Robinhood', 'Checking (1367)', 0))).toBe('other');
    expect(accountKind(bank('5', 'Robinhood', 'Credit Card **2489 (2489)', -130.11))).toBe('card');
    expect(accountKind(bank('6', 'Chase Bank', 'Amazon Prime Rewards Visa Signature (1129)', -995.8))).toBe('card');
    expect(accountKind(bank('7', 'Capital One', 'Quicksilver (5099)', -89.39))).toBe('card');
    expect(accountKind(bank('8', 'Wells Fargo', 'WELLS FARGO ACTIVE CASH VISA\uFFFD\uFFFD CARD ...0129 (0129)', 0))).toBe('card');
  });

  it('matches your real accounts: the Robinhood card, not the $0 investment account', () => {
    const cards = [
      card('d', 'Discover', { balance: 3929.83 }),
      card('a', 'Amazon Prime', { balance: 995.8 }),
      card('c', 'Capital One', { balance: 89.39 }),
      card('r', 'Robinhood', { balance: 130.11 }),
    ];
    const accounts = [
      bank('D', 'Discover Credit Card', 'Charles (2601)', -3929.83),
      bank('A', 'Chase Bank', 'Amazon Prime Rewards Visa Signature (1129)', -995.8),
      bank('C', 'Capital One', 'Quicksilver (5099)', -89.39),
      bank('R1', 'Robinhood', 'individual (8953)', 0),
      bank('R2', 'Robinhood', 'Roth IRA (9183)', 25.14),
      bank('R3', 'Robinhood', 'Crypto (6330)', 0),
      bank('RC', 'Robinhood', 'Credit Card **2489 (2489)', -130.11),
      bank('R4', 'Robinhood', 'Checking (1367)', 0),
      bank('W', 'Wells Fargo', 'WELLS FARGO ACTIVE CASH VISA CARD ...0129 (0129)', 0),
    ];
    const s = suggestLinks(accounts, cards);
    expect(Object.fromEntries(s)).toEqual({ D: 'd', A: 'a', C: 'c', R1: null, R2: null, R3: null, RC: 'r', R4: null, W: null });
  });

  it('keeps existing links', () => {
    const link = { accountId: 'R1', label: '', positive: false, balanceDate: null, appliedAt: 0 };
    const cards = [card('r', 'Robinhood', { bank: link })];
    const s = suggestLinks([bank('R1', 'Robinhood', 'individual', 0), bank('RC', 'Robinhood', 'Credit Card', -1)], cards);
    expect(s.get('R1')).toBe('r');
    expect(s.get('RC')).toBeNull();
  });

  it('cleans garbled characters out of bank names', () => {
    expect(bankLabel(bank('W', 'Wells Fargo', 'WELLS FARGO ACTIVE CASH VISA\uFFFD\uFFFD CARD ...0129', 0))).toBe(
      'WELLS FARGO ACTIVE CASH VISA CARD ...0129',
    );
  });

  it('builds updates only for linked accounts, with the chosen sign', () => {
    const cards = [card('d', 'Discover', { balance: 3929.83 }), card('a', 'Amazon Prime', { balance: 995.8 })];
    const accounts = [bank('A1', 'Discover', 'Discover it', -3512.1), bank('A2', 'Chase Bank', 'Prime Visa', 880.25), bank('A3', 'Chase Bank', 'Checking', 5000)];
    const choices = new Map([
      ['A1', { cardId: 'd', positive: false }],
      ['A2', { cardId: 'a', positive: true }],
      ['A3', { cardId: null, positive: true }],
    ]);
    const updates = buildUpdates(accounts, cards, choices, 42);
    expect(updates.map((u) => [u.card.id, u.oldBalance, u.newBalance])).toEqual([
      ['d', 3929.83, 3512.1],
      ['a', 995.8, 880.25],
    ]);
    expect(updates[1].link).toEqual({ accountId: 'A2', label: 'Chase Bank · Prime Visa', positive: true, balanceDate: 1795564800000, appliedAt: 42 });
  });
});
