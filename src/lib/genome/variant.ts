import { InsertionRefCodonError } from './errors';
import { codons, normalizeDna } from './translate';
import type { Sequence, Variant } from './types';

function requireCodonIndex(v: Variant, length: number, allowEnd: boolean): number {
  if (!Number.isInteger(v.codonIndex) || v.codonIndex < 1) {
    throw new Error(`codonIndex must be a 1-based integer, got ${String(v.codonIndex)}`);
  }
  const idx = v.codonIndex - 1;
  const max = allowEnd ? length : length - 1;
  if (idx < 0 || idx > max || (!allowEnd && idx >= length)) {
    throw new Error(
      `codonIndex ${v.codonIndex} is out of range for a ${length}-codon sequence`,
    );
  }
  return idx;
}

function normalizeCodon(codon: string): string {
  return codon.toUpperCase();
}

/**
 * Apply a single variant to a coding sequence. Coordinates are 1-based codon indices.
 * Substitution and deletion require `refCodon` to match the codon at `codonIndex`.
 * Insertion places `altCodon` at `codonIndex` (existing codons from that index shift right)
 * and must be passed an empty `refCodon` — there is nothing to verify (SPEC §4.6 #15).
 */
export function applyVariant(seq: Sequence, v: Variant): Sequence {
  const normalized = normalizeDna(seq.bases);
  const list = [...codons(normalized)];
  const rem = normalized.length % 3;
  const tail = rem === 0 ? '' : normalized.slice(normalized.length - rem);

  switch (v.kind) {
    case 'substitution': {
      const idx = requireCodonIndex(v, list.length, false);
      const current = list[idx];
      if (current === undefined) {
        throw new Error(`codonIndex ${v.codonIndex} is out of range`);
      }
      if (current !== normalizeCodon(v.refCodon)) {
        throw new Error(
          `refCodon mismatch at ${v.codonIndex}: expected ${v.refCodon}, found ${current}`,
        );
      }
      list[idx] = normalizeCodon(v.altCodon);
      break;
    }
    case 'deletion': {
      const idx = requireCodonIndex(v, list.length, false);
      const current = list[idx];
      if (current === undefined) {
        throw new Error(`codonIndex ${v.codonIndex} is out of range`);
      }
      if (current !== normalizeCodon(v.refCodon)) {
        throw new Error(
          `refCodon mismatch at ${v.codonIndex}: expected ${v.refCodon}, found ${current}`,
        );
      }
      list.splice(idx, 1);
      break;
    }
    case 'insertion': {
      if (v.refCodon.length > 0) {
        throw new InsertionRefCodonError(v.refCodon);
      }
      const idx = requireCodonIndex(v, list.length, true);
      list.splice(idx, 0, normalizeCodon(v.altCodon));
      break;
    }
    default: {
      const exhaustive: never = v.kind;
      throw new Error(`unsupported variant kind: ${String(exhaustive)}`);
    }
  }

  return { bases: `${list.join('')}${tail}`, label: v.label };
}

/** Apply variants in order. Each step is validated against the sequence produced so far. */
export function applyVariants(seq: Sequence, variants: readonly Variant[]): Sequence {
  return variants.reduce((current, v) => applyVariant(current, v), seq);
}
