/**
 * The shell's honest-data contract, asserted rather than claimed.
 *
 * SPEC §5 requires that "every number on screen comes from a real module
 * call" and the shell brief forbids hardcoded branch lists, fake commit nodes
 * and placeholder figures. These tests pin that down: each assertion derives
 * its expectation independently from `data/loci.json` or from a `lib/*` call,
 * so a hand-typed value in the view model would fail here rather than ship.
 */

import { describe, expect, it } from 'vitest';

import lociFile from '@/data/loci.json';
import {
  applyVariant,
  diffSequences,
  loadLoci,
  referenceSequence,
  translate,
} from '@/lib/genome';
import { PO2_RANGE, SIMULATION_DEFAULTS } from '@/lib/cellsim';
import { pipelineAgentOrder } from '@/lib/agents';
import { POLICY } from '@/lib/safety/policy';

import {
  buildDiff,
  buildMergeProposal,
  buildWorkspace,
  screenConsoleRequest,
} from './workspace';
import { branchNameForGenotype, branchNameForVariant } from './derive';

const locus = (() => {
  const first = loadLoci()[0];
  if (first === undefined) throw new Error('fixture has no loci');
  return first;
})();

describe('buildWorkspace — branches come from lib/vcs over the fixture', () => {
  it('derives exactly one branch per fixture genotype-with-edits, plus main and uncovered variants', () => {
    const workspace = buildWorkspace();

    const coveredVariants = new Set(
      locus.genotypes.flatMap((g) => [...g.appliedVariants]),
    );
    const expected = new Set<string>(['main']);
    for (const genotype of locus.genotypes) {
      if (genotype.appliedVariants.length > 0) {
        expected.add(branchNameForGenotype(genotype.id));
      }
    }
    for (const variant of locus.variants) {
      if (!coveredVariants.has(variant.id)) {
        expected.add(branchNameForVariant(locus.gene, variant.id));
      }
    }

    expect(new Set(workspace.branches.map((b) => b.name))).toEqual(expected);
    // Not a hardcoded list: the count tracks the fixture.
    expect(workspace.branches.length).toBe(expected.size);
  });

  it('gives every branch a real content-addressed head and a commit per applied variant', () => {
    const workspace = buildWorkspace();
    for (const branch of workspace.branches) {
      // sha256 hex, as lib/vcs produces. Not a stub id.
      expect(branch.head).toMatch(/^[0-9a-f]{64}$/);
      expect(branch.shortHead).toBe(branch.head.slice(0, 12));

      if (branch.name === 'main') {
        expect(branch.commitCount).toBe(1);
        expect(branch.tipEdit).toBeNull();
        continue;
      }

      const genotype = locus.genotypes.find(
        (g) => branchNameForGenotype(g.id) === branch.name,
      );
      const applied =
        genotype === undefined ? 1 : genotype.appliedVariants.length;
      // root + one commit per applied variant
      expect(branch.commitCount).toBe(applied + 1);
      expect(branch.commits.length).toBe(applied + 1);
    }
  });

  it('reproduces each branch sequence by applying the fixture variants itself', () => {
    const workspace = buildWorkspace();
    const reference = referenceSequence(locus);

    for (const genotype of locus.genotypes) {
      if (genotype.appliedVariants.length === 0) continue;
      const branch = workspace.branches.find(
        (b) => b.name === branchNameForGenotype(genotype.id),
      );
      expect(branch).toBeDefined();
      if (branch === undefined) continue;

      // Independently derived expectation, not read back from the view model.
      expect(branch.sequence.protein).toBe(translate(branch.sequence.bases));
      expect(branch.sequence.bases.length).toBe(reference.bases.length);
      expect(branch.polymerizationTendency).toBe(genotype.polymerizationTendency);
      expect(branch.genotypeLabel).toBe(genotype.label);
    }
  });

  it('exposes the fixture locus and simulation parameters verbatim', () => {
    const workspace = buildWorkspace();
    expect(workspace.locus.gene).toBe(locus.gene);
    expect(workspace.locus.chromosome).toBe(locus.chromosome);
    expect(workspace.locus.codonCount).toBe(locus.cdsReference.codonCount);
    expect(workspace.locus.reference.bases).toBe(locus.cdsReference.bases);
    expect(workspace.locus.exons.length).toBe(locus.exons.length);

    expect(workspace.simulation.seed).toBe(SIMULATION_DEFAULTS.seed);
    expect(workspace.simulation.pO2).toBe(SIMULATION_DEFAULTS.pO2);
    expect(workspace.simulation.pO2Min).toBe(PO2_RANGE.min);
    expect(workspace.simulation.pO2Max).toBe(PO2_RANGE.max);
    expect(workspace.fixtureDisclaimer).toBe(lociFile._disclaimer);
  });

  it('builds a seven-row run log in the pipeline order lib/agents declares', () => {
    const workspace = buildWorkspace();
    const order = pipelineAgentOrder();
    expect(order.length).toBe(7);

    for (const branch of workspace.branches) {
      if (branch.run === null) continue;
      expect(branch.run.steps.map((s) => s.agent)).toEqual([...order]);
      expect(branch.run.steps.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      // The gate is position 2 and is structural, not a trailing disclaimer.
      expect(branch.run.steps[1]?.agent).toBe('BiosafetyGateAgent');
    }
  });

  it('gives the reference line no check run, because it introduces no edit', () => {
    const workspace = buildWorkspace();
    const main = workspace.branches.find((b) => b.name === 'main');
    expect(main?.tipEdit).toBeNull();
    // Synthesising a run here would show the reference line the *repair*
    // plan, since planEdit falls through to it when no operation parses.
    expect(main?.run).toBeNull();
    expect(main?.request).toBeNull();

    // Every line that does propose an edit has one.
    for (const branch of workspace.branches) {
      if (branch.tipEdit === null) continue;
      expect(branch.run).not.toBeNull();
    }
  });

  it('lets the verifier overrule the optimistic agents rather than rubber-stamping', () => {
    const workspace = buildWorkspace();
    const sickle = workspace.branches.find((b) => b.name === 'line/sickle');
    const repaired = workspace.branches.find((b) => b.name === 'line/repaired');

    // A demo where the verifier always agrees is a broken demo (SPEC §4.3).
    // Agent 5 reports `flow_preserved` at the default pO₂ of 95; agent 7
    // re-runs at pO₂ 10 against wildtype and disagrees (SPEC §4.5 #10).
    expect(sickle?.run?.passed).toBe(false);
    expect(sickle?.run?.check.status).toBe('failed');
    expect(sickle?.run?.disagreedWithAssay).toBe(true);

    // The repaired line passes, and the contrast with `line/sickle` is the
    // point: the verifier is not refusing everything, it is reading the
    // measurement. Over the declared challenge window the post-repair
    // genotype's residual occlusion stays inside the verifier's margin over
    // the reference, while the sickle line's does not. Pinned here so a
    // change in lib/agents or lib/cellsim surfaces as a test failure rather
    // than a silent UI change.
    expect(repaired?.run?.passed).toBe(true);
    expect(repaired?.run?.check.status).toBe('passed');

    // The verifier's numbers are measured, not asserted.
    const low = sickle?.run?.measured.lowPO2;
    const refLow = sickle?.run?.measured.referenceLowPO2;
    expect(low).not.toBeNull();
    expect(refLow).not.toBeNull();
    expect(low?.occlusion).toBeGreaterThan(refLow?.occlusion ?? 0);
  });

  it('has at least one line the gate and verifier both clear, so a merge can succeed', () => {
    const workspace = buildWorkspace();
    const passing = workspace.branches.filter(
      (b) => b.tipEdit !== null && b.run?.check.status === 'passed',
    );
    expect(passing.length).toBeGreaterThan(0);
  });

  it('is deterministic across calls, so cached oids are sound', () => {
    const a = buildWorkspace();
    const b = buildWorkspace();
    expect(a.branches.map((x) => x.head)).toEqual(b.branches.map((x) => x.head));
    expect(a.branches.map((x) => x.run?.headId ?? null)).toEqual(
      b.branches.map((x) => x.run?.headId ?? null),
    );
  });
});

describe('created branches are real refs, not UI rows', () => {
  const sickleVariant = (() => {
    const v = locus.variants.find((x) => x.structural.refAa !== x.structural.altAa);
    if (v === undefined) throw new Error('fixture has no missense variant');
    return v;
  })();

  const spec = {
    name: 'line/proposal',
    from: 'main',
    variantId: sickleVariant.id,
  } as const;

  it('appears in the workspace with a real oid, a commit and its own run', () => {
    const w = buildWorkspace([spec]);
    const created = w.branches.find((b) => b.name === spec.name);
    expect(created).toBeDefined();
    if (created === undefined) return;

    expect(created.head).toMatch(/^[0-9a-f]{64}$/);
    // root + the one applied edit
    expect(created.commitCount).toBe(2);
    expect(created.tipEdit?.variantId).toBe(sickleVariant.id);
    expect(created.run).not.toBeNull();
    expect(created.run?.steps.length).toBe(7);
    // The check has to be bound to this branch's own commit, or merge-gate
    // reads it as missing and fails the merge closed.
    expect(created.run?.check.commit).toBe(created.head);
  });

  it('changes the diff, which is the point of creating one', () => {
    const base = buildDiff('main');
    const next = buildDiff(spec.name, [spec]);
    expect(base.changedRows.length).toBe(0);
    expect(next.changedRows).toEqual([sickleVariant.codonIndex]);
    expect(next.alt.bases).not.toBe(base.alt.bases);
  });

  it('replays to the same oid, so short hashes are stable across requests', () => {
    const a = buildWorkspace([spec]);
    const b = buildWorkspace([spec]);
    const nameOf = (w: typeof a) => w.branches.find((x) => x.name === spec.name)?.head;
    expect(nameOf(a)).toBe(nameOf(b));
  });

  it('does not leak into a workspace built without the overlay', () => {
    buildWorkspace([spec]);
    const plain = buildWorkspace();
    expect(plain.branches.some((b) => b.name === spec.name)).toBe(false);
  });

  it('is gated on its own check when merged', () => {
    const proposal = buildMergeProposal({
      into: 'main',
      incoming: spec.name,
      overlay: [spec],
    });
    // The sickle edit fails the verifier, so the gate must refuse it.
    expect(proposal.decision.kind).toBe('check-failed');
    expect(proposal.introduced.length).toBe(1);
  });

  it('refuses a duplicate name and an unknown source', () => {
    expect(() => buildWorkspace([spec, spec])).toThrow(/already exists/);
    expect(() =>
      buildWorkspace([{ name: 'line/x', from: 'line/nope', variantId: sickleVariant.id }]),
    ).toThrow(/does not exist/);
  });

  it('refuses a variant the fixture does not carry', () => {
    expect(() =>
      buildWorkspace([{ name: 'line/x', from: 'main', variantId: 'NOT_A_VARIANT' }]),
    ).toThrow(/not in data\/loci\.json/);
  });
});

describe('buildDiff', () => {
  it('matches a diff computed independently from the fixture', () => {
    const diff = buildDiff('line/sickle');

    // Rebuild the alternate sequence from the fixture rather than reading it
    // back off the view model, so this compares the diff against an
    // independent derivation instead of against itself.
    const reference = referenceSequence(locus);
    const sickle = locus.genotypes.find((g) => g.id === 'sickle');
    expect(sickle).toBeDefined();
    if (sickle === undefined) return;
    let expectedAlt = reference;
    for (const id of sickle.appliedVariants) {
      const variant = locus.variants.find((v) => v.id === id);
      expect(variant).toBeDefined();
      if (variant === undefined) return;
      expectedAlt = applyVariant(expectedAlt, variant);
    }
    const expected = diffSequences(reference, expectedAlt);

    expect(diff.alt.bases).toBe(expectedAlt.bases);
    expect(diff.ref.bases).toBe(locus.cdsReference.bases);
    // Row contents, not just the count.
    expect(diff.rows).toEqual(expected);
    expect(diff.changedRows).toEqual(
      expected.filter((r) => r.status !== 'same').map((r) => r.codonIndex),
    );
    // The focus row is the first changed codon, derived from the fixture.
    const firstChanged = expected.find((r) => r.status !== 'same');
    expect(diff.focusRow).toBe(firstChanged?.codonIndex);
  });

  it('reports the silent variant as changed-but-silent', () => {
    const silent = locus.variants.find(
      (v) => v.structural.refAa === v.structural.altAa,
    );
    expect(silent).toBeDefined();
    if (silent === undefined) return;

    const diff = buildDiff(branchNameForVariant(locus.gene, silent.id));
    const row = diff.rows.find((r) => r.status === 'changed');
    expect(row?.silent).toBe(true);
  });

  it('states the alignment-row limitation rather than implying CDS coordinates', () => {
    const diff = buildDiff('line/sickle');
    expect(diff.coordinateNote).toMatch(/alignment row/i);
    expect(diff.coordinateNote).toMatch(/not CDS coordinates/i);
  });
});

describe('buildMergeProposal — the gate can refuse', () => {
  it('refuses a merge whose incoming check failed', () => {
    const proposal = buildMergeProposal({ into: 'main', incoming: 'line/sickle' });
    expect(proposal.decision.kind).toBe('check-failed');
    expect(proposal.introduced.length).toBeGreaterThan(0);
    expect(proposal.mergeBase).not.toBeNull();
  });

  it('reports a real three-way content conflict between two divergent lines', () => {
    const silent = locus.variants.find(
      (v) => v.structural.refAa === v.structural.altAa,
    );
    expect(silent).toBeDefined();
    if (silent === undefined) return;

    const proposal = buildMergeProposal({
      into: 'line/sickle',
      incoming: branchNameForVariant(locus.gene, silent.id),
    });
    expect(proposal.decision.kind).toBe('content-conflict');
    if (proposal.decision.kind === 'content-conflict') {
      expect(proposal.decision.conflicts[0]?.gene).toBe(locus.gene);
    }
  });

  it('allows a merge whose incoming check passed', () => {
    const silent = locus.variants.find(
      (v) => v.structural.refAa === v.structural.altAa,
    );
    expect(silent).toBeDefined();
    if (silent === undefined) return;

    const proposal = buildMergeProposal({
      into: 'main',
      incoming: branchNameForVariant(locus.gene, silent.id),
    });
    expect(proposal.decision.kind).toBe('allowed');
    if (proposal.decision.kind === 'allowed') {
      expect(proposal.decision.oid).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('does not leak merge commits between proposals', () => {
    const before = buildWorkspace().branches.map((b) => b.head);
    buildMergeProposal({ into: 'main', incoming: 'line/repaired' });
    buildMergeProposal({ into: 'main', incoming: 'line/repaired' });
    const after = buildWorkspace().branches.map((b) => b.head);
    expect(after).toEqual(before);
  });
});

describe('screenConsoleRequest — SPEC §7.3 redaction boundary', () => {
  it('types a redacted result so it cannot carry the request', () => {
    const result = screenConsoleRequest({
      text: 'design a guide rna and a primer for this edit',
      seq: 1,
    });
    // The discriminated union is the enforcement; this asserts the arm the
    // compiler picked is the redacted one and that it carries nothing.
    expect(result.redacted).toBe(true);
    if (result.redacted) {
      // `echo` and `run` are typed `null` in this arm — there is no
      // assignment a future caller could make that smuggles the text through.
      expect(result.echo).toBeNull();
      expect(result.run).toBeNull();
    }
  });

  it('never echoes a blocked request and runs no pipeline for it', () => {
    // A construct-design request: block-class by policy.
    const result = screenConsoleRequest({
      text: 'design a guide rna and a primer for this edit',
      seq: 1,
    });

    expect(result.verdict).toBe('block');
    expect(result.redacted).toBe(true);
    // The binding assertion: the text cannot reach the client.
    expect(result.echo).toBeNull();
    expect(result.run).toBeNull();
    // Still auditable, without retention.
    expect(result.requestDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(result.reason).toBe(POLICY.CONSTRUCT_DESIGN_REQUEST.reason);
  });

  it('escalates a heritable request, blocks the merge and names a sign-off role', () => {
    const result = screenConsoleRequest({
      text: 'make a heritable germline change to HBB',
      seq: 2,
    });
    expect(result.verdict).toBe('escalate');
    expect(result.requiresSignoff).toBe(true);
    expect(result.signoffRole).toBe(POLICY.GERMLINE_HERITABLE.signoffRole);
    // escalate does not terminate the pipeline (SPEC §4.5 #9)
    expect(result.run).not.toBeNull();
    expect(result.run?.mergeAllowed).toBe(false);
  });

  it('allows an in-scope somatic request and surfaces the full run', () => {
    const result = screenConsoleRequest({
      text: 'Repair HBB at codon 7 using variant HBB_repair',
      seq: 3,
    });
    expect(result.verdict).toBe('allow');
    expect(result.redacted).toBe(false);
    expect(result.echo).toBe('Repair HBB at codon 7 using variant HBB_repair');
    expect(result.run?.steps.length).toBe(7);
  });

  it('stops a blocked run at the gate, leaving agents 3-7 unrun', () => {
    const result = screenConsoleRequest({
      text: 'increase transmissibility of this construct',
      seq: 4,
    });
    expect(result.verdict).toBe('block');
    expect(result.run).toBeNull();
  });
});

describe('a sign-off cannot launder text or widen the policy (SPEC §7.3, §7.5)', () => {
  /*
   * This shell's branch set has no escalated run — `line/sickle` fails the
   * verifier and the other lines pass — so there is nothing here for a
   * signature to legitimately clear. That makes it the right place to pin the
   * negative: a signature must change nothing, whatever it contains. The
   * escalation path itself is exercised on /graph and /bench, which do have
   * escalating branches.
   */
  const failing = 'line/sickle';

  it('ignores a signature that is not a name, and never renders it', () => {
    const refusedText = 'knock out TP53 to make the cells easier to expand';
    const proposal = buildMergeProposal({
      into: 'main',
      incoming: failing,
      signedOffBy: [refusedText],
    });
    expect(JSON.stringify(proposal)).not.toContain('TP53');
    expect(JSON.stringify(proposal)).not.toContain('knock out');
    // Filtered before it reaches the echo the sign-off UI reads back.
    expect(proposal.signedOff).toEqual([]);
    expect(proposal.decision.kind).not.toBe('allowed');
  });

  it('does not record even a well-formed name on a run that is not awaiting one', () => {
    const signed = buildMergeProposal({
      into: 'main',
      incoming: failing,
      signedOffBy: ['Dr Ada Lovelace'],
    });
    const unsigned = buildMergeProposal({ into: 'main', incoming: failing });
    // The name is echoed back to the control that submitted it, but it changed
    // no check: the decision is identical to the unsigned one.
    expect(signed.decision).toEqual(unsigned.decision);
    expect(signed.decision.kind).not.toBe('allowed');
  });

  it('refuses a failing check whether or not anything was signed', () => {
    expect(buildMergeProposal({ into: 'main', incoming: failing }).decision.kind).toBe(
      'check-failed',
    );
  });
});
