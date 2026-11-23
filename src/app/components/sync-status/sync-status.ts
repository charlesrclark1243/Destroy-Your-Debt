import { Component, computed, inject, signal } from '@angular/core';
import { DriveSync } from '../../core/drive-sync.service';
import { ChoiceAction, ChoiceDialog } from '../choice-dialog/choice-dialog';

/** Header control showing Google Drive sync state, with sign-in/out and the sync decisions. */
@Component({
  selector: 'app-sync-status',
  imports: [ChoiceDialog],
  templateUrl: './sync-status.html',
  styleUrl: './sync-status.css',
})
export class SyncStatus {
  protected readonly sync = inject(DriveSync);
  protected readonly confirmSignOut = signal(false);

  protected readonly time = computed(() => {
    const t = this.sync.lastSynced();
    return t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  });

  protected readonly choice = computed(() => {
    const p = this.sync.pendingChoice();
    if (!p) return null;
    const n = (k: number) => `${k} ${k === 1 ? 'account' : 'accounts'}`;
    if (p.kind === 'first-link') {
      return {
        heading: 'Combine with your Google Drive data?',
        paragraphs: [
          `This browser has ${n(p.localCount)}, and ${p.email}'s Google Drive already has ${n(p.remoteCount)}.`,
          'Merge keeps both sets. Use Drive data replaces what is in this browser with the Drive copy.',
        ],
        actions: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'use-drive', label: 'Use Drive data', style: 'danger' },
          { id: 'merge', label: 'Merge both', style: 'primary' },
        ] as ChoiceAction[],
      };
    }
    return {
      heading: 'Switch Google account?',
      paragraphs: [
        `The data in this browser belongs to ${p.from}. You signed in as ${p.email}.`,
        `Continuing replaces this browser's copy with ${p.email}'s data. ${p.from}'s data stays safe in that account's Google Drive, apart from any changes not yet synced.`,
      ],
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'use-drive', label: `Switch to ${p.email}`, style: 'primary' },
      ] as ChoiceAction[],
    };
  });

  protected readonly signOutActions: ChoiceAction[] = [
    { id: 'cancel', label: 'Cancel' },
    { id: 'remove', label: 'Remove from this browser', style: 'danger' },
    { id: 'keep', label: 'Keep a copy here', style: 'primary' },
  ];

  protected onChoice(id: string | null): void {
    this.sync.resolveChoice(id === 'merge' || id === 'use-drive' ? id : 'cancel');
  }

  protected onSignOut(id: string | null): void {
    this.confirmSignOut.set(false);
    if (id === 'keep') this.sync.signOut(false);
    if (id === 'remove') this.sync.signOut(true);
  }
}
