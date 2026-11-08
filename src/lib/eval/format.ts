import type { Rate } from './metrics';

export function pct(value: number | null, digits = 1): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(digits)}%`;
}

/** `31/200 (15.5%)` */
export function frac(r: Rate): string {
  return r.n === 0 ? 'n/a (0 eligible)' : `${String(r.k)}/${String(r.n)} (${pct(r.value)})`;
}

/** `95% CI 89-100%` */
export function ci(r: Rate): string {
  return r.ci95 === null ? '' : `95% CI ${pct(r.ci95[0], 0)}-${pct(r.ci95[1], 0)}`;
}

export function af(value: number | null): string {
  if (value === null) return 'absent';
  return value < 0.0001 ? value.toExponential(1) : `${(value * 100).toFixed(2)}%`;
}

export function score(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}
