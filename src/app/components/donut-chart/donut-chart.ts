import { Component, computed, input, signal } from '@angular/core';
import { ShareRow } from '../../core/debt-math';
import { fmtPct } from '../../core/format';

interface Slice {
  key: string;
  name: string;
  color: string;
  share: number;
  valueText: string;
  path: string;
}

const SIZE = 240;
const C = SIZE / 2;
const R_OUT = 112;
const R_IN = 76;

@Component({
  selector: 'app-donut-chart',
  templateUrl: './donut-chart.html',
  styleUrl: './donut-chart.css',
})
export class DonutChart {
  /** Small label above the heading naming what the chart measures. */
  readonly eyebrow = input<string>('');
  readonly heading = input.required<string>();
  readonly caption = input<string>('');
  readonly rows = input.required<ShareRow[]>();
  readonly centerValue = input<string>('');
  readonly centerLabel = input<string>('');
  readonly formatValue = input<(v: number) => string>((v) => v.toFixed(2));
  /** Tooltip label for the slice value, e.g. "Balance". */
  readonly valueLabel = input<string>('Value');
  readonly emptyText = input<string>('No data');

  protected readonly size = SIZE;
  protected readonly c = C;

  protected readonly hovered = signal<string | null>(null);
  protected readonly tip = signal<{ x: number; y: number } | null>(null);

  protected readonly slices = computed<Slice[]>(() => {
    const fmt = this.formatValue();
    // Accounts without a color slot (9th+ account) fold into a single "Other".
    const colored = this.rows().filter((r) => r.colorSlot != null);
    const rest = this.rows().filter((r) => r.colorSlot == null);
    const items = colored.map((r) => ({
      key: r.id,
      name: r.name,
      color: `var(--series-${r.colorSlot! + 1})`,
      share: r.share,
      value: r.value,
    }));
    if (rest.length) {
      items.push({
        key: '__other',
        name: `Other (${rest.length})`,
        color: 'var(--series-other)',
        share: rest.reduce((s, r) => s + r.share, 0),
        value: rest.reduce((s, r) => s + r.value, 0),
      });
    }

    let angle = 0;
    return items.map((it) => {
      const a0 = angle;
      const a1 = angle + it.share * 2 * Math.PI;
      angle = a1;
      return {
        key: it.key,
        name: it.name,
        color: it.color,
        share: it.share,
        valueText: fmt(it.value),
        // A lone 100% slice can't be drawn as an arc (start = end point), so
        // it gets a full annulus with the same inner/outer radii.
        path: it.share >= 0.99999 ? ringPath() : arcPath(a0, a1),
      };
    });
  });

  protected readonly active = computed(() => this.slices().find((s) => s.key === this.hovered()) ?? null);

  protected readonly pct = fmtPct;

  protected onMove(ev: MouseEvent, key: string, host: HTMLElement): void {
    const box = host.getBoundingClientRect();
    this.hovered.set(key);
    this.tip.set({ x: ev.clientX - box.left, y: ev.clientY - box.top });
  }

  protected clear(): void {
    this.hovered.set(null);
    this.tip.set(null);
  }
}

/** Full annulus: outer and inner circles, cut out with fill-rule evenodd. */
function ringPath(): string {
  const circle = (r: number) => `M ${C} ${C - r} A ${r} ${r} 0 1 1 ${C} ${C + r} A ${r} ${r} 0 1 1 ${C} ${C - r} Z`;
  return `${circle(R_OUT)} ${circle(R_IN)}`;
}

/** Annulus segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
function arcPath(a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
  return [
    `M ${p(R_OUT, a0)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, a1)}`,
    `L ${p(R_IN, a1)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, a0)}`,
    'Z',
  ].join(' ');
}
