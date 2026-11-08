import { describe, it, expect } from 'vitest';
import {
  CODON_TABLE,
  aminoAcid,
  translate,
  codons,
  applyVariant,
  diffSequences,
  InvalidBaseError,
  PartialCodonError,
  InsertionRefCodonError,
} from './index';
import type { DiffRow, Sequence, Variant } from './types';

const BASES = ['A', 'C', 'G', 'T'] as const;
const ALL_CODONS = Object.keys(CODON_TABLE);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function failSeed(seed: number, detail: string): never {
  throw new Error(`property failed (seed=${seed}): ${detail}`);
}

function withSeed(seed: number, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('property failed (seed=')) throw err;
    throw new Error(`property failed (seed=${seed}): ${msg}`);
  }
}

function pickIndex(rng: () => number, length: number): number {
  if (length <= 0) {
    throw new Error('pickIndex: empty');
  }
  return Math.floor(rng() * length);
}

function pickOne<T>(rng: () => number, items: readonly T[]): T {
  const item = items[pickIndex(rng, items.length)];
  if (item === undefined) {
    throw new Error('pickOne: missing item');
  }
  return item;
}

function randomCodon(rng: () => number): string {
  return `${pickOne(rng, BASES)}${pickOne(rng, BASES)}${pickOne(rng, BASES)}`;
}

function shuffleInPlace<T>(rng: () => number, items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rng, i + 1);
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) {
      throw new Error('shuffle: missing item');
    }
    items[i] = b;
    items[j] = a;
  }
}

function uniqueCodons(rng: () => number, count: number): string[] {
  if (count > ALL_CODONS.length) {
    throw new Error('uniqueCodons: count exceeds the genetic code');
  }
  const pool = [...ALL_CODONS];
  shuffleInPlace(rng, pool);
  return pool.slice(0, count);
}

function seqFromCodons(codonList: readonly string[], label = 'test'): Sequence {
  return { bases: codonList.join(''), label };
}

function seq(bases: string, label = 'test'): Sequence {
  return { bases, label };
}

function reconstruct(rows: readonly DiffRow[], side: 'ref' | 'alt'): string {
  const pieces: string[] = [];
  for (const row of rows) {
    const codon = side === 'ref' ? row.refCodon : row.altCodon;
    if (codon !== null) pieces.push(codon);
  }
  return pieces.join('');
}

function countStatus(rows: readonly DiffRow[], status: DiffRow['status']): number {
  return rows.filter((row) => row.status === status).length;
}

function variant(partial: Omit<Variant, 'gene' | 'label'> & { gene?: string; label?: string }): Variant {
  return {
    gene: partial.gene ?? 'X',
    label: partial.label ?? 'v',
    codonIndex: partial.codonIndex,
    refCodon: partial.refCodon,
    altCodon: partial.altCodon,
    kind: partial.kind,
  };
}

describe('property: diffSequences round-trip', () => {
  it('reconstructs each sequence’s codon stream from the aligned rows', () => {
    const iterations = 200;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x1000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const refN = pickIndex(rng, 13);
        const altN = pickIndex(rng, 13);
        const ref = seqFromCodons(Array.from({ length: refN }, () => randomCodon(rng)), 'ref');
        const alt = seqFromCodons(Array.from({ length: altN }, () => randomCodon(rng)), 'alt');
        const rows = diffSequences(ref, alt);
        const gotRef = reconstruct(rows, 'ref');
        const gotAlt = reconstruct(rows, 'alt');
        const wantRef = codons(ref.bases).join('');
        const wantAlt = codons(alt.bases).join('');
        if (gotRef !== wantRef) {
          failSeed(seed, `ref reconstruction ${gotRef} !== ${wantRef}`);
        }
        if (gotAlt !== wantAlt) {
          failSeed(seed, `alt reconstruction ${gotAlt} !== ${wantAlt}`);
        }
      });
    }
  });

  it('uses 1-based contiguous alignment rows and never emits a both-null pair', () => {
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x2000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const ref = seqFromCodons(Array.from({ length: pickIndex(rng, 10) }, () => randomCodon(rng)));
        const alt = seqFromCodons(Array.from({ length: pickIndex(rng, 10) }, () => randomCodon(rng)));
        const rows = diffSequences(ref, alt);
        rows.forEach((row, offset) => {
          if (row.codonIndex !== offset + 1) {
            failSeed(seed, `codonIndex ${row.codonIndex} at offset ${offset}`);
          }
          if (row.refCodon === null && row.altCodon === null) {
            failSeed(seed, `both-null row at ${row.codonIndex}`);
          }
          if (row.status === 'same' && row.refCodon !== row.altCodon) {
            failSeed(seed, `same row with unequal codons at ${row.codonIndex}`);
          }
          if (row.status === 'changed' && (row.refCodon === null || row.altCodon === null || row.refCodon === row.altCodon)) {
            failSeed(seed, `changed row is not a substitution at ${row.codonIndex}`);
          }
          if (row.status === 'added' && (row.refCodon !== null || row.altCodon === null)) {
            failSeed(seed, `added row shape at ${row.codonIndex}`);
          }
          if (row.status === 'removed' && (row.altCodon !== null || row.refCodon === null)) {
            failSeed(seed, `removed row shape at ${row.codonIndex}`);
          }
        });
      });
    }
  });
});

describe('property: silent-flag soundness', () => {
  it('silent is true iff the aligned codons differ and translate to the same amino acid', () => {
    for (const refCodon of ALL_CODONS) {
      for (const altCodon of ALL_CODONS) {
        const rows = diffSequences(seqFromCodons(['AAA', refCodon, 'TTT']), seqFromCodons(['AAA', altCodon, 'TTT']));
        const mid = rows.find((row) => row.refCodon === refCodon || row.altCodon === altCodon);
        if (refCodon === altCodon) {
          expect(rows.every((row) => row.status === 'same' && row.silent === false)).toBe(true);
          continue;
        }
        const changed = rows.filter((row) => row.status === 'changed');
        expect(changed.length).toBeGreaterThanOrEqual(1);
        for (const row of rows) {
          const sameAa =
            row.refAa !== null && row.altAa !== null && row.refAa === row.altAa;
          const shouldBeSilent =
            row.status === 'changed' &&
            row.refCodon !== null &&
            row.altCodon !== null &&
            row.refCodon !== row.altCodon &&
            sameAa;
          if (row.silent !== shouldBeSilent) {
            throw new Error(
              `silent flag mismatch for ${refCodon}→${altCodon} at row ${row.codonIndex}`,
            );
          }
          if (row.silent) {
            if (row.status !== 'changed') {
              throw new Error(`silent=true but status=${row.status} for ${refCodon}→${altCodon}`);
            }
            if (row.refCodon === row.altCodon) {
              throw new Error(`silent=true but codons identical for ${refCodon}→${altCodon}`);
            }
            if (aminoAcid(row.refCodon ?? '') !== aminoAcid(row.altCodon ?? '')) {
              throw new Error(`silent=true but AAs differ for ${refCodon}→${altCodon}`);
            }
          }
        }
        expect(mid).toBeDefined();
      }
    }
  });

  it('random substitutions agree with translate() on both directions of the silent flag', () => {
    const iterations = 150;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x3000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 3 + pickIndex(rng, 6);
        const codonList = Array.from({ length: n }, () => randomCodon(rng));
        const idx = pickIndex(rng, n);
        const refCodon = codonList[idx];
        if (refCodon === undefined) failSeed(seed, 'missing ref codon');
        let altCodon = randomCodon(rng);
        while (altCodon === refCodon) altCodon = randomCodon(rng);
        const altList = [...codonList];
        altList[idx] = altCodon;
        const rows = diffSequences(seqFromCodons(codonList), seqFromCodons(altList));
        const changed = rows.filter((row) => row.status === 'changed');
        if (changed.length !== 1) {
          failSeed(seed, `expected one changed row, got ${changed.length}`);
        }
        const row = changed[0];
        if (row === undefined) failSeed(seed, 'missing changed row');
        const sameProteinLetter = aminoAcid(refCodon) === aminoAcid(altCodon);
        if (row.silent !== sameProteinLetter) {
          failSeed(
            seed,
            `silent=${String(row.silent)} but aminoAcid(${refCodon})=${aminoAcid(refCodon)} aminoAcid(${altCodon})=${aminoAcid(altCodon)}`,
          );
        }
        if (row.silent) {
          if (translate(refCodon) !== translate(altCodon)) {
            failSeed(seed, 'silent=true but translate() residues differ');
          }
        }
      });
    }
  });
});

describe('property: indel row semantics (SPEC §4.5 #2)', () => {
  it('a unique insertion aligns as one added row and the rest same, including index 1 and the append boundary', () => {
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x4000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 2 + pickIndex(rng, 8);
        const codonList = uniqueCodons(rng, n);
        const inserted = pickOne(
          rng,
          ALL_CODONS.filter((c) => !codonList.includes(c)),
        );
        const at = 1 + pickIndex(rng, n + 1);
        const altList = [...codonList.slice(0, at - 1), inserted, ...codonList.slice(at - 1)];
        const rows = diffSequences(seqFromCodons(codonList), seqFromCodons(altList));
        if (countStatus(rows, 'added') !== 1) {
          failSeed(seed, `added=${countStatus(rows, 'added')} inserting ${inserted} at ${at} into ${codonList.join(',')}`);
        }
        if (countStatus(rows, 'removed') !== 0 || countStatus(rows, 'changed') !== 0) {
          failSeed(
            seed,
            `insertion cascaded as changed/removed: ${rows.map((r) => r.status).join(',')}`,
          );
        }
        if (countStatus(rows, 'same') !== n) {
          failSeed(seed, `same=${countStatus(rows, 'same')} want ${n}`);
        }
        const added = rows.find((row) => row.status === 'added');
        if (added === undefined || added.altCodon !== inserted) {
          failSeed(seed, 'added row does not carry the inserted codon');
        }
        if (added.codonIndex !== at) {
          failSeed(seed, `unique insertion at ${at} aligned to row ${added.codonIndex}`);
        }
      });
    }
  });

  it('a unique deletion aligns as one removed row and later rows return to same, including index 1 and the last codon', () => {
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x5000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 2 + pickIndex(rng, 8);
        const codonList = uniqueCodons(rng, n);
        const at = 1 + pickIndex(rng, n);
        const altList = [...codonList.slice(0, at - 1), ...codonList.slice(at)];
        const rows = diffSequences(seqFromCodons(codonList), seqFromCodons(altList));
        if (countStatus(rows, 'removed') !== 1) {
          failSeed(seed, `removed=${countStatus(rows, 'removed')} deleting index ${at}`);
        }
        if (countStatus(rows, 'added') !== 0 || countStatus(rows, 'changed') !== 0) {
          failSeed(seed, `deletion cascaded: ${rows.map((r) => r.status).join(',')}`);
        }
        if (countStatus(rows, 'same') !== n - 1) {
          failSeed(seed, `same=${countStatus(rows, 'same')} want ${n - 1}`);
        }
        const removed = rows.find((row) => row.status === 'removed');
        if (removed === undefined || removed.codonIndex !== at) {
          failSeed(seed, `unique deletion at ${at} aligned to row ${removed?.codonIndex ?? 'none'}`);
        }
      });
    }
  });

  it('inserting or deleting one codon in a homopolymer run does not cascade as changed', () => {
    const iterations = 40;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x5400 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const hostCodon = randomCodon(rng);
        const n = 3 + pickIndex(rng, 6);
        const host = Array.from({ length: n }, () => hostCodon);
        let inserted = randomCodon(rng);
        while (inserted === hostCodon) inserted = randomCodon(rng);
        const at = 1 + pickIndex(rng, n + 1);
        const altList = [...host.slice(0, at - 1), inserted, ...host.slice(at - 1)];
        const insRows = diffSequences(seqFromCodons(host), seqFromCodons(altList));
        if (countStatus(insRows, 'changed') !== 0 || countStatus(insRows, 'added') !== 1) {
          failSeed(
            seed,
            `homopolymer insert cascaded at ${at}: ${insRows.map((r) => `${r.status}:${r.refCodon ?? '-'}/${r.altCodon ?? '-'}`).join(' ')}`,
          );
        }
        const delAt = 1 + pickIndex(rng, n);
        const deleted = [...host.slice(0, delAt - 1), ...host.slice(delAt)];
        const delRows = diffSequences(seqFromCodons(host), seqFromCodons(deleted));
        if (countStatus(delRows, 'changed') !== 0 || countStatus(delRows, 'removed') !== 1) {
          failSeed(seed, `homopolymer delete cascaded at ${delAt}: ${delRows.map((r) => r.status).join(',')}`);
        }
      });
    }
  });

  it('multi-codon indels of unique blocks realign the flanking sequence as same', () => {
    const iterations = 60;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x5800 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 3 + pickIndex(rng, 6);
        const k = 1 + pickIndex(rng, 3);
        const codonList = uniqueCodons(rng, n + k);
        const host = codonList.slice(0, n);
        const block = codonList.slice(n);
        const at = 1 + pickIndex(rng, n + 1);
        const inserted = [...host.slice(0, at - 1), ...block, ...host.slice(at - 1)];
        const insRows = diffSequences(seqFromCodons(host), seqFromCodons(inserted));
        if (countStatus(insRows, 'added') !== k || countStatus(insRows, 'changed') !== 0) {
          failSeed(seed, `multi-insert cascaded: ${insRows.map((r) => r.status).join(',')}`);
        }
        const deleted = [...host.slice(0, at - 1), ...host.slice(at - 1 + k)];
        if (at - 1 + k <= n) {
          const delRows = diffSequences(seqFromCodons(host), seqFromCodons(deleted));
          if (countStatus(delRows, 'removed') !== k || countStatus(delRows, 'changed') !== 0) {
            failSeed(seed, `multi-delete cascaded: ${delRows.map((r) => r.status).join(',')}`);
          }
        }
      });
    }
  });
});

describe('property: translate (SPEC §4.5 #1)', () => {
  it('emits the first in-frame stop as * and then halts', () => {
    for (const stop of ['TAA', 'TAG', 'TGA'] as const) {
      expect(translate(stop)).toBe('*');
      expect(translate(`ATG${stop}GAA`)).toBe('M*');
      expect(translate(`${stop}ATG`)).toBe('*');
      expect(translate(`ATGATG${stop}ATGATG`)).toBe('MM*');
    }
  });

  it('drops a trailing partial codon instead of emitting a bogus residue', () => {
    expect(translate('')).toBe('');
    expect(translate('A')).toBe('');
    expect(translate('AT')).toBe('');
    expect(translate('ATGG')).toBe('M');
    expect(translate('ATGGA')).toBe('M');
    expect(translate('ATGGAG')).toBe('ME');
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x6000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const codonList = Array.from({ length: 1 + pickIndex(rng, 8) }, () => randomCodon(rng));
        const complete = codonList.join('');
        if (codonList.some((c) => c === 'TAA' || c === 'TAG' || c === 'TGA')) {
          return;
        }
        const extra = pickIndex(rng, 3);
        const tail = extra === 0 ? '' : pickOne(rng, BASES).repeat(extra).slice(0, extra);
        const protein = translate(complete + tail);
        if (protein.length !== codonList.length) {
          failSeed(seed, `protein length ${protein.length} for ${complete + tail}`);
        }
        if (protein.includes('?') || /[^A-Z*]/.test(protein)) {
          failSeed(seed, `bogus residue in ${protein}`);
        }
      });
    }
  });
});

describe('property: applyVariant', () => {
  it('detects a wrong refCodon on substitution and deletion rather than applying silently', () => {
    const iterations = 120;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x7000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 2 + pickIndex(rng, 6);
        const codonList = uniqueCodons(rng, n);
        const at = 1 + pickIndex(rng, n);
        const current = codonList[at - 1];
        if (current === undefined) failSeed(seed, 'missing codon');
        let wrong = randomCodon(rng);
        while (wrong === current) wrong = randomCodon(rng);
        const kind = rng() < 0.5 ? 'substitution' : 'deletion';
        const v = variant({
          kind,
          codonIndex: at,
          refCodon: wrong,
          altCodon: kind === 'deletion' ? '' : randomCodon(rng),
        });
        try {
          applyVariant(seqFromCodons(codonList), v);
          failSeed(seed, `expected refCodon mismatch throw for ${kind} at ${at}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/refCodon mismatch/.test(msg)) {
            failSeed(seed, `wrong error: ${msg}`);
          }
        }
      });
    }
  });

  it('inserts at codonIndex and appends when codonIndex === length + 1 (SPEC §4.5 #6)', () => {
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x8000 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = pickIndex(rng, 8);
        const codonList = n === 0 ? [] : uniqueCodons(rng, n);
        const at = 1 + pickIndex(rng, n + 1);
        const inserted = randomCodon(rng);
        const result = applyVariant(
          seqFromCodons(codonList, 'host'),
          variant({
            kind: 'insertion',
            codonIndex: at,
            refCodon: '',
            altCodon: inserted,
          }),
        );
        const got = codons(result.bases);
        const want = [...codonList.slice(0, at - 1), inserted, ...codonList.slice(at - 1)];
        if (got.join('') !== want.join('')) {
          failSeed(seed, `insert at ${at}: got ${got.join(',')} want ${want.join(',')}`);
        }
      });
    }
  });

  it('substitution and deletion match the 1-based codon-coordinate model', () => {
    const iterations = 80;
    for (let i = 0; i < iterations; i += 1) {
      const seed = 0x8800 + i;
      withSeed(seed, () => {
        const rng = mulberry32(seed);
        const n = 2 + pickIndex(rng, 6);
        const codonList = uniqueCodons(rng, n);
        const at = 1 + pickIndex(rng, n);
        const current = codonList[at - 1];
        if (current === undefined) failSeed(seed, 'missing codon');
        const altCodon = pickOne(
          rng,
          ALL_CODONS.filter((c) => c !== current),
        );
        const sub = applyVariant(
          seqFromCodons(codonList),
          variant({ kind: 'substitution', codonIndex: at, refCodon: current, altCodon }),
        );
        const subWant = [...codonList];
        subWant[at - 1] = altCodon;
        if (codons(sub.bases).join('') !== subWant.join('')) {
          failSeed(seed, `substitution at ${at} drifted`);
        }
        const del = applyVariant(
          seqFromCodons(codonList),
          variant({ kind: 'deletion', codonIndex: at, refCodon: current, altCodon: '' }),
        );
        const delWant = [...codonList.slice(0, at - 1), ...codonList.slice(at)];
        if (codons(del.bases).join('') !== delWant.join('')) {
          failSeed(seed, `deletion at ${at} drifted`);
        }
      });
    }
  });
});

describe('property: robustness of the documented uppercase 5′→3′ contract', () => {
  it('empty sequences diff without throwing and translate to an empty protein', () => {
    expect(translate('')).toBe('');
    expect(codons('')).toEqual([]);
    expect(diffSequences(seq(''), seq(''))).toEqual([]);
    const added = diffSequences(seq(''), seq('ATGAAATTT'));
    expect(added.every((row) => row.status === 'added')).toBe(true);
    expect(added).toHaveLength(3);
  });

  it('lowercase bases are normalised in codon space rather than treated as a distinct alphabet', () => {
    const rows = diffSequences(seq('atggagttt'), seq('ATGGAGTTT'));
    expect(rows.every((row) => row.status === 'same')).toBe(true);
    expect(translate('atgtaa')).toBe('M*');
    const result = applyVariant(seq('atggag'), variant({
      kind: 'substitution',
      codonIndex: 2,
      refCodon: 'gag',
      altCodon: 'gtg',
    }));
    expect(codons(result.bases)).toEqual(['ATG', 'GTG']);
  });

  it('very long in-frame sequences still round-trip through diff and translate', () => {
    const seed = 0x9000;
    withSeed(seed, () => {
      const rng = mulberry32(seed);
      const codonList = Array.from({ length: 120 }, () => randomCodon(rng));
      const bases = codonList.join('');
      expect(codons(bases)).toHaveLength(120);
      const protein = translate(bases);
      expect(protein.length).toBeGreaterThan(0);
      expect(protein.endsWith('*') || !protein.includes('*')).toBe(true);
      const rows = diffSequences(seq(bases), seq(bases));
      expect(rows).toHaveLength(120);
      expect(rows.every((row) => row.status === 'same')).toBe(true);
    });
  });

  it('rejects sequences that are not ACGT (SPEC §4.6 #13)', () => {
    // Halting silently at an unknown codon would drop the trailing CCC of
    // ATGNNNCCC. The policy is to throw, naming the character and offset.
    expect(() => translate('ATGNNNCCC')).toThrow(InvalidBaseError);
    expect(() => diffSequences(seq('ATGNNN'), seq('ATGCCC'))).toThrow(InvalidBaseError);
    try {
      translate('ATGNNNCCC');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBaseError);
      if (!(err instanceof InvalidBaseError)) return;
      expect(err.char).toBe('N');
      expect(err.offset).toBe(3);
      expect(err.message).toContain('"N"');
      expect(err.message).toContain('offset 3');
    }
  });

  it('rejects a trailing partial codon in the diff (SPEC §4.6 #14)', () => {
    // §4.6: a non-multiple-of-3 input is malformed rather than something to
    // carry a leftover 1–2 nt through. Unequal *codon counts* remain supported
    // (indel tests above); it is unequal *remainders* that are refused.
    expect(() => diffSequences(seq('ATGAA'), seq('ATGAA'))).toThrow(PartialCodonError);
    expect(() => diffSequences(seq('ATGAA'), seq('ATGAA'))).toThrow(/multiple of 3/);
    const indel = diffSequences(seq('ATGAAA'), seq('ATGAAACCC'));
    expect(indel.some((row) => row.status === 'added')).toBe(true);
  });

  it('rejects a non-empty refCodon on insertion (SPEC §4.6 #15)', () => {
    // §4.6: insertions are *unvalidated* against the sequence, so this is not
    // a `refCodon mismatch` against the host. A non-empty refCodon must throw
    // so no caller believes a check happened that did not.
    try {
      applyVariant(
        seq('AAATTT'),
        variant({ kind: 'insertion', codonIndex: 1, refCodon: 'GGG', altCodon: 'CCC' }),
      );
      throw new Error('expected insertion with a non-empty refCodon to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InsertionRefCodonError);
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain('GGG');
      expect(msg).not.toMatch(/refCodon mismatch/);
    }
  });
});
