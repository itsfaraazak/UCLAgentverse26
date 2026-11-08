import { describe, expect, it } from 'vitest';
import { digestRequest } from '@/lib/safety/policy';
import { needsAcknowledgement, screenUpload } from './screening';

/**
 * The gate for uploads. These tests exist to pin SPEC §7.3 and §7.4: a
 * refused upload must carry no trace of what was submitted, and the gate
 * must not be routable-around.
 */

const SEQUENCE = 'ATGGTGCATCTGACTCCTGAGGAG';

describe('screenUpload — the in-scope case', () => {
  it('accepts a bare sequence once the target locus is supplied', () => {
    const result = screenUpload({ text: SEQUENCE, targetGene: 'HBB' });
    expect(result.accepted).toBe(true);
    expect(result.screening.verdict).toBe('allow');
    expect(result.screening.category).toBe('THERAPEUTIC_SOMATIC');
    expect(result.screening.redacted).toBe(false);
    if (result.accepted) expect(result.text).toBe(SEQUENCE);
  });

  it('passes the locus as a resolved target, which is what keeps a legitimate upload out of OUT_OF_SCOPE', () => {
    // Without a target, policy cannot resolve a curated gene and refuses the
    // request. The component always knows which locus the upload replaces,
    // so supplying it is accurate rather than a way around the gate.
    const withTarget = screenUpload({ text: SEQUENCE, targetGene: 'HBB' });
    expect(withTarget.screening.category).toBe('THERAPEUTIC_SOMATIC');
    expect(withTarget.screening.flaggedGenes).toEqual(['HBB']);
  });

  it('accepts a FASTA header that carries no out-of-scope intent', () => {
    const result = screenUpload({
      text: `>HBB coding region\n${SEQUENCE}`,
      targetGene: 'HBB',
    });
    expect(result.accepted).toBe(true);
    expect(result.screening.verdict).toBe('allow');
  });
});

describe('screenUpload — refusals carry no uploaded text', () => {
  // A sentinel the user "supplied". The policy's own generic reason legitimately
  // contains category vocabulary like "primer", so asserting on cue words would
  // be testing POLICY's prose rather than whether our input leaked.
  const SENTINEL = 'ZZQSENTINELQZZ';
  const refused: ReadonlyArray<[string, string, string]> = [
    [
      'construct design in the header',
      `>HBB primer set ${SENTINEL}\n${SEQUENCE}`,
      'CONSTRUCT_DESIGN_REQUEST',
    ],
    [
      'pathogen phrasing',
      `>increase transmissibility ${SENTINEL}\n${SEQUENCE}`,
      'PATHOGEN_OR_TOXIN_ENHANCEMENT',
    ],
  ];

  for (const [name, text, category] of refused) {
    it(`refuses ${name} and exposes no text field at all`, () => {
      const result = screenUpload({ text, targetGene: 'HBB' });
      expect(result.accepted).toBe(false);
      expect(result.screening.category).toBe(category);
      expect(result.screening.verdict).toBe('block');
      expect(result.screening.redacted).toBe(true);

      // SPEC §7.3 — enforced by the type, so assert it at runtime too:
      // the refused branch has no `text` property, not an emptied one.
      expect('text' in result).toBe(false);

      // Nothing the user submitted appears anywhere in the result: neither
      // the sequence nor the sentinel from their header.
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(SEQUENCE);
      expect(serialised).not.toContain(SENTINEL);
    });
  }

  it('refuses a flagged tumour suppressor target and names only the gene', () => {
    const result = screenUpload({ text: SEQUENCE, targetGene: 'TP53' });
    expect(result.accepted).toBe(false);
    expect(result.screening.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(result.screening.flaggedGenes).toEqual(['TP53']);
    expect('text' in result).toBe(false);
  });

  it('still records a digest, so a refusal is auditable without being stored', () => {
    const result = screenUpload({ text: '>HBB primer set\nATGGTG', targetGene: 'HBB' });
    expect(result.screening.requestDigest).toHaveLength(16);
    // The digest is of the screened subject, never reversible to the text.
    expect(result.screening.requestDigest).toBe(digestRequest('>HBB primer set\nATGGTG'));
  });
});

describe('screenUpload — the filename is user input too', () => {
  it('screens the filename alongside the contents', () => {
    const result = screenUpload({
      text: SEQUENCE,
      targetGene: 'HBB',
      fileName: 'guide rna order.fasta',
    });
    expect(result.accepted).toBe(false);
    expect(result.screening.category).toBe('CONSTRUCT_DESIGN_REQUEST');
  });

  it('sees through filename separators, which plain cue matching would miss', () => {
    // `lib/safety`'s cues are English phrases, so `guide-rna` would otherwise
    // slip past while `guide rna` is caught. Normalising separators makes the
    // gate catch strictly more; it changes no policy.
    for (const fileName of [
      'guide-rna-order.fasta',
      'guide_rna_order.fasta',
      'orders/guide.rna.fasta',
    ]) {
      const result = screenUpload({ text: SEQUENCE, targetGene: 'HBB', fileName });
      expect(result.accepted, fileName).toBe(false);
      expect(result.screening.category, fileName).toBe('CONSTRUCT_DESIGN_REQUEST');
    }
  });

  it('a harmless filename does not change the verdict', () => {
    const result = screenUpload({
      text: SEQUENCE,
      targetGene: 'HBB',
      fileName: 'hbb-cds.fasta',
    });
    expect(result.accepted).toBe(true);
    expect(result.screening.verdict).toBe('allow');
  });
});

describe('screenUpload — escalation never auto-approves', () => {
  it('returns a germline request as accepted-but-flagged, requiring sign-off', () => {
    const result = screenUpload({
      text: '>HBB embryo correction\nATGGTG',
      targetGene: 'HBB',
    });
    expect(result.accepted).toBe(true);
    expect(result.screening.verdict).toBe('escalate');
    expect(result.screening.category).toBe('GERMLINE_HERITABLE');
    expect(result.screening.requiresSignoff).toBe(true);
    expect(result.screening.signoffRole).toBe('institutional_biosafety_committee');
    // SPEC §7.5: a human must act before this is applied.
    expect(needsAcknowledgement(result.screening)).toBe(true);
  });

  it('an allow verdict needs no acknowledgement', () => {
    const result = screenUpload({ text: SEQUENCE, targetGene: 'HBB' });
    expect(needsAcknowledgement(result.screening)).toBe(false);
  });
});
