import { AfterViewInit, Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { AccountDraft, COMPOUNDING_OPTIONS, Compounding, CreditAccount } from '../../core/account.model';
import { effectiveAnnualRate } from '../../core/debt-math';
import { monthIndex, monthKey, monthLabel } from '../../core/payment-schedule';

/** How far ahead the promotion end-month picker goes. */
const PROMO_MONTHS = 60;

/** Modal form used both to add a new account and to edit an existing one. */
@Component({
  selector: 'app-account-form',
  imports: [ReactiveFormsModule],
  templateUrl: './account-form.html',
  styleUrl: './account-form.css',
})
export class AccountForm implements AfterViewInit {
  /** The account being edited, or null to add a new one. */
  readonly account = input<CreditAccount | null>(null);
  readonly saved = output<AccountDraft>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    balance: [null as number | null, [Validators.required, Validators.min(0)]],
    apr: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100)]],
    compounding: ['daily365' as Compounding, Validators.required],
    creditLimit: [null as number | null, [Validators.required, Validators.min(0)]],
    minPayment: [null as number | null, [Validators.min(0)]],
    dueDay: [null as number | null, [Validators.min(1), Validators.max(31)]],
    monthlySpending: [null as number | null, [Validators.min(0)]],
    hasPromo: [false],
    promoEnd: [monthKey(12)],
    aprAfter: [null as number | null, [Validators.min(0), Validators.max(100)]],
    deferred: [false],
  }, { validators: promoComplete });

  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly overLimit = computed(() => {
    const v = this.values();
    return v.balance != null && v.creditLimit != null && v.creditLimit > 0 && v.balance > v.creditLimit;
  });
  protected readonly compoundingOptions = COMPOUNDING_OPTIONS;
  protected readonly hasPromo = computed(() => !!this.values().hasPromo);
  /** Month choices for the promotion end, plus the saved month if it has already passed. */
  protected readonly promoMonths = computed(() => {
    const months = Array.from({ length: PROMO_MONTHS }, (_, i) => ({ key: monthKey(i + 1), label: monthLabel(i + 1) }));
    const saved = this.account()?.promo?.endMonth;
    if (saved && !months.some((m) => m.key === saved)) {
      months.unshift({ key: saved, label: `${monthLabel(monthIndex(saved))} (ended)` });
    }
    return months;
  });
  protected readonly promoEnded = computed(() => {
    const v = this.values();
    return !!v.hasPromo && !!v.promoEnd && monthIndex(v.promoEnd) < 1;
  });
  /** Live preview of the effective annual rate for the entered APR. */
  protected readonly effectiveRate = computed(() => {
    const v = this.values();
    if (v.apr == null || v.apr < 0 || v.apr > 100) return null;
    return (effectiveAnnualRate(v.apr, v.compounding ?? 'daily365') * 100).toFixed(2) + '%';
  });

  ngAfterViewInit(): void {
    const a = this.account();
    if (a) {
      this.form.setValue({
        name: a.name,
        balance: a.balance,
        apr: a.apr,
        compounding: a.compounding,
        creditLimit: a.creditLimit,
        minPayment: a.minPayment,
        dueDay: a.dueDay,
        monthlySpending: a.monthlySpending || null,
        hasPromo: !!a.promo,
        promoEnd: a.promo?.endMonth ?? monthKey(12),
        aprAfter: a.promo?.aprAfter ?? null,
        deferred: a.promo?.deferred ?? false,
      });
    }
    this.dialog().nativeElement.showModal();
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  /** The promotion is ticked but its later APR is missing. */
  protected promoIncomplete(): boolean {
    const c = this.form.controls.aprAfter;
    return !!this.form.errors?.['promoIncomplete'] && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.aprAfter.markAsDirty();
      return;
    }
    const v = this.form.getRawValue();
    this.saved.emit({
      name: v.name ?? '',
      balance: v.balance ?? 0,
      apr: v.apr ?? 0,
      compounding: v.compounding ?? 'daily365',
      creditLimit: v.creditLimit ?? 0,
      minPayment: v.minPayment ?? 0,
      dueDay: v.dueDay ?? null,
      monthlySpending: v.monthlySpending ?? 0,
      promo: v.hasPromo
        ? { endMonth: v.promoEnd ?? monthKey(12), aprAfter: v.aprAfter ?? 0, deferred: !!v.deferred }
        : null,
    });
    this.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  /** Fires for Save, Cancel, Esc and backdrop close alike. */
  protected onDialogClose(): void {
    this.closed.emit();
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === this.dialog().nativeElement) this.close();
  }
}

/** When "promotional rate" is ticked, the APR after the promotion is required. */
function promoComplete(group: AbstractControl): ValidationErrors | null {
  const v = group.value as { hasPromo?: boolean; aprAfter?: number | null };
  return v.hasPromo && (v.aprAfter == null || (v.aprAfter as unknown) === '') ? { promoIncomplete: true } : null;
}
