import { describe, expect, it } from 'vitest';
import { InvalidBaseError, PartialCodonError, getLocus, referenceSequence } from '@/lib/genome';
import type { Sequence } from '@/lib/genome';
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

describe('buildLocusModel — HBB_HbS from loci.json', () => {
  it('builds the sickle substitution with the verified fixture facts', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });

    expect(model.gene).toBe('HBB');
    expect(model.modelledCodonCount).toBe(31);
    expect(model.totalCodonCount).toBe(147);
    expect(model.editedCodonIndices).toEqual([7]);
    expect(model.primaryEditedCodon).toBe(7);
    expect(model.coordinatesDiverge).toBe(false);
    expect(model.refProtein).toBe('MVHLTPEEKSAVTALWGKVNVDEVGGEALGR');
    expect(model.altProtein).toBe('MVHLTPVEKSAVTALWGKVNVDEVGGEALGR');
  });

  it('emits one segment per annotated codon, 1-based and gapless', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });

    expect(model.segments).toHaveLength(model.totalCodonCount);
    expect(model.segments.map((segment) => segment.codonIndex)).toEqual(
      Array.from({ length: 147 }, (_, i) => i + 1),
    );
  });

  it('never invents bases past the 31 modelled codons', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const modelled = model.segments.filter((segment) => segment.modelled);
    const unsequenced = model.segments.filter((segment) => !segment.modelled);

    expect(modelled).toHaveLength(31);
    expect(unsequenced).toHaveLength(116);

    for (const segment of unsequenced) {
      expect(segment.status).toBe('unsequenced');
      expect(segment.refCodon).toBe(null);
      expect(segment.altCodon).toBe(null);
      expect(segment.refAa).toBe(null);
      expect(segment.altAa).toBe(null);
      expect(segment.modelled).toBe(false);
    }
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

  it('leaves codon 40 unsequenced in exon 2 and codon 147 in exon 3', () => {
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    const codon40 = segmentAt(model, 40);
    if (codon40 === undefined) return;

    expect(codon40).toEqual({
      codonIndex: 40,
      refCodon: null,
      altCodon: null,
      refAa: null,
      altAa: null,
      status: 'unsequenced',
      silent: false,
      modelled: false,
      exonIndex: 2,
    });

    const codon147 = segmentAt(model, 147);
    if (codon147 === undefined) return;
    expect(codon147.exonIndex).toBe(3);
    expect(codon147.status).toBe('unsequenced');
    expect(codon147.modelled).toBe(false);
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
    expect(summary).toContain('31 codons modelled of 147 annotated for this locus');
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
    const model = buildLocusModel({ variantId: 'HBB_HbS' });
    expect(model.coordinatesDiverge).toBe(false);
    expect(model.segments[0]?.exonIndex).toBe(1);
    expect(model.segments[39]?.exonIndex).toBe(2);
    expect(model.segments[146]?.exonIndex).toBe(3);
  });
});
