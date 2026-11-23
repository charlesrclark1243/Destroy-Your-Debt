const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtUsd = (n: number) => usd.format(n);
export const fmtUsd0 = (n: number) => usd0.format(n);
export const fmtPct = (fraction: number) => pct1.format(fraction);
export const fmtApr = (apr: number) => `${apr.toFixed(2)}%`;
