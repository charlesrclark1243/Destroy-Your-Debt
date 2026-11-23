import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { EMPTY_DOC, SyncDoc } from './account.model';
import { AccountStore } from './account.store';
import { mergeDocs, parseDoc, sameDoc } from './sync-merge';
import { GOOGLE_CLIENT_ID } from './sync-config';

/*
 * Syncs accounts to a hidden app folder in the signed-in user's own Google
 * Drive. Runs entirely in the browser: Google Identity Services gives a
 * short-lived access token, and the Drive REST API is called directly.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SCOPES = `${DRIVE_SCOPE} openid email`;
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const FILE_NAME = 'debt-dashboard.json';

const META_KEY = 'debt-dashboard.sync.v1';
/** Per-tab, so a reload doesn't ask again, but a new tab or browser restart does. */
const TOKEN_KEY = 'debt-dashboard.token.v1';

const DEBOUNCE_MS = 1500;
const POLL_MS = 60_000;

export type SyncState =
  | 'unconfigured' // no client ID: local-only
  | 'signed-out'
  | 'connecting' // sign-in popup open / checking the account
  | 'syncing'
  | 'synced'
  | 'paused' // linked, but the access token expired: needs a click to reconnect
  | 'offline'
  | 'error';

export type PendingChoice =
  /** First sign-in in this browser, and both this browser and Drive have accounts. */
  | { kind: 'first-link'; email: string; localCount: number; remoteCount: number; remote: SyncDoc }
  /** This browser's data belongs to a different Google account. */
  | { kind: 'switch-account'; from: string; email: string; remote: SyncDoc | null };

interface SyncMeta {
  /** The Google account this browser's data belongs to, or null if never linked. */
  email: string | null;
  signedOut: boolean;
  lastSynced: number | null;
}

interface Token {
  value: string;
  expiresAt: number;
}

class AuthError extends Error {}

@Injectable({ providedIn: 'root' })
export class DriveSync {
  private readonly store = inject(AccountStore);

  readonly enabled = GOOGLE_CLIENT_ID.trim() !== '';
  readonly state = signal<SyncState>('unconfigured');
  readonly email = signal<string | null>(null);
  readonly lastSynced = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly pendingChoice = signal<PendingChoice | null>(null);

  private meta: SyncMeta = loadMeta();
  private token: Token | null = loadToken();
  private tokenClient: GisTokenClient | null = null;
  private fileId: string | null = null;
  private extraFileIds: string[] = [];
  private running = false;
  private again = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.email.set(this.meta.email);
    this.lastSynced.set(this.meta.lastSynced);
    if (!this.enabled) return;

    this.state.set(this.idleState());
    // Load Google's script up front: the sign-in popup must open directly
    // from the click, without waiting for a download, or it gets blocked.
    loadGis()
      .then(() => {
        this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (r) => void this.onToken(r),
          error_callback: (e) => this.onTokenError(e),
        });
      })
      .catch(() => {
        this.error.set('Could not load Google sign-in. Check your connection or content blockers.');
        this.state.set('error');
      });

    // Push local edits shortly after they happen.
    let first = true;
    effect(() => {
      this.store.localEdits();
      if (first) {
        first = false;
        return;
      }
      untracked(() => this.syncSoon());
    });

    // Pull changes made on other devices.
    window.addEventListener('focus', () => this.syncSoon(0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncSoon(0);
    });
    window.addEventListener('online', () => this.syncSoon(0));
    window.addEventListener('offline', () => {
      if (this.isLinked()) this.state.set('offline');
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync();
    }, POLL_MS);

    if (this.isLinked() && this.tokenValid()) void this.sync();
  }

  /** Opens Google's sign-in popup. Must be called directly from a click. */
  signIn(): void {
    if (!this.tokenClient) {
      this.error.set('Google sign-in is still loading. Try again in a moment.');
      return;
    }
    this.error.set(null);
    this.state.set('connecting');
    this.tokenClient.requestAccessToken({ prompt: '' });
  }

  /** Stops syncing in this browser. Optionally removes the local copy (e.g. on a shared computer). */
  signOut(removeLocalData: boolean): void {
    if (this.token) window.google?.accounts.oauth2.revoke(this.token.value, () => {});
    this.clearToken();
    if (removeLocalData) {
      this.store.clearAll();
      this.meta = { email: null, signedOut: true, lastSynced: null };
    } else {
      this.meta = { ...this.meta, signedOut: true };
    }
    this.saveMeta();
    this.email.set(this.meta.email);
    this.lastSynced.set(this.meta.lastSynced);
    this.fileId = null;
    this.error.set(null);
    this.state.set('signed-out');
  }

  /** Answers a PendingChoice dialog. */
  resolveChoice(choice: 'merge' | 'use-drive' | 'cancel'): void {
    const p = this.pendingChoice();
    this.pendingChoice.set(null);
    if (!p) return;
    if (choice === 'cancel') {
      this.clearToken();
      this.state.set(this.idleState());
      return;
    }
    if (choice === 'use-drive') this.store.applySynced(p.remote ?? EMPTY_DOC);
    this.link(p.email);
    void this.sync();
  }

  /** Runs a sync now (merging both ways). Safe to call at any time. */
  async sync(): Promise<void> {
    if (!this.enabled || !this.isLinked() || this.pendingChoice()) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (!navigator.onLine) {
      this.state.set('offline');
      return;
    }
    if (!this.tokenValid()) {
      this.state.set('paused');
      return;
    }

    this.running = true;
    this.state.set('syncing');
    try {
      do {
        this.again = false;
        const remote = await this.download();
        const merged = mergeDocs(this.store.toDoc(), remote ?? EMPTY_DOC);
        if (!remote || !sameDoc(merged, remote) || this.extraFileIds.length) await this.upload(merged);
        // Merge again with the current local state, so an edit made while
        // we were waiting on the network isn't overwritten.
        this.store.applySynced(mergeDocs(this.store.toDoc(), merged));
      } while (this.again);
      this.meta = { ...this.meta, lastSynced: Date.now() };
      this.saveMeta();
      this.lastSynced.set(this.meta.lastSynced);
      this.error.set(null);
      this.state.set('synced');
    } catch (e) {
      if (e instanceof AuthError) {
        this.clearToken();
        this.state.set('paused');
      } else if (!navigator.onLine) {
        this.state.set('offline');
      } else {
        this.error.set(e instanceof Error ? e.message : String(e));
        this.state.set('error');
      }
    } finally {
      this.running = false;
    }
  }

  // ---- sign-in -------------------------------------------------------------

  private async onToken(r: GisTokenResponse): Promise<void> {
    if (r.error || !r.access_token) {
      this.error.set(r.error_description || r.error || 'Sign-in failed.');
      this.state.set('error');
      return;
    }
    if (!window.google!.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
      this.error.set('Sync needs permission to store its data in your Google Drive. Sign in again and allow it.');
      this.state.set('error');
      return;
    }
    this.token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));

    try {
      const email = await this.fetchEmail();
      const linked = this.meta.email;
      if (linked === email) {
        this.link(email);
        void this.sync();
        return;
      }
      this.fileId = null;
      const remote = await this.download();
      const local = this.store.toDoc();
      if (linked && local.accounts.length) {
        this.pendingChoice.set({ kind: 'switch-account', from: linked, email, remote });
      } else if (!linked && local.accounts.length && remote?.accounts.length) {
        this.pendingChoice.set({
          kind: 'first-link',
          email,
          localCount: local.accounts.length,
          remoteCount: remote.accounts.length,
          remote,
        });
      } else {
        if (linked) this.store.applySynced(remote ?? EMPTY_DOC); // other account, nothing local to lose
        this.link(email);
        void this.sync();
        return;
      }
      this.state.set('connecting');
    } catch (e) {
      this.clearToken();
      this.error.set(e instanceof Error ? e.message : String(e));
      this.state.set('error');
    }
  }

  private onTokenError(e: { type?: string }): void {
    if (e?.type === 'popup_failed_to_open') {
      this.error.set('The Google sign-in window was blocked. Allow pop-ups for this site and try again.');
      this.state.set('error');
    } else {
      this.state.set(this.idleState()); // closed the popup
    }
  }

  private link(email: string): void {
    this.meta = { ...this.meta, email, signedOut: false };
    this.saveMeta();
    this.email.set(email);
  }

  private async fetchEmail(): Promise<string> {
    const info = (await (await this.api(USERINFO)).json()) as { email?: string };
    if (!info.email) throw new Error('Could not read your Google account email.');
    return info.email;
  }

  // ---- Drive ---------------------------------------------------------------

  /** Reads the sync file (merging duplicates if two devices both created one). */
  private async download(): Promise<SyncDoc | null> {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const list = (await (
      await this.api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id)`)
    ).json()) as { files?: { id: string }[] };
    const files = list.files ?? [];
    this.fileId = files[0]?.id ?? null;
    this.extraFileIds = files.slice(1).map((f) => f.id);
    if (!files.length) return null;
    const docs = await Promise.all(
      files.map(async (f) => parseDoc(await (await this.api(`${DRIVE}/files/${f.id}?alt=media`)).json())),
    );
    return docs.reduce(mergeDocs);
  }

  private async upload(doc: SyncDoc): Promise<void> {
    const body = JSON.stringify(doc);
    if (this.fileId) {
      await this.api(`${UPLOAD}/files/${this.fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } else {
      const boundary = 'debt-dashboard-' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const created = (await (
        await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: multipart,
        })
      ).json()) as { id: string };
      this.fileId = created.id;
    }
    for (const id of this.extraFileIds) {
      await this.api(`${DRIVE}/files/${id}`, { method: 'DELETE' });
    }
    this.extraFileIds = [];
  }

  private async api(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new AuthError('Not signed in');
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token.value}` },
    });
    if (res.status === 401) throw new AuthError('Sign-in expired');
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        /* not JSON */
      }
      throw new Error(`Google Drive request failed (${res.status})${detail ? ': ' + detail : ''}`);
    }
    return res;
  }

  // ---- helpers -------------------------------------------------------------

  private syncSoon(delay = DEBOUNCE_MS): void {
    if (!this.isLinked()) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.sync();
    }, delay);
  }

  private isLinked(): boolean {
    return !!this.meta.email && !this.meta.signedOut;
  }

  private tokenValid(): boolean {
    return !!this.token && Date.now() < this.token.expiresAt - 60_000;
  }

  private idleState(): SyncState {
    return this.isLinked() ? (this.tokenValid() ? 'synced' : 'paused') : 'signed-out';
  }

  private clearToken(): void {
    this.token = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  private saveMeta(): void {
    localStorage.setItem(META_KEY, JSON.stringify(this.meta));
  }
}

function loadMeta(): SyncMeta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null') as Partial<SyncMeta> | null;
    return { email: m?.email ?? null, signedOut: !!m?.signedOut, lastSynced: m?.lastSynced ?? null };
  } catch {
    return { email: null, signedOut: false, lastSynced: null };
  }
}

function loadToken(): Token | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null;
    return t && typeof t.value === 'string' && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('GIS not available')));
    s.onerror = () => reject(new Error('GIS failed to load'));
    document.head.appendChild(s);
  });
}

// Minimal typings for the parts of Google Identity Services used here.
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (r: GisTokenResponse) => void;
            error_callback?: (e: { type?: string }) => void;
          }): GisTokenClient;
          hasGrantedAllScopes(r: GisTokenResponse, ...scopes: string[]): boolean;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}
