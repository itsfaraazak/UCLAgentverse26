/**
 * Binary-truth, three-way-call metrics for variant classifiers that may
 * abstain. Truth is ClinVar's side of the line (P/LP or B/LB); a method may
 * call either side, call VUS (it looked and is uncertain), or make no call
 * (the method does not apply, e.g. AlphaMissense on a frameshift).
 */
import type { AcmgClassification } from '../acmg/types';

export type Truth = 'P/LP' | 'B/LB';
export type Call = 'P/LP' | 'VUS' | 'B/LB' | 'no-call';

export const TRUTHS: readonly Truth[] = ['P/LP', 'B/LB'];
export const CALLS: readonly Call[] = ['P/LP', 'VUS', 'B/LB', 'no-call'];

export function collapse(c: AcmgClassification): Exclude<Call, 'no-call'> {
  if (c === 'Pathogenic' || c === 'Likely Pathogenic') return 'P/LP';
  if (c === 'Benign' || c === 'Likely Benign') return 'B/LB';
  return 'VUS';
}

export function isDecisive(call: Call): call is Truth {
  return call === 'P/LP' || call === 'B/LB';
}

export interface Rate {
  readonly k: number;
  readonly n: number;
  /** k / n; null when n is 0. */
  readonly value: number | null;
  /** Wilson score 95% interval; null when n is 0. */
  readonly ci95: readonly [number, number] | null;
}

const Z95 = 1.959963984540054;

export function wilson(k: number, n: number, z = Z95): readonly [number, number] | null {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || n < 0 || k > n) {
    throw new RangeError(`wilson: need integers 0 <= k <= n, got k=${String(k)} n=${String(n)}`);
  }
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rate(k: number, n: number): Rate {
  return { k, n, value: n === 0 ? null : k / n, ci95: wilson(k, n) };
}

export type Confusion = Readonly<Record<Truth, Readonly<Record<Call, number>>>>;

export interface Outcome {
  readonly truth: Truth;
  readonly call: Call;
}

export interface MethodMetrics {
  readonly n: number;
  /** Decisive (P/LP or B/LB) calls over all variants. */
  readonly coverage: Rate;
  /** Correct calls over decisive calls. */
  readonly accuracy: Rate;
  /** ClinVar P/LP called P/LP, over all ClinVar P/LP (abstentions count as misses). */
  readonly sensitivity: Rate;
  /** ClinVar B/LB called B/LB, over all ClinVar B/LB (abstentions count as misses). */
  readonly specificity: Rate;
  /** ClinVar P/LP called B/LB, over all ClinVar P/LP: the clinically dangerous error. */
  readonly falseReassurance: Rate;
  /** ClinVar B/LB called P/LP, over all ClinVar B/LB. */
  readonly falseAlarm: Rate;
  readonly confusion: Confusion;
}

function emptyRow(): Record<Call, number> {
  return { 'P/LP': 0, VUS: 0, 'B/LB': 0, 'no-call': 0 };
}

export function confusionOf(outcomes: readonly Outcome[]): Confusion {
  const m: Record<Truth, Record<Call, number>> = { 'P/LP': emptyRow(), 'B/LB': emptyRow() };
  for (const o of outcomes) m[o.truth][o.call] += 1;
  return m;
}

export function computeMetrics(outcomes: readonly Outcome[]): MethodMetrics {
  const m = confusionOf(outcomes);
  const pTotal = CALLS.reduce((s, c) => s + m['P/LP'][c], 0);
  const bTotal = CALLS.reduce((s, c) => s + m['B/LB'][c], 0);
  const tp = m['P/LP']['P/LP'];
  const tn = m['B/LB']['B/LB'];
  const fr = m['P/LP']['B/LB'];
  const fa = m['B/LB']['P/LP'];
  const decisive = tp + tn + fr + fa;
  return {
    n: outcomes.length,
    coverage: rate(decisive, outcomes.length),
    accuracy: rate(tp + tn, decisive),
    sensitivity: rate(tp, pTotal),
    specificity: rate(tn, bTotal),
    falseReassurance: rate(fr, pTotal),
    falseAlarm: rate(fa, bTotal),
    confusion: m,
  };
}
