import { describe, it, expect } from 'vitest';
import {
  screen,
  passesGate,
  lookupLocus,
  digestRequest,
  POLICY,
  FLAGGED_LOCI,
} from './policy';

describe('screen — category ordering', () => {
  it('refuses pathogen/toxin enhancement ahead of everything else', () => {
    // Also mentions a therapeutic target; the most serious category must win.
    const r = screen({ text: 'increase virulence while editing HBB', targets: ['HBB'] });
    expect(r.category).toBe('PATHOGEN_OR_TOXIN_ENHANCEMENT');
    expect(r.verdict).toBe('block');
  });

  it('refuses requests for actionable construct design', () => {
    const r = screen({ text: 'design a guide for this edit', targets: ['HBB'] });
    expect(r.category).toBe('CONSTRUCT_DESIGN_REQUEST');
    expect(r.verdict).toBe('block');
  });

  it('refuses tumour-suppressor disruption regardless of stated purpose', () => {
    const r = screen({ text: 'knock out TP53 to study growth, therapeutic', targets: ['TP53'] });
    expect(r.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(r.verdict).toBe('block');
    expect(r.flaggedGenes).toContain('TP53');
  });

  it('refuses a tumour suppressor even when bundled with an allowed target', () => {
    const r = screen({ text: 'repair HBB and also knock out TP53', targets: ['HBB', 'TP53'] });
    expect(r.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(r.verdict).toBe('block');
  });

  it('escalates heritable modification to a human', () => {
    const r = screen({ text: 'apply this edit in the embryo', targets: ['HBB'] });
    expect(r.category).toBe('GERMLINE_HERITABLE');
    expect(r.verdict).toBe('escalate');
    expect(r.requiresSignoff).toBe(true);
    expect(r.signoffRole).toBe('institutional_biosafety_committee');
  });

  it('escalates a germline-sensitive locus even in somatic framing', () => {
    const r = screen({ text: 'somatic edit only', targets: ['CCR5'] });
    expect(r.category).toBe('GERMLINE_HERITABLE');
    expect(r.verdict).toBe('escalate');
  });

  it('escalates multiplex edits with no stated rationale', () => {
    const r = screen({ text: 'edit both of these', targets: ['HBB', 'HBG1'] });
    expect(r.category).toBe('MULTIPLEX_UNJUSTIFIED');
    expect(r.verdict).toBe('escalate');
  });

  it('allows a multiplex edit once a rationale is given', () => {
    const r = screen({
      text: 'edit both in order to correct the beta-globin defect',
      targets: ['HBB', 'HBG1'],
    });
    expect(r.category).toBe('THERAPEUTIC_SOMATIC');
    expect(r.verdict).toBe('allow');
  });

  it('allows the in-scope somatic therapeutic case', () => {
    const r = screen({ text: 'repair the sickle substitution to treat the patient', targets: ['HBB'] });
    expect(r.category).toBe('THERAPEUTIC_SOMATIC');
    expect(passesGate(r)).toBe(true);
  });

  it('blocks anything with no resolvable curated target', () => {
    const r = screen({ text: 'make the cell better somehow' });
    expect(r.category).toBe('OUT_OF_SCOPE');
    expect(r.verdict).toBe('block');
  });
});

describe('redaction — refused input must not be retained', () => {
  it('marks every block verdict as redacted', () => {
    const blocked = [
      screen({ text: 'gain of function work' }),
      screen({ text: 'design a guide', targets: ['HBB'] }),
      screen({ text: 'disable BRCA1', targets: ['BRCA1'] }),
      screen({ text: 'nonsense' }),
    ];
    for (const r of blocked) {
      expect(r.verdict).toBe('block');
      expect(r.redacted).toBe(true);
    }
  });

  it('never templates the request text into the reason', () => {
    const marker = 'zzz-unique-marker-zzz';
    const r = screen({ text: `weaponise something ${marker}` });
    expect(r.reason).not.toContain(marker);
    expect(JSON.stringify(r)).not.toContain(marker);
  });

  it('carries a stable digest instead of the request', () => {
    const a = screen({ text: 'toxin work' });
    const b = screen({ text: 'toxin work' });
    expect(a.requestDigest).toBe(b.requestDigest);
    expect(a.requestDigest).toHaveLength(16);
    expect(screen({ text: 'toxin work!' }).requestDigest).not.toBe(a.requestDigest);
  });

  it('digests are one-way and fixed-width', () => {
    expect(digestRequest('')).toHaveLength(16);
    expect(digestRequest('a')).not.toBe(digestRequest('b'));
  });
});

describe('policy table invariants', () => {
  it('is frozen against mutation at runtime', () => {
    expect(Object.isFrozen(POLICY)).toBe(true);
    expect(Object.isFrozen(FLAGGED_LOCI)).toBe(true);
  });

  it('only the therapeutic category is ever allowed', () => {
    const allowed = Object.values(POLICY).filter((r) => r.verdict === 'allow');
    expect(allowed.map((r) => r.category)).toEqual(['THERAPEUTIC_SOMATIC']);
  });

  it('every escalation names a sign-off role', () => {
    for (const rule of Object.values(POLICY)) {
      if (rule.verdict === 'escalate') {
        expect(rule.requiresSignoff).toBe(true);
        expect(rule.signoffRole).toBeTruthy();
      }
    }
  });

  it('passesGate is true only for allow', () => {
    for (const rule of Object.values(POLICY)) {
      const synthetic = { ...rule, flaggedGenes: [], requestDigest: 'x', redacted: false };
      expect(passesGate(synthetic)).toBe(rule.verdict === 'allow');
    }
  });

  it('retains the tumour suppressors the policy depends on', () => {
    for (const gene of ['TP53', 'RB1', 'BRCA1', 'BRCA2', 'PTEN', 'APC']) {
      expect(lookupLocus(gene)?.classification).toBe('tumour_suppressor');
    }
  });

  it('resolves gene symbols case- and whitespace-insensitively', () => {
    expect(lookupLocus('  tp53 ')?.gene).toBe('TP53');
    expect(lookupLocus('nope')).toBeUndefined();
  });
});
