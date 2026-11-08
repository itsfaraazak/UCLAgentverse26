import { describe, expect, it } from 'vitest';
import { InvalidBaseError, PartialCodonError, getLocus, referenceSequence } from '@/lib/genome';
import type { Locus, Sequence } from '@/lib/genome';
import {
  UnknownLocusError,
  buildGenomeModel,
  buildLocusModel,
  describeEdit,
  structuralSummary,
  type CodonSegment,
  type GenomeModel,
} from './model';

function seq(bases: string, label = 'test'): Sequence {
  return { bases, label };
}

function segmentAt(model: GenomeModel, codonIndex: number): CodonSegment | undefined {
  const segment = model.segments.find((row) => row.codonIndex === codonIndex);
  expect(segment).toBeDefined();
  return segment;
}

function hbbLocus(): Locus {
  const locus = getLocus('HBB');
  if (locus === undefined) throw new Error('loci.json has no HBB locus');
  return locus;
}

/** Extent facts read from the fixture, so a sequence update cannot strand them. */
function extentOf(locus: Locus) {
  const modelled = locus.cdsReference.codonCount;
  const annotatedEnd = Math.max(...locus.exons.map((e) => e.codonEnd));
  return { modelled, annotatedEnd, expectedTotal: Math.max(modelled, annotatedEnd) };
}

function exonContaining(locus: Locus, codonIndex: number): number | null {
  const exon = locus.exons.find((e) => codonIndex >= e.codonStart && codonIndex <= e.codonEnd);
  return exon === undefined ? null : exon.index;
}

function expectStructurallySound(model: GenomeModel): void {
  expect(model.segments).toHaveLength(model.totalCodonCount);
  expect(model.segments.map((segment) => segment.codonIndex)).toEqual(
    Array.from({ length: model.totalCodonCount }, (_, i) => i + 1),
  );
  expect(model.segments.filter((segment) => segment.modelled)).toHaveLength(
    model.modelledCodonCount,
  );
}

describe('buildLocusModel — HBB_HbS from loci.json', () => {
  it('builds the sickle substitution with the verified fixture facts', () => {
    const locus = hbbLocus();
    const { modelled, expectedTotal } = extentOf(locus);
    const model = buildLocusModel({ variantId: 'HBB_HbS' });

    expect(model.gene).toBe('HBB');
    expect(model.modelledCodonCount).toBe(modelled);
    expect(model.totalCodonCount).toBe(expectedTotal);
    expect(model.editedCodonIndices).toEqual([7]);
    expect(model.primaryEditedCodon).toBe(7);
    expect(model.coordinatesDiverge).toBe(false);
    expect(model.refProtein.startsWith('MVHLTPEEKSAVTALWGKVNVDEVGGEALGR')).toBe(true);
    expect(model.altProtein.startsWith('MVHLTPVEKSAVTALWGKVNVDEVGGEALGR')).toBe(true);

    // A substitution: same length, differing at residue 7 and nowhere else.
    expect(model.altProtein).toHaveLength(model.refProtein.length);
    const differingResidues = [...model.refProtein]
      .map((aa, i) => (aa === model.altProtein[i] ? null : i + 1))
      .filter((residue) => residue !== null);
    expect(differingResidues).toEqual([7]);
    expect(model.refProtein[6]).toBe('E');
    expect(model.altProtein[6]).toBe('V');
  });

  it('emits one segment per annotated codon, 1-based and gapless', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    expectStructurallySound(model);
  });

  it('models every codon of the current HBB fixture: zero unsequenced codons', () => {
    const { modelled, annotatedEnd } = extentOf(hbbLocus());
    const model = buildLocusModel({ variantId: 'HBB_HbS' });

    // The fixture carries the full CDS, so it reaches at least as far as the annotation.
    expect(modelled).toBeGreaterThanOrEqual(annotatedEnd);
    expect(model.segments.filter((segment) => segment.status === 'unsequenced')).toEqual([]);
    for (const segment of model.segments) {
      expect(segment.modelled).toBe(true);
      expect(segment.refCodon).not.toBeNull();
      expect(segment.altCodon).not.toBeNull();
    }
    // A full CDS ends in its terminator.
    expect(model.segments.at(-1)?.refAa).toBe('*');
  });

  it('never invents bases past the modelled codons', () => {
    const ref = seq('ATGGAGAAACCC', 'ref');
    const alt = seq('ATGGTGAAACCT', 'alt');
    const model = buildGenomeModel({ ref, alt, totalCodonCount: 20 });

    expect(model.modelledCodonCount).toBe(4);
    expect(model.totalCodonCount).toBe(20);
    expectStructurallySound(model);

    const real = model.segments.slice(0, model.modelledCodonCount);
    expect(real.map((segment) => [segment.refCodon, segment.altCodon])).toEqual([
      ['ATG', 'ATG'],
      ['GAG', 'GTG'],
      ['AAA', 'AAA'],
      ['CCC', 'CCT'],
    ]);
    expect(real.map((segment) => segment.status)).toEqual(['same', 'changed', 'same', 'changed']);
    expect(real.every((segment) => segment.modelled)).toBe(true);
    expect(model.editedCodonIndices).toEqual([2, 4]);

    const unsequenced = model.segments.slice(model.modelledCodonCount);
    expect(unsequenced).toHaveLength(model.totalCodonCount - model.modelledCodonCount);
    for (const segment of unsequenced) {
      expect(segment).toEqual({
        codonIndex: segment.codonIndex,
        refCodon: null,
        altCodon: null,
        refAa: null,
        altAa: null,
        status: 'unsequenced',
        silent: false,
        modelled: false,
        exonIndex: null,
      });
    }
    expect(structuralSummary(model)).toContain('4 codons modelled of 20 annotated for this locus');
  });

  it('never lets the override shrink the drawn extent below the modelled codons', () => {
    const model = buildGenomeModel({
      ref: seq('ATGGAGAAA', 'ref'),
      alt: seq('ATGGTGAAA', 'alt'),
      totalCodonCount: 1,
    });
    expect(model.totalCodonCount).toBe(model.modelledCodonCount);
    expect(model.segments.some((segment) => segment.status === 'unsequenced')).toBe(false);
  });

  it('describes codon 7 as the missense GAG→GTG / E→V change', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const codon7 = segmentAt(model, 7);
    if (codon7 === undefined) return;

    expect(codon7).toEqual({
      codonIndex: 7,
      refCodon: 'GAG',
      altCodon: 'GTG',
      refAa: 'E',
      altAa: 'V',
      status: 'changed',
      silent: false,
      modelled: true,
      exonIndex: 1,
    });
  });

  it('attributes unsequenced codons to their annotated exon when the sequence stops short', () => {
    const locus = hbbLocus();
    const { annotatedEnd } = extentOf(locus);
    const firstExon = locus.exons.find((e) => e.index === 1);
    expect(firstExon).toBeDefined();
    if (firstExon === undefined) return;

    // Only exon 1 sequenced: the rest of the annotated locus has no bases.
    const truncatedCodons = firstExon.codonEnd;
    const ref = seq(referenceSequence(locus).bases.slice(0, truncatedCodons * 3), 'ref');
    const model = buildGenomeModel({ ref, alt: ref, locus });

    expect(model.modelledCodonCount).toBe(truncatedCodons);
    expect(model.totalCodonCount).toBe(annotatedEnd);
    expectStructurallySound(model);

    const unsequenced = model.segments.filter((segment) => segment.status === 'unsequenced');
    expect(unsequenced).toHaveLength(model.totalCodonCount - model.modelledCodonCount);
    expect(unsequenced[0]?.codonIndex).toBe(truncatedCodons + 1);
    for (const segment of unsequenced) {
      expect(segment.modelled).toBe(false);
      expect(segment.refCodon).toBeNull();
      expect(segment.altCodon).toBeNull();
      expect(segment.refAa).toBeNull();
      expect(segment.altAa).toBeNull();
      expect(segment.exonIndex).toBe(exonContaining(locus, segment.codonIndex));
    }
    // The tail spans every later exon, through to the last annotated codon.
    expect(new Set(unsequenced.map((segment) => segment.exonIndex))).toEqual(
      new Set(locus.exons.filter((e) => e.index !== 1).map((e) => e.index)),
    );
  });
});

describe('buildLocusModel — HBB_silent_demo', () => {
  it('is silent: DNA changes, amino acid does not', () => {
    const model = buildLocusModel({ variantId: 'HBB_silent_demo' });
    expect(model.editedCodonIndices).toEqual([5]);
    expect(model.primaryEditedCodon).toBe(5);
    expect(model.coordinatesDiverge).toBe(false);

    const codon5 = segmentAt(model, 5);
    if (codon5 === undefined) return;
    expect(codon5.refCodon).toBe('ACT');
    expect(codon5.altCodon).toBe('ACC');
    expect(codon5.refAa).toBe('T');
    expect(codon5.altAa).toBe('T');
    expect(codon5.refAa).toBe(codon5.altAa);
    expect(codon5.silent).toBe(true);
    expect(codon5.status).toBe('changed');
    expect(codon5.modelled).toBe(true);
  });
});

describe('buildLocusModel — unknown identifiers', () => {
  it('throws UnknownLocusError for an unknown gene rather than falling back', () => {
    try {
      buildLocusModel({ gene: 'NOT_A_GENE' });
      throw new Error('expected UnknownLocusError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownLocusError);
      if (!(err instanceof UnknownLocusError)) return;
      expect(err.name).toBe('UnknownLocusError');
      expect(err.message).toContain('NOT_A_GENE');
    }
  });

  it('throws UnknownLocusError for an unknown variantId rather than falling back', () => {
    try {
      buildLocusModel({ gene: 'HBB', variantId: 'HBB_does_not_exist' });
      throw new Error('expected UnknownLocusError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownLocusError);
      if (!(err instanceof UnknownLocusError)) return;
      expect(err.name).toBe('UnknownLocusError');
      expect(err.message).toContain('HBB_does_not_exist');
    }
  });
});

describe('buildGenomeModel — ad-hoc sequences', () => {
  it('diffs two equal-length sequences with no locus annotation', () => {
    const model = buildGenomeModel({
      ref: seq('ATGGAGAAA', 'ref'),
      alt: seq('ATGGTGAAA', 'alt'),
    });

    expect(model.gene).toBe('uploaded');
    expect(model.locusName).toBe(null);
    expect(model.chromosome).toBe(null);
    expect(model.annotation).toBe(null);
    expect(model.limitation).toBe(null);
    expect(model.totalCodonCount).toBe(3);
    expect(model.modelledCodonCount).toBe(3);
    expect(model.coordinatesDiverge).toBe(false);
    expect(model.segments.map((segment) => segment.status)).toEqual([
      'same',
      'changed',
      'same',
    ]);
    expect(model.editedCodonIndices).toEqual([2]);
    expect(model.primaryEditedCodon).toBe(2);
    expect(model.segments.every((segment) => segment.exonIndex === null)).toBe(true);
  });
});

describe('indel coordinate honesty (SPEC §4.5 #2)', () => {
  it('marks an inserted codon as added and treats later indices as alignment rows', () => {
    const model = buildGenomeModel({
      ref: seq('ATGAAACCC', 'ref'),
      alt: seq('ATGAAAGGGCCC', 'alt'),
    });

    expect(model.coordinatesDiverge).toBe(true);
    expect(model.segments.map((segment) => segment.status)).toEqual([
      'same',
      'same',
      'added',
      'same',
    ]);
    expect(model.editedCodonIndices).toEqual([3]);

    const summary = structuralSummary(model);
    expect(summary).toContain(
      'positions after it are alignment rows, not CDS codon numbers',
    );
    expect(summary.includes('..')).toBe(false);
  });

  it('marks a deleted codon as removed and still diverges coordinates', () => {
    const model = buildGenomeModel({
      ref: seq('ATGAAACCC', 'ref'),
      alt: seq('ATGCCC', 'alt'),
    });

    expect(model.coordinatesDiverge).toBe(true);
    expect(model.segments.some((segment) => segment.status === 'removed')).toBe(true);
    expect(structuralSummary(model)).toContain('alignment rows');
  });
});

describe('malformed input propagates lib/genome errors unchanged', () => {
  it('throws InvalidBaseError with char and offset for a non-ACGT base', () => {
    try {
      buildGenomeModel({
        ref: seq('ATGXAA', 'ref'),
        alt: seq('ATGAAA', 'alt'),
      });
      throw new Error('expected InvalidBaseError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBaseError);
      if (!(err instanceof InvalidBaseError)) return;
      expect(err.char).toBe('X');
      expect(err.offset).toBe(3);
    }
  });

  it('throws PartialCodonError when a sequence length is not a multiple of 3', () => {
    try {
      buildGenomeModel({
        ref: seq('ATGAA', 'short-ref'),
        alt: seq('ATGAAA', 'alt'),
      });
      throw new Error('expected PartialCodonError');
    } catch (err) {
      expect(err).toBeInstanceOf(PartialCodonError);
      if (!(err instanceof PartialCodonError)) return;
      expect(err.length).toBe(5);
      expect(err.label).toBe('short-ref');
    }
  });
});

describe('describeEdit and structuralSummary', () => {
  it('describes the HbS substitution and surfaces the fixture structural summary', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    expect(describeEdit(model)).toBe('HBB: GAG to GTG at codon 7 (E to V)');

    const summary = structuralSummary(model);
    expect(summary).toContain(
      'A negatively charged, hydrophilic surface residue is replaced by a small hydrophobic one',
    );
    const { modelled, expectedTotal } = extentOf(hbbLocus());
    expect(summary).toContain(`${modelled} codons modelled`);
    // "of N annotated" appears only when the annotation outruns the sequence.
    expect(summary.includes('annotated for this locus')).toBe(expectedTotal > modelled);
    expect(summary.includes('..')).toBe(false);
    expect(summary.endsWith('.')).toBe(true);
  });

  it('describes the silent case as unchanged amino acid', () => {
    const model = buildLocusModel({ variantId: 'HBB_silent_demo' });
    expect(describeEdit(model)).toBe(
      'HBB: ACT to ACC at codon 5, amino acid unchanged (T)',
    );

    const summary = structuralSummary(model);
    expect(summary).toContain('Synonymous substitution; no amino-acid change');
    expect(summary.includes('..')).toBe(false);
  });

  it('describes identical sequences as no codon differing, with a null primary edit', () => {
    const model = buildGenomeModel({
      ref: seq('ATGGAGAAA', 'ref'),
      alt: seq('ATGGAGAAA', 'alt'),
    });
    expect(model.primaryEditedCodon).toBe(null);
    expect(model.editedCodonIndices).toEqual([]);
    expect(describeEdit(model)).toBe(
      'uploaded: no codon differs between the two sequences',
    );

    const summary = structuralSummary(model);
    expect(summary.includes('..')).toBe(false);
    expect(summary.startsWith('uploaded: no codon differs between the two sequences.')).toBe(
      true,
    );
  });
});

describe('preferredCodonIndex', () => {
  it('is honoured only when that codon actually changed', () => {
    const input = {
      ref: seq('ATGGAGAAA', 'ref'),
      alt: seq('ATGGTGAAG', 'alt'),
    };
    const unchanged = buildGenomeModel({ ...input, preferredCodonIndex: 1 });
    expect(unchanged.editedCodonIndices).toEqual([2, 3]);
    expect(unchanged.primaryEditedCodon).toBe(2);

    const honoured = buildGenomeModel({ ...input, preferredCodonIndex: 3 });
    expect(honoured.primaryEditedCodon).toBe(3);

    const identical = buildGenomeModel({
      ref: seq('ATGGAGAAA', 'ref'),
      alt: seq('ATGGAGAAA', 'alt'),
      preferredCodonIndex: 2,
    });
    expect(identical.primaryEditedCodon).toBe(null);
  });
});

describe('exon attribution stops at an indel', () => {
  it('reports no exon for rows past the first indel, rather than a wrong one', () => {
    const locus = getLocus('HBB');
    expect(locus).toBeDefined();
    if (locus === undefined) return;

    const ref = referenceSequence(locus);
    // Delete codon 3: every later row is an alignment row, not a CDS codon.
    const codonList = ref.bases.match(/.{3}/g) ?? [];
    const alt = {
      bases: [...codonList.slice(0, 2), ...codonList.slice(3)].join(''),
      label: 'deletion',
    };

    const model = buildGenomeModel({ ref, alt, locus });
    expect(model.coordinatesDiverge).toBe(true);

    const indelAt = model.segments.findIndex(
      (s) => s.status === 'added' || s.status === 'removed',
    );
    expect(indelAt).toBeGreaterThan(0);

    // Before the indel the coordinate is still a real CDS codon.
    expect(model.segments[0]?.exonIndex).toBe(1);
    // From the indel onward we decline to name an exon.
    for (const segment of model.segments.slice(indelAt)) {
      expect(segment.exonIndex).toBeNull();
    }
  });

  it('still attributes exons normally when nothing shifted', () => {
    const locus = hbbLocus();
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    expect(model.coordinatesDiverge).toBe(false);
    expect(model.segments[0]?.exonIndex).toBe(1);
    expect(model.segments[39]?.exonIndex).toBe(2);
    expect(model.segments[146]?.exonIndex).toBe(3);
    for (const segment of model.segments) {
      expect(segment.exonIndex).toBe(exonContaining(locus, segment.codonIndex));
    }
  });

  it('reports no exon for modelled codons past the last annotated exon', () => {
    const locus = hbbLocus();
    const { modelled, annotatedEnd } = extentOf(locus);
    const model = buildLocusModel({ variantId: 'HBB_HbS' });

    const beyond = model.segments.filter((segment) => segment.codonIndex > annotatedEnd);
    expect(beyond).toHaveLength(Math.max(0, modelled - annotatedEnd));
    for (const segment of beyond) {
      expect(segment.modelled).toBe(true);
      expect(segment.exonIndex).toBeNull();
    }
  });
});
