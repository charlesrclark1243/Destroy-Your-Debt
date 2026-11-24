import { BankLink, CreditAccount } from './account.model';

/** An account as reported by the Destroy Your Debt server. */
export interface BankAccount {
  id: string;
  name: string;
  org: string;
  /** Signed, as the bank reports it (credit cards usually negative when you owe money). */
  balance: number;
  available: number | null;
  balanceDate: number | null;
  currency: string;
}

/** One proposed balance change from the bank. */
export interface BankUpdate {
  card: CreditAccount;
  bankAccount: BankAccount;
  oldBalance: number;
  newBalance: number;
  link: BankLink;
}

/** The amount owed on a card, from the bank's signed balance. A card in credit counts as $0 owed. */
export function owedFrom(balance: number, positive: boolean): number {
  const owed = positive ? balance : -balance;
  return Math.max(0, Math.round(owed * 100) / 100);
}

/** Most banks report a card's debt as a negative balance; a positive one probably means "positive = owed". */
export function guessPositive(balance: number): boolean {
  return balance > 0;
}

export function bankLabel(a: BankAccount): string {
  const org = clean(a.org);
  const name = clean(a.name);
  return org && !name.toLowerCase().includes(org.toLowerCase()) ? `${org} · ${name}` : name;
}

/** Removes characters the bank sent garbled (shown as �) and extra spaces. */
function clean(s: string): string {
  return s.replace(/\uFFFD/g, ' ').replace(/\s+/g, ' ').trim();
}

const CARD_WORDS =
  /\b(credit|card|visa|mastercard|amex|american express|signature|quicksilver|venture|savor|sapphire|freedom|active cash|autograph|reflect|platinum|rewards)\b/i;
const OTHER_WORDS =
  /\b(checking|savings|ira|roth|401\s?k|403\s?b|hsa|brokerage|individual|joint|crypto|money market|cd|certificate|investment|investing|retirement|trust|loan|mortgage|escrow)\b/i;

export type AccountKind = 'card' | 'other' | 'unknown';

/** Guesses from its name (and sign) whether a bank account is a credit card. */
export function accountKind(a: BankAccount): AccountKind {
  const name = clean(a.name);
  if (OTHER_WORDS.test(name) && !CARD_WORDS.test(name)) return 'other';
  const all = `${clean(a.org)} ${name}`;
  if (CARD_WORDS.test(all)) return 'card';
  if (OTHER_WORDS.test(all)) return 'other';
  return a.balance < 0 ? 'card' : 'unknown';
}

/**
 * Suggests a card for every bank account at once. Existing links win; accounts
 * that look like investments, checking, savings and so on are never suggested.
 * Otherwise the best-scoring pairs are matched first: shared words in the names,
 * how card-like the account looks, and how close its amount is to the card's balance.
 */
export function suggestLinks(bankAccounts: readonly BankAccount[], cards: readonly CreditAccount[]): Map<string, string | null> {
  const result = new Map<string, string | null>(bankAccounts.map((b) => [b.id, null]));
  const usedCards = new Set<string>();
  for (const b of bankAccounts) {
    const linked = cards.find((c) => c.bank?.accountId === b.id);
    if (linked) {
      result.set(b.id, linked.id);
      usedCards.add(linked.id);
    }
  }

  const pairs: { bank: string; card: string; score: number }[] = [];
  for (const b of bankAccounts) {
    if (result.get(b.id)) continue;
    const kind = accountKind(b);
    if (kind === 'other') continue;
    const words = tokens(`${b.org} ${b.name}`);
    for (const c of cards) {
      if (c.bank || usedCards.has(c.id)) continue;
      const shared = tokens(c.name).filter((w) => words.includes(w)).length;
      if (shared === 0) continue;
      const owed = owedFrom(b.balance, guessPositive(b.balance));
      const close = c.balance > 0 && Math.abs(owed - c.balance) <= Math.max(1, c.balance * 0.02);
      pairs.push({ bank: b.id, card: c.id, score: shared + (kind === 'card' ? 2 : 0) + (b.balance < 0 ? 1 : 0) + (close ? 2 : 0) });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  for (const p of pairs) {
    if (result.get(p.bank) || usedCards.has(p.card)) continue;
    result.set(p.bank, p.card);
    usedCards.add(p.card);
  }
  return result;
}

/** Builds the updates for the chosen links (bank account id → card id, and sign choice). */
export function buildUpdates(
  bankAccounts: readonly BankAccount[],
  cards: readonly CreditAccount[],
  choices: ReadonlyMap<string, { cardId: string | null; positive: boolean }>,
  now = Date.now(),
): BankUpdate[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const updates: BankUpdate[] = [];
  for (const b of bankAccounts) {
    const choice = choices.get(b.id);
    const card = choice?.cardId ? byId.get(choice.cardId) : undefined;
    if (!card || !choice) continue;
    updates.push({
      card,
      bankAccount: b,
      oldBalance: card.balance,
      newBalance: owedFrom(b.balance, choice.positive),
      link: { accountId: b.id, label: bankLabel(b), positive: choice.positive, balanceDate: b.balanceDate, appliedAt: now },
    });
  }
  return updates;
}

const STOP = new Set(['card', 'credit', 'bank', 'the', 'visa', 'mastercard', 'rewards', 'signature', 'account', 'of', 'and', 'na']);
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}
