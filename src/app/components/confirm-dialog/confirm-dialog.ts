import { AfterViewInit, Component, ElementRef, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog #dialog class="modal small" (close)="closed.emit()" (click)="onBackdrop($event)" aria-labelledby="cd-title">
      <div class="modal-inner">
      <h2 id="cd-title">{{ heading() }}</h2>
      <p>{{ message() }}</p>
      <footer>
        <button type="button" class="btn" (click)="dialog.close()" autofocus>Cancel</button>
        <button type="button" class="btn danger" (click)="confirm()">{{ confirmText() }}</button>
      </footer>
      </div>
    </dialog>
  `,
  styles: `
    h2 { margin: 0 0 8px; font-size: 1.125rem; }
    p { margin: 0; color: var(--text-secondary); line-height: 1.5; }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  `,
})
export class ConfirmDialog implements AfterViewInit {
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmText = input('Delete');
  readonly confirmed = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  ngAfterViewInit(): void {
    this.dialog().nativeElement.showModal();
  }

  protected confirm(): void {
    this.confirmed.emit();
    this.dialog().nativeElement.close();
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
