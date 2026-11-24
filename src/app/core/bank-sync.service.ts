import { Injectable, signal } from '@angular/core';
import { BankAccount } from './bank-match';

/**
 * Talks to the Destroy Your Debt server running on this computer (a separate
 * project: destroy-your-debt-server). The server holds the SimpleFIN access;
 * this page only ever sees balances. The pairing token is kept in this browser
 * only (never synced to Google Drive).
 */

export const SERVER_URL = 'http://127.0.0.1:47317';
const TOKEN_KEY = 'debt-dashboard.local-server.v1';

export type BankSyncState = 'unpaired' | 'ready' | 'working' | 'error';

@Injectable({ providedIn: 'root' })
export class BankSync {
  readonly state = signal<BankSyncState>(loadToken() ? 'ready' : 'unpaired');
  readonly accounts = signal<BankAccount[] | null>(null);
  /** Messages SimpleFIN returned with the balances (e.g. a bank needing you to sign in again). */
  readonly bankErrors = signal<string[]>([]);
  readonly fetchedAt = signal<number | null>(null);
  readonly cached = signal(false);
  readonly error = signal<string | null>(null);

  private token: string | null = loadToken();

  readonly paired = () => !!this.token;

  async pair(code: string): Promise<boolean> {
    this.state.set('working');
    this.error.set(null);
    try {
      const res = await this.call('/v1/pair', { method: 'POST', body: JSON.stringify({ code }) }, false);
      const body = await res.json();
      if (!res.ok || !body.token) throw new Error(body.error ?? `The server answered ${res.status}.`);
      this.token = body.token;
      localStorage.setItem(TOKEN_KEY, body.token);
      this.state.set('ready');
      return true;
    } catch (e) {
      this.fail(e);
      this.state.set('unpaired');
      return false;
    }
  }

  /** Gets balances from the server. `refresh` asks it to check with the bank instead of using its cache. */
  async fetchAccounts(refresh = false): Promise<void> {
    if (!this.token) return;
    this.state.set('working');
    this.error.set(null);
    try {
      const res = await this.call(`/v1/accounts${refresh ? '?refresh=1' : ''}`, { method: 'GET' });
      const body = await res.json();
      if (res.status === 401) {
        this.forgetToken();
        throw new Error('This browser is no longer paired with the server. Pair it again with a new code.');
      }
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      this.accounts.set(body.accounts ?? []);
      this.bankErrors.set(body.errors ?? []);
      this.fetchedAt.set(body.fetchedAt ?? Date.now());
      this.cached.set(!!body.cached);
      this.state.set('ready');
    } catch (e) {
      this.fail(e);
    }
  }

  async unpair(): Promise<void> {
    if (this.token) {
      try {
        await this.call('/v1/unpair', { method: 'POST' });
      } catch {
        /* server not running: forget locally anyway */
      }
    }
    this.forgetToken();
    this.accounts.set(null);
    this.bankErrors.set([]);
    this.error.set(null);
  }

  private async call(path: string, init: RequestInit, auth = true): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      return await fetch(SERVER_URL + path, { ...init, headers, mode: 'cors', cache: 'no-store' });
    } catch {
      throw new Error(
        "Can't reach the Destroy Your Debt server. Make sure it's running on this computer (npm start in its folder), and if the browser asks to allow access to devices on your local network, allow it.",
      );
    }
  }

  private forgetToken(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
    this.state.set('unpaired');
  }

  private fail(e: unknown): void {
    this.error.set(e instanceof Error ? e.message : String(e));
    if (this.token) this.state.set('error');
  }
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
