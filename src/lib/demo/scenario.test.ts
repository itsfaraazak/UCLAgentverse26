import { describe, expect, it } from 'vitest';
import {
  attemptMerge,
  buildScenario,
  resolveSignoff,
  runProposal,
  tendencyForSequence,
} from './scenario';
import { requireLocus, requireVariant } from '@/lib/fixtures/loci';
import { applyVariant } from '@/lib/genome';
import { PIPELINE } from '@/lib/agents';
import type { ScenarioView } from './view';

const scenario = buildScenario();
const view: ScenarioView = scenario.view;

/** A sign-off as the client may send it: a signer, and no role. */
const SIGNOFF_ESCALATED = {
  branch: 'escalate/germline-inherited-repair',
  by: 'ibc.chair@sigmafold.example',
} as const;

function branch(name: string) {
  const found = view.branches.find((b) => b.name === name);
  if (found === undefined) throw new Error(`no branch ${name}`);
  return found;
}

function commitAt(name: string) {
  const tip = branch(name).tip;
  const found = view.commits.find((c) => c.oid === tip);
  if (found === undefined) throw new Error(`no commit for ${name}`);
  return found;
}

/**
 * Fragments that appear ONLY inside the request texts the demo feeds to the
 * gate — never in an authored commit message. If any of these turns up in the
 * serialized view, a request has leaked out of the safety boundary.
 */
const REQUEST_FRAGMENTS = [
  'Disrupt TP53',
  'proliferation dynamics',
  'cell line',
  'in embryos',
  'future generations',
  'passed to',
  'diffed against',
  'downstream somatic analysis',
  'in order to correct',
  'working baseline so',
];

describe('scenario structure', () => {
  it('builds a history with a root, five side branches and a real merge commit', () => {
    expect(view.commits.some((c) => c.isRoot)).toBe(true);
    expect(view.commits.filter((c) => c.isMerge)).toHaveLength(1);
    expect(view.branches.map((b) => b.name)).toEqual([
      'main',
      'escalate/germline-inherited-repair',
      'experiment/silent-marker',
      'fix/hbb-codon7',
      'refused/tp53-disruption',
      'review/marker-on-repair',
    ]);
  });

  it('keeps main in lane 0 and gives every open tip its own lane', () => {
    const nodeOf = (oid: string) => {
      const node = view.graph.nodes.find((n) => n.oid === oid);
      if (node === undefined) throw new Error(`no node ${oid}`);
      return node;
    };
    expect(nodeOf(branch('main').tip).lane).toBe(0);
    const sideTips = view.branches.filter((b) => !b.isHead).map((b) => nodeOf(b.tip).lane);
    expect(new Set(sideTips).size).toBe(sideTips.length);
    expect(sideTips).not.toContain(0);
  });

  it('is deterministic — the same inputs produce the same oids', () => {
    expect(buildScenario().view).toEqual(view);
  });

  it('resolves every layout node to a commit and every edge to real ancestry', () => {
    const oids = new Set(view.commits.map((c) => c.oid));
    expect(view.graph.nodes).toHaveLength(view.commits.length);
    for (const edge of view.graph.edges) {
      expect(oids.has(edge.from)).toBe(true);
      expect(oids.has(edge.to)).toBe(true);
      const child = view.commits.find((c) => c.oid === edge.from);
      expect(child?.parents).toContain(edge.to);
    }
  });

  it('gives the accessible description one line per commit, carrying the verdict', () => {
    expect(view.graph.description).toHaveLength(view.commits.length);
    expect(view.graph.description.join('\n')).toContain('Agent check verdict');
    expect(view.graph.description[0]).toContain('Row 1 of');
  });
});

describe('the biosafety gate is structural', () => {
  it('runs the gate at step 2 of 7 on every run', () => {
    expect(PIPELINE[1].agent).toBe('BiosafetyGateAgent');
    for (const commit of view.commits) {
      if (commit.run === null) continue;
      expect(commit.run.checks).toHaveLength(7);
      expect(commit.run.checks[1].agent).toBe('BiosafetyGateAgent');
      expect(commit.run.checks[1].step).toBe(2);
    }
  });

  it('terminates a blocked run at the gate, skipping steps 3 to 7', () => {
    const refused = commitAt('refused/tp53-disruption');
    expect(refused.run?.verdict).toBe('blocked');
    expect(refused.run?.policy.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(refused.run?.checks[1].status).toBe('blocked');
    for (const check of refused.run?.checks.slice(2) ?? []) {
      expect(check.status).toBe('skipped');
      expect(check.deltaId).toBeNull();
    }
  });

  it('computes no numbers at all for a blocked run', () => {
    const refused = commitAt('refused/tp53-disruption');
    expect(refused.run?.metrics).toBeNull();
    expect(refused.run?.limitation).toBeNull();
    expect(refused.edit).toBeNull();
  });

  it('leaves a blocked commit genotype-identical to its parent', () => {
    const refused = commitAt('refused/tp53-disruption');
    const parent = view.commits.find((c) => c.oid === refused.parents[0]);
    expect(refused.genotype.bases).toBe(parent?.genotype.bases);
  });

  it('escalates a heritable proposal rather than allowing or blocking it', () => {
    const escalated = commitAt('escalate/germline-inherited-repair');
    expect(escalated.run?.policy.category).toBe('GERMLINE_HERITABLE');
    expect(escalated.run?.verdict).toBe('escalated');
    expect(escalated.run?.policy.requiresSignoff).toBe(true);
    expect(escalated.run?.policy.signoffRole).toBe('institutional_biosafety_committee');
  });

  it('allows the in-scope somatic repair', () => {
    const fix = commitAt('fix/hbb-codon7');
    expect(fix.run?.policy.category).toBe('THERAPEUTIC_SOMATIC');
    expect(fix.run?.verdict).toBe('pass');
    expect(fix.run?.mergeBlockedReason).toBeNull();
  });
});

describe('no refused request text escapes', () => {
  const serialized = JSON.stringify(view);

  it('never puts any request text into the view model', () => {
    for (const fragment of REQUEST_FRAGMENTS) {
      expect(serialized.toLowerCase()).not.toContain(fragment.toLowerCase());
    }
  });

  it('names only the policy category in a refused commit message', () => {
    const refused = commitAt('refused/tp53-disruption');
    expect(refused.message).toContain('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(refused.message).toContain('request text not retained');
    // The category name legitimately contains "DISRUPTION"; the request's own
    // wording must not appear.
    expect(refused.message.toLowerCase()).not.toContain('disrupt tp53');
    expect(refused.message.toLowerCase()).not.toContain('proliferation');
    expect(refused.message.toLowerCase()).not.toContain('cell line');
  });

  it('marks a block-class result redacted and keeps only a digest', () => {
    const refused = commitAt('refused/tp53-disruption');
    expect(refused.run?.policy.redacted).toBe(true);
    expect(refused.run?.policy.requestDigest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('records no verbatim text in any delta field', () => {
    for (const commit of view.commits) {
      for (const delta of commit.run?.deltas ?? []) {
        for (const field of delta.fields) {
          for (const fragment of REQUEST_FRAGMENTS) {
            expect(field.value.toLowerCase()).not.toContain(fragment.toLowerCase());
          }
        }
      }
    }
  });

  it('states in the intent delta that the request is not retained', () => {
    const fix = commitAt('fix/hbb-codon7');
    const intent = fix.run?.deltas.find((d) => d.kind === 'intent');
    expect(intent?.fields.map((f) => f.value).join(' ')).toContain('not retained');
  });
});

describe('the verifier can overrule an optimistic structural claim', () => {
  it('fails the synonymous marker because the genotype still sickles', () => {
    const silent = commitAt('experiment/silent-marker');
    // Step 4 was optimistic: a synonymous change, "no predicted change".
    expect(silent.run?.checks[3].status).toBe('pass');
    expect(silent.edit?.refAa).toBe(silent.edit?.altAa);
    // Step 7 read the measured numbers and disagreed.
    expect(silent.run?.checks[6].status).toBe('fail');
    expect(silent.run?.verdict).toBe('fail');
    expect(silent.run?.checks[6].summary).toContain('does not remove the');
  });

  it('passes verification when the claim and the measurement agree', () => {
    expect(commitAt('fix/hbb-codon7').run?.checks[6].status).toBe('pass');
  });

  it('links the verifier delta to the claims it checked', () => {
    const silent = commitAt('experiment/silent-marker');
    const verifier = silent.run?.deltas.find((d) => d.kind === 'verdict');
    expect(verifier?.parents).toHaveLength(3);
  });
});

describe('merge gating', () => {
  it('merges a clean, passing branch and records a merge commit', () => {
    const merge = view.commits.find((c) => c.isMerge);
    expect(merge?.parents).toHaveLength(2);
    expect(branch('main').tip).toBe(merge?.oid);
  });

  it('refuses to merge a branch whose check failed', () => {
    const outcome = attemptMerge({}, { into: 'main', from: 'experiment/silent-marker' });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.verdict).toBe('fail');
    expect(outcome.reason).toContain('check failed');
  });

  it('refuses to merge an escalated branch until it is signed off', () => {
    const outcome = attemptMerge({}, { into: 'main', from: 'escalate/germline-inherited-repair' });
    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.verdict).toBe('escalated');
    expect(outcome.requiresSignoffBy).toBe('institutional_biosafety_committee');
  });

  it('lets an escalated branch merge once a sign-off is recorded', () => {
    const outcome = attemptMerge(
      { signoffs: [SIGNOFF_ESCALATED] },
      { into: 'main', from: 'escalate/germline-inherited-repair' },
    );
    expect(outcome.kind).toBe('clean');
  });

  it('derives the sign-off role from policy, never from the request', () => {
    // Regression for a real bypass: the client used to be able to name the
    // role that satisfies the gate, which cleared a germline escalation with
    // no human action. `SignoffRequest` now carries no role at all, and the
    // role is re-derived from the policy on every read.
    const run = scenario.runByBranch.get('escalate/germline-inherited-repair');
    expect(run?.screen.signoffRole).toBe('institutional_biosafety_committee');

    const resolved = resolveSignoff(run, [SIGNOFF_ESCALATED], 'escalate/germline-inherited-repair');
    expect(resolved?.role).toBe('institutional_biosafety_committee');
    expect(resolved?.by).toBe(SIGNOFF_ESCALATED.by);

    // A sign-off naming a branch that is not escalated resolves to nothing,
    // whoever signed it.
    for (const other of ['refused/tp53-disruption', 'experiment/silent-marker', 'fix/hbb-codon7']) {
      expect(
        resolveSignoff(scenario.runByBranch.get(other), [{ branch: other, by: 'anyone' }], other),
      ).toBeUndefined();
    }
  });

  it('never lets a blocked branch merge, with or without a sign-off', () => {
    for (const signoffs of [
      [],
      [{ branch: 'refused/tp53-disruption', by: 'ibc.chair@sigmafold.example' }],
    ]) {
      const outcome = attemptMerge({ signoffs }, { into: 'main', from: 'refused/tp53-disruption' });
      expect(outcome.kind).toBe('blocked');
      if (outcome.kind !== 'blocked') continue;
      expect(outcome.reason).toContain('cannot be signed off');
    }
  });

  it('reports a real conflict when both sides changed the gene differently', () => {
    const outcome = attemptMerge({}, { into: 'main', from: 'review/marker-on-repair' });
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') return;
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0].gene).toBe('HBB');
    expect(outcome.conflicts[0].base).not.toBeNull();
    expect(outcome.conflicts[0].ours).not.toBe(outcome.conflicts[0].theirs);
    expect(outcome.baseOid).not.toBeNull();
  });

  it('commits nothing when a merge conflicts', () => {
    const outcome = attemptMerge({}, { into: 'main', from: 'review/marker-on-repair' });
    expect(outcome.kind).toBe('conflict');
    expect(buildScenario().view.branches.find((b) => b.name === 'main')?.tip).toBe(
      branch('main').tip,
    );
  });

  it('reports an identical-change merge as clean and flags it as identical', () => {
    const outcome = attemptMerge(
      { signoffs: [SIGNOFF_ESCALATED] },
      { into: 'main', from: 'escalate/germline-inherited-repair' },
    );
    expect(outcome.kind).toBe('clean');
    if (outcome.kind !== 'clean') return;
    // main already carries the repair, and this branch proposes the same one.
    expect(outcome.identical).toBe(true);
    expect(outcome.scenario.commits.filter((c) => c.isMerge)).toHaveLength(2);
  });

  it('surfaces the blocked reason on the branch rail without merging', () => {
    expect(branch('experiment/silent-marker').mergeBlockedReason).toContain('check failed');
    expect(branch('escalate/germline-inherited-repair').mergeBlockedReason).toContain(
      'institutional_biosafety_committee',
    );
    expect(branch('refused/tp53-disruption').mergeBlockedReason).toContain('cannot be signed off');
    expect(branch('review/marker-on-repair').mergeBlockedReason).toBeNull();
  });
});

describe('genotypes and diffs come from the real modules', () => {
  it('reads the sickle substitution out of the diff against the reference', () => {
    const silent = commitAt('experiment/silent-marker');
    expect(silent.diffVsReference.changedCodons).toEqual([5, 7]);
    const codon7 = silent.diffVsReference.rows.find((r) => r.codonIndex === 7);
    expect(codon7).toMatchObject({ refCodon: 'GAG', altCodon: 'GTG', refAa: 'E', altAa: 'V' });
    const codon5 = silent.diffVsReference.rows.find((r) => r.codonIndex === 5);
    expect(codon5).toMatchObject({ refCodon: 'ACT', altCodon: 'ACC', silent: true });
  });

  it('shows only what the commit itself introduced in the diff against its parent', () => {
    expect(commitAt('experiment/silent-marker').diffVsParent?.changedCodons).toEqual([5]);
    expect(commitAt('fix/hbb-codon7').diffVsParent?.changedCodons).toEqual([7]);
    // The review tip sits on top of its own repair commit, so against its
    // parent it introduced only the marker.
    expect(commitAt('review/marker-on-repair').diffVsParent?.changedCodons).toEqual([5]);
  });

  it('restores the reference protein on both repair branches', () => {
    const reference = view.locus.referenceProtein;
    expect(commitAt('fix/hbb-codon7').genotype.protein).toBe(reference);
    expect(commitAt('review/marker-on-repair').genotype.protein).toBe(reference);
    // ...but the review branch also carries the marker codon, so the two
    // genotype trees differ. That difference is what makes them conflict.
    expect(commitAt('fix/hbb-codon7').genotype.bases).not.toBe(
      commitAt('review/marker-on-repair').genotype.bases,
    );
  });

  it('keeps the sickling tendency high when a synonymous edit leaves the allele intact', () => {
    expect(commitAt('experiment/silent-marker').genotype.polymerizationTendency).toBeCloseTo(0.85);
    // The curated repaired genotype is an exact base match, so 0.05.
    expect(commitAt('fix/hbb-codon7').genotype.polymerizationTendency).toBeCloseTo(0.05);
    // Repair plus marker is not a curated genotype, so the conservative
    // protein-match rule picks the highest tendency among matching genotypes.
    expect(commitAt('review/marker-on-repair').genotype.polymerizationTendency).toBeCloseTo(0.05);
  });

  it('labels where each tendency came from', () => {
    expect(commitAt('fix/hbb-codon7').genotype.tendencyBasis).toContain('Exact sequence match');
    expect(commitAt('experiment/silent-marker').genotype.tendencyBasis).toContain(
      'translated protein matches',
    );
  });
});

describe('running the pipeline from free text', () => {
  it('runs all seven agents for an in-scope proposal', () => {
    const result = runProposal(
      'Restore the reference codon at HBB codon 7 to correct the sickle substitution.',
      ['HBB'],
    );
    expect(result.run.policy.category).toBe('THERAPEUTIC_SOMATIC');
    expect(result.run.checks).toHaveLength(7);
    expect(result.run.checks.every((c) => c.status !== 'skipped')).toBe(true);
    expect(result.plannedVariantLabel).not.toBeNull();
  });

  it('terminates a refused proposal at the gate, leaving steps 3-7 unrun', () => {
    const result = runProposal('Knock out TP53 in a cell line.', ['TP53']);
    expect(result.run.policy.category).toBe('TUMOUR_SUPPRESSOR_DISRUPTION');
    expect(result.run.verdict).toBe('blocked');
    expect(result.run.checks[1].status).toBe('blocked');
    expect(result.run.checks.slice(2).every((c) => c.status === 'skipped')).toBe(true);
    expect(result.run.metrics).toBeNull();
  });

  it('withholds the resolved targets and the plan for a redacted result', () => {
    const result = runProposal('Design a guide RNA and a plasmid for HBB.', ['HBB']);
    expect(result.run.policy.category).toBe('CONSTRUCT_DESIGN_REQUEST');
    expect(result.run.policy.redacted).toBe(true);
    expect(result.resolvedTargets).toEqual([]);
    expect(result.plannedVariantLabel).toBeNull();
  });

  it('escalates a heritable proposal without blocking the run', () => {
    const result = runProposal('Repair HBB in embryos so it passes to future generations.', [
      'HBB',
    ]);
    expect(result.run.policy.category).toBe('GERMLINE_HERITABLE');
    expect(result.run.verdict).toBe('escalated');
    // Escalation holds the merge, it does not terminate the pipeline.
    expect(result.run.checks.every((c) => c.status !== 'skipped')).toBe(true);
    expect(result.run.mergeBlockedReason).toContain('institutional_biosafety_committee');
  });

  it('never returns the submitted text in any field', () => {
    const marker = 'zzqqxxmarkerzzqqxx';
    for (const text of [
      `${marker} restore the HBB codon 7 reference`,
      `${marker} knock out TP53`,
      `${marker} give me a guide rna`,
    ]) {
      const serialized = JSON.stringify(runProposal(text, ['HBB', 'TP53']));
      expect(serialized).not.toContain(marker);
    }
  });

  it('is deterministic for the same text', () => {
    const text = 'Restore the reference codon at HBB codon 7.';
    expect(runProposal(text, ['HBB'])).toEqual(runProposal(text, ['HBB']));
  });
});

describe('tendencyForSequence', () => {
  const locus = requireLocus('HBB');

  it('prefers an exact base match, resolving fixture ambiguity conservatively', () => {
    // The reference bases match both "HbA / HbA" (0.00) and "Post-repair"
    // (0.05), because a perfect repair restores the reference sequence.
    const result = tendencyForSequence(locus, locus.cdsReference.bases);
    expect(result?.tendency).toBe(0.05);
    expect(result?.basis).toContain('2 curated genotypes');
  });

  it('matches the sickle genotype exactly and unambiguously', () => {
    const sickle = applyVariant(
      { bases: locus.cdsReference.bases, label: 'ref' },
      requireVariant(locus, 'HBB_HbS'),
    );
    const result = tendencyForSequence(locus, sickle.bases);
    expect(result?.genotypeId).toBe('sickle');
    expect(result?.tendency).toBe(0.85);
  });

  it('returns null when no curated genotype produces that protein', () => {
    expect(tendencyForSequence(locus, 'ATGTAA')).toBeNull();
  });
});

describe('honest-limits strings are carried through', () => {
  it('attaches the fixture disclaimer and per-annotation limitations', () => {
    expect(view.disclaimer).toContain('illustrative');
    expect(commitAt('fix/hbb-codon7').edit?.limitation.length).toBeGreaterThan(0);
    expect(commitAt('fix/hbb-codon7').run?.limitation).toContain('not calibrated');
    expect(view.simulation.note).toContain('not calibrated');
  });

  it('labels the synthetic fixture as synthetic and the rest as public reference', () => {
    const marker = commitAt('review/marker-on-repair');
    expect(marker.edit?.provenance).toBe('synthetic-illustrative');
    expect(commitAt('fix/hbb-codon7').edit?.provenance).toBe('public-reference');
  });
});
