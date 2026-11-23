import { AfterViewInit, Component, ElementRef, input, output, viewChild } from '@angular/core';

export interface ChoiceAction {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'plain';
}

/** Modal with a message and a row of buttons. Emits the chosen id, or null if dismissed. */
@Component({
  selector: 'app-choice-dialog',
  template: `
    <dialog #dialog class="modal choice" (close)="onClose()" (click)="onBackdrop($event)" aria-labelledby="ch-title">
      <div class="modal-inner">
        <h2 id="ch-title">{{ heading() }}</h2>
        @for (p of paragraphs(); track $index) {
          <p>{{ p }}</p>
        }
        <footer>
          @for (a of actions(); track a.id) {
            <button
              type="button"
              class="btn"
              [class.primary]="a.style === 'primary'"
              [class.danger]="a.style === 'danger'"
              (click)="choose(a.id)"
            >
              {{ a.label }}
            </button>
          }
        </footer>
      </div>
    </dialog>
  `,
  styles: `
    h2 { margin: 0 0 8px; font-size: 1.125rem; }
    p { margin: 0 0 8px; color: var(--text-secondary); line-height: 1.5; }
    footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  `,
})
export class ChoiceDialog implements AfterViewInit {
  readonly heading = input.required<string>();
  readonly paragraphs = input.required<string[]>();
  readonly actions = input.required<ChoiceAction[]>();
  readonly chosen = output<string | null>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private picked: string | null = null;

  ngAfterViewInit(): void {
    this.dialog().nativeElement.showModal();
  }

  protected choose(id: string): void {
    this.picked = id;
    this.dialog().nativeElement.close();
  }

  /** Fires for a button, Esc, or a backdrop click; the latter two count as no choice. */
  protected onClose(): void {
    this.chosen.emit(this.picked);
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
