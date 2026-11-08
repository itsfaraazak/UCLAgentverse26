/**
 * Provenance tests: the HBB fixture must stay a faithful slice of the
 * committed NCBI record, and the committed record must stay internally
 * consistent. These are the tests that catch the fixture quietly drifting
 * away from the sequence it claims to be.
 *
 * Nothing here touches the network — the point of committing the record is
 * that the demo works offline. `node scripts/fetch-genome.mjs --check` is the
 * online counterpart, run deliberately rather than in the test suite.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import reference from '../../data/genomes/hbb-nm_000518.5.json';
import { getLocus, translate, codons, referenceSequence } from './index';

const FIRST_31_RESIDUES = 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGR';

describe('committed NM_000518.5 record', () => {
  it('is labelled with reproducible provenance', () => {
    expect(reference.provenance.accession).toBe('NM_000518.5');
    expect(reference.provenance.database).toContain('NCBI');
    expect(reference.provenance.sourceUrl).toContain('efetch.fcgi');
    expect(reference.provenance.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(reference.provenance.retrievedBy).toBe('scripts/fetch-genome.mjs');
    expect(reference.provenance.provenanceLabel).toBe('public-reference');
    // Politeness without personal data: no contact address anywhere in the record.
    expect(JSON.stringify(reference.provenance)).not.toMatch(/@/);
  });

  it('matches its recorded length and digest', () => {
    expect(reference.bases).toHaveLength(628);
    expect(reference.molecule.lengthNt).toBe(reference.bases.length);
    expect(createHash('sha256').update(reference.bases, 'utf8').digest('hex')).toBe(
      reference.molecule.sha256,
    );
  });

  it('is pure ACGT', () => {
    expect(/^[ACGT]+$/.test(reference.bases)).toBe(true);
  });

  it('has a CDS at the recorded offset translating to 147 residues plus a stop', () => {
    const { offset, lengthNt, codonCount, residueCount, protein } = reference.cds;
    expect(offset).toBe(50);
    expect(codonCount).toBe(148);
    expect(residueCount).toBe(147);
    expect(lengthNt).toBe(codonCount * 3);

    const cds = reference.bases.slice(offset, offset + lengthNt);
    expect(translate(cds)).toBe(protein);
    expect(protein.endsWith('*')).toBe(true);
    // The stop is the only one: translation must not terminate early.
    expect(protein.indexOf('*')).toBe(protein.length - 1);
    expect(protein.startsWith(FIRST_31_RESIDUES)).toBe(true);
  });
});

describe('loci.json HBB fixture is a slice of that record', () => {
  it('reproduces the CDS byte for byte', () => {
    const hbb = getLocus('HBB');
    expect(hbb).toBeDefined();
    if (hbb === undefined) return;

    const { accession, cdsOffset, bases, codonCount, startCodon } = hbb.cdsReference;
    expect(accession).toBe(reference.provenance.accession);
    expect(cdsOffset).toBe(reference.cds.offset);
    expect(startCodon).toBe(1);
    expect(codonCount).toBe(reference.cds.codonCount);
    expect(bases).toBe(
      reference.bases.slice(reference.cds.offset, reference.cds.offset + reference.cds.lengthNt),
    );
  });

  it('still carries the region the original hand-typed fixture covered', () => {
    const hbb = getLocus('HBB');
    if (hbb === undefined) throw new Error('HBB locus missing');
    // The old 31-codon / 93-nt fixture is now a prefix of the real CDS. This is
    // the assertion that proves the replacement did not change the demo's subject.
    expect(hbb.cdsReference.bases.slice(0, 93)).toBe(
      'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGG',
    );
    expect(translate(hbb.cdsReference.bases).slice(0, 31)).toBe(FIRST_31_RESIDUES);
  });

  it('keeps codon 7 as the sickle position', () => {
    const hbb = getLocus('HBB');
    if (hbb === undefined) throw new Error('HBB locus missing');
    expect(codons(hbb.cdsReference.bases)[6]).toBe('GAG');
    expect(translate(hbb.cdsReference.bases)[6]).toBe('E');
  });

  it('declares exon spans that cover the whole modelled CDS', () => {
    const hbb = getLocus('HBB');
    if (hbb === undefined) throw new Error('HBB locus missing');
    const exons = hbb.exons;
    expect(exons.map((e) => [e.codonStart, e.codonEnd])).toEqual([
      [1, 30],
      [31, 104],
      [105, 147],
    ]);
    // Contiguous, ascending, and ending at the last coding codon (147); the
    // terminator is codon 148 and is not an annotated residue span.
    for (let i = 1; i < exons.length; i += 1) {
      expect(exons[i].codonStart).toBe(exons[i - 1].codonEnd + 1);
    }
    expect(exons[exons.length - 1].codonEnd).toBe(reference.cds.residueCount);
  });

  it('translates the full reference allele to beta-globin plus a stop', () => {
    const hbb = getLocus('HBB');
    if (hbb === undefined) throw new Error('HBB locus missing');
    const protein = translate(referenceSequence(hbb).bases);
    expect(protein).toHaveLength(148);
    expect(protein).toBe(reference.cds.protein);
  });
});
