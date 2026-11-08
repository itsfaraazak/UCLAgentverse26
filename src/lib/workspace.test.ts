import { describe, expect, it } from 'vitest';

import { buildWorkspace } from './workspace';

describe('buildWorkspace', () => {
  const ws = buildWorkspace();

  it('is deterministic — the same fixture produces the same oids', () => {
    const again = buildWorkspace();
    expect(ws.branches.map((b) => b.headOid)).toEqual(again.branches.map((b) => b.headOid));
  });

  it('builds four real branches with the DAG shape implied by depth', () => {
    expect(ws.branches.map((b) => b.name)).toEqual([
      'main',
      'patient/hbss-baseline',
      'edit/hbb-codon7-repair',
      'edit/hbb-silent-probe',
    ]);
    expect(ws.branches.map((b) => b.depth)).toEqual([0, 1, 2, 2]);
    expect(ws.branches[0].baseBranch).toBeNull();
    expect(ws.branches[2].baseBranch).toBe('patient/hbss-baseline');
  });

  it('gives each branch a commit history reaching back to the root', () => {
    const repair = ws.branches.find((b) => b.name === 'edit/hbb-codon7-repair');
    expect(repair?.commits).toHaveLength(3);
    expect(repair?.commits.at(-1)?.parents).toEqual([]);
    expect(repair?.headShort).toHaveLength(12);
  });

  it('diffs the repair branch against its own base, showing one changed codon', () => {
    const repair = ws.branches.find((b) => b.name === 'edit/hbb-codon7-repair');
    const changed = repair?.diff.filter((r) => r.status !== 'same') ?? [];
    expect(changed).toHaveLength(1);
    expect(changed[0].codonIndex).toBe(7);
    expect(changed[0].refAa).toBe('V');
    expect(changed[0].altAa).toBe('E');
    expect(changed[0].silent).toBe(false);
  });

  it('marks the synthetic probe branch as a silent change', () => {
    const probe = ws.branches.find((b) => b.name === 'edit/hbb-silent-probe');
    const changed = probe?.diff.filter((r) => r.status !== 'same') ?? [];
    expect(changed).toHaveLength(1);
    expect(changed[0].codonIndex).toBe(5);
    expect(changed[0].silent).toBe(true);
  });

  it('carries the fixture genotype tendencies through, not invented ones', () => {
    const byName = new Map(ws.branches.map((b) => [b.name, b.polymerizationTendency]));
    expect(byName.get('main')).toBe(0);
    expect(byName.get('patient/hbss-baseline')).toBe(0.85);
    expect(byName.get('edit/hbb-codon7-repair')).toBe(0.05);
    // The silent probe is not a named genotype: the baseline lesion persists.
    expect(byName.get('edit/hbb-silent-probe')).toBe(0.85);
  });

  it('surfaces the fixture disclaimers for the UI to render', () => {
    expect(ws.fixtureDisclaimer).toContain('No real patient data');
    expect(ws.simulationNote).toContain('illustrative');
  });

  it('reports the modelled region and the wider locus honestly', () => {
    // `modelledCodonCount` is derived from the sequence and `declaredCodonCount`
    // is read from the fixture, so this asserts the two agree rather than
    // trusting either alone. 31 codons / 93 nt (SPEC §4.5 #7).
    expect(ws.modelledCodonCount).toBe(31);
    expect(ws.declaredCodonCount).toBe(31);
    expect(ws.totalCodonCount).toBe(147);
    expect(ws.exons).toHaveLength(3);
  });
});
