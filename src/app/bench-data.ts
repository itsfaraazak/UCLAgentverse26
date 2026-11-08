/**
 * Server-side assembly of the bench's data. Runs on the server only: it
 * touches `lib/vcs` and `lib/agents`, which use `node:crypto`.
 *
 * Every number handed to the client here comes from a real module call —
 * `Repo` for oids and branches, `diffSequences` for the registers,
 * `runPipeline` for the checks, `CellSim` for the metrics.
 */

import { diffSequences, translate, type DiffRow, type Sequence } from '@/lib/genome';
import { Repo, shortOid, type Oid } from '@/lib/vcs';
import {
  getLocus,
  mayMerge,
  referenceSequence,
  runPipeline,
  sequenceForGenotype,
  simulationFixture,
  toVariant,
  VERIFIER_THRESHOLDS,
  type CheckRun,
  type Locus,
  type LocusVariant,
} from '@/lib/agents';
import type {
  BenchData,
  CheckRunView,
  DeltaView,
  FrameView,
  MergeAttemptView,
  ScreenView,
  StructuralView,
} from './bench-types';
import type { ScreenResult } from '@/lib/safety/policy';

const GENE = 'HBB';
const AUTHOR = 'bench-operator';

interface FrameSpec {
  id: string;
  role: 'reference' | 'mutant' | 'repaired';
  branch: string;
  genotypeId: string;
  message: string;
  /** Variant id whose annotation this frame displays, if any. */
  variantId: string | null;
}

const FRAME_SPECS: readonly FrameSpec[] = [
  {
    id: 'frame-reference',
    role: 'reference',
    branch: 'main',
    genotypeId: 'wildtype',
    message: 'reference: HBB coding region, HbA allele',
    variantId: null,
  },
  {
    id: 'frame-mutant',
    role: 'mutant',
    branch: 'observed/hbs',
    genotypeId: 'sickle',
    message: 'observed genotype: HbS substitution at codon 7',
    variantId: 'HBB_HbS',
  },
  {
    id: 'frame-repaired',
    role: 'repaired',
    branch: 'therapy/hbb-repair',
    genotypeId: 'repaired',
    message: 'proposed edit: restore the reference codon at position 7',
    variantId: 'HBB_repair',
  },
];

function locusOrThrow(): Locus {
  const locus = getLocus(GENE);
  if (locus === undefined) throw new Error(`fixture missing: ${GENE}`);
  return locus;
}

interface BuiltRepo {
  repo: Repo;
  heads: Map<string, Oid>;
  sequences: Map<string, Sequence>;
}

/**
 * Deterministic history: a reference commit on `main`, the observed genotype
 * on its own branch, and the proposed repair branched from the observed state.
 */
function buildRepo(locus: Locus): BuiltRepo {
  const repo = new Repo();
  const heads = new Map<string, Oid>();
  const sequences = new Map<string, Sequence>();

  let timestamp = 1_767_225_600_000; // fixed epoch so oids are reproducible

  const commitFor = (spec: FrameSpec, parentBranch: string | null): void => {
    const seq = sequenceForGenotype(locus, spec.genotypeId);
    sequences.set(spec.id, seq);
    const blob = repo.write({ kind: 'blob', sequence: seq });
    const tree = repo.write({ kind: 'tree', entries: { [locus.gene]: blob } });

    if (parentBranch !== null) {
      repo.branch(spec.branch, heads.get(parentBranch) ?? repo.head());
      repo.checkout(spec.branch);
    }

    const variant =
      spec.variantId === null
        ? undefined
        : locus.variants.find((v) => v.id === spec.variantId);

    const oid = repo.commit({
      tree,
      parents: parentBranch === null ? [] : [heads.get(parentBranch) ?? repo.head()],
      author: AUTHOR,
      message: spec.message,
      timestamp: (timestamp += 86_400_000),
      ...(variant ? { edit: toVariant(locus, variant) } : {}),
    });
    heads.set(spec.branch, oid);
  };

  commitFor(FRAME_SPECS[0], null);
  commitFor(FRAME_SPECS[1], 'main');
  commitFor(FRAME_SPECS[2], 'observed/hbs');
  repo.checkout('therapy/hbb-repair');

  return { repo, heads, sequences };
}

function toStructuralView(v: LocusVariant): StructuralView {
  return {
    refAa: v.structural.refAa,
    altAa: v.structural.altAa,
    refAaName: v.structural.refAaName,
    altAaName: v.structural.altAaName,
    summary: v.structural.summary,
    consequence: v.structural.consequence,
    polymerizationTendency: v.structural.polymerizationTendency,
    confidence: v.structural.confidence,
    limitation: v.structural.limitation,
  };
}

export function toScreenView(r: ScreenResult): ScreenView {
  // Category, reason and digest only. The request text never crosses here.
  return {
    category: r.category,
    verdict: r.verdict,
    reason: r.reason,
    requiresSignoff: r.requiresSignoff,
    signoffRole: r.signoffRole ?? null,
    flaggedGenes: [...r.flaggedGenes],
    requestDigest: r.requestDigest,
    redacted: r.redacted,
  };
}

function toDeltaViews(run: CheckRun): DeltaView[] {
  return run.deltas.map((d) => ({
    id: d.id,
    kind: d.kind,
    author: d.author,
    subject: d.subject,
    parents: [...d.parents],
    createdAt: d.createdAt,
    payload: JSON.stringify(d.payload, null, 2),
  }));
}

function baselineMeanFlowOf(run: CheckRun): number | null {
  const assay = run.deltas.find((d) => d.kind === 'assay');
  if (assay === undefined) return null;
  const payload = assay.payload as { baseline?: { meanFlow?: number } };
  return typeof payload.baseline?.meanFlow === 'number' ? payload.baseline.meanFlow : null;
}

export function toCheckRunView(run: CheckRun): CheckRunView {
  return {
    id: run.id,
    verdict: run.verdict,
    steps: run.steps.map((s) => ({
      index: s.index,
      agent: s.agent,
      kind: s.kind,
      status: s.status,
      summary: s.summary,
      durationMs: s.durationMs,
      deltaId: s.deltaId,
    })),
    deltas: toDeltaViews(run),
    metrics: run.metrics,
    baselineMeanFlow: baselineMeanFlowOf(run),
    stressPO2: run.stressPO2,
    requiresSignoff: run.requiresSignoff,
    signoffRole: run.signoffRole,
    structuralClaim: run.structuralClaim,
    verifierNotes: [...run.verifierNotes],
    screen: toScreenView(run.screenResult),
    thresholds: { ...VERIFIER_THRESHOLDS },
  };
}

/** Request text used for the pipeline's own intent step, not user input. */
function intentTextFor(spec: FrameSpec): string {
  return spec.role === 'repaired'
    ? 'Somatic edit of HBB to correct the codon 7 substitution, to treat sickle cell disease.'
    : 'Model the HBB coding region for this genotype.';
}

export function benchData(): BenchData {
  const locus = locusOrThrow();
  const { repo, heads, sequences } = buildRepo(locus);
  const fixture = simulationFixture();
  const reference = referenceSequence(locus);

  const frames: FrameView[] = FRAME_SPECS.map((spec, i) => {
    const seq = sequences.get(spec.id) ?? reference;
    const oid = heads.get(spec.branch) ?? repo.head();
    const commit = repo.read(oid);
    const genotype = locus.genotypes.find((g) => g.id === spec.genotypeId);
    const variant =
      spec.variantId === null ? null : (locus.variants.find((v) => v.id === spec.variantId) ?? null);
    const prevSpec = i > 0 ? FRAME_SPECS[i - 1] : null;
    const prevSeq = prevSpec === null ? null : (sequences.get(prevSpec.id) ?? null);

    const diff: DiffRow[] = diffSequences(reference, seq);
    const diffFromPrevious: DiffRow[] =
      prevSeq === null ? diff : diffSequences(prevSeq, seq);

    return {
      id: spec.id,
      role: spec.role,
      label: genotype?.label ?? spec.genotypeId,
      branch: spec.branch,
      commitOid: oid,
      shortOid: shortOid(oid),
      commitMessage: spec.message,
      parentShortOids:
        commit.kind === 'commit' ? commit.parents.map((p) => shortOid(p)) : [],
      genotypeId: spec.genotypeId,
      provenance: variant?.provenance ?? locus.provenance,
      polymerizationTendency: genotype?.polymerizationTendency ?? 0,
      bases: seq.bases,
      protein: translate(seq.bases),
      diff,
      diffFromPrevious,
      previousLabel:
        prevSpec === null
          ? null
          : (locus.genotypes.find((g) => g.id === prevSpec.genotypeId)?.label ?? null),
      changedCodonIndex: variant?.codonIndex ?? null,
      variantLabel: variant?.label ?? null,
      hgvs: variant?.hgvs ?? null,
      proteinHgvs: variant?.proteinHgvs ?? null,
      legacyName: variant?.legacyName ?? null,
      numberingNote: variant?.numberingNote ?? null,
      structural: variant === null ? null : toStructuralView(variant),
    };
  });

  const modelledEnd = locus.cdsReference.codonCount;

  return {
    locus: {
      gene: locus.gene,
      name: locus.name,
      chromosome: locus.chromosome,
      provenance: locus.provenance,
      note: locus.note,
      referenceLabel: locus.cdsReference.label,
      codonCount: locus.cdsReference.codonCount,
      exons: locus.exons.map((e) => ({
        index: e.index,
        label: e.label,
        codonStart: e.codonStart,
        codonEnd: e.codonEnd,
        modelled: e.codonStart <= modelledEnd,
        note: e.note,
      })),
    },
    frames,
    branches: repo.branches(),
    simulation: {
      seed: fixture.defaults.seed,
      cellCount: fixture.defaults.cellCount,
      pO2Default: fixture.defaults.pO2,
      capillaryConstriction: fixture.defaults.capillaryConstriction,
      pO2Min: fixture.pO2.min,
      pO2Max: fixture.pO2.max,
      pO2Unit: fixture.pO2.unit,
      pO2Label: fixture.pO2.label,
      sicklingOnsetBelow: fixture.pO2.sicklingOnsetBelow,
    },
    disclaimer:
      'Illustrative model. The capillary simulation and the structural annotations are ' +
      'teaching summaries chosen to read clearly on screen; they are not calibrated ' +
      'haemorheology and not output from a validated structure-prediction model.',
  };
}

/** Run the seven-agent pipeline for one filmstrip frame. */
export function runChecksFor(frameId: string, stressPO2: number): CheckRunView {
  const locus = locusOrThrow();
  const spec = FRAME_SPECS.find((f) => f.id === frameId);
  if (spec === undefined) throw new Error(`unknown frame: ${frameId}`);
  const run = runPipeline(
    { text: intentTextFor(spec), gene: locus.gene, genotypeId: spec.genotypeId, author: AUTHOR },
    stressPO2,
  );
  return toCheckRunView(run);
}

/**
 * Attempt to merge a frame's branch into `main`. The checks run first and a
 * non-passing run stops the merge before `Repo.merge` is ever called.
 */
export function attemptMergeFor(frameId: string, signedOff: boolean): MergeAttemptView {
  const locus = locusOrThrow();
  const spec = FRAME_SPECS.find((f) => f.id === frameId);
  if (spec === undefined) throw new Error(`unknown frame: ${frameId}`);

  const run = runPipeline(
    { text: intentTextFor(spec), gene: locus.gene, genotypeId: spec.genotypeId, author: AUTHOR },
    20,
  );

  const base: MergeAttemptView = {
    ok: false,
    into: 'main',
    from: spec.branch,
    blockedBy: null,
    reason: '',
    mergeOid: null,
    conflicts: [],
    requiresSignoff: run.requiresSignoff,
    signoffRole: run.signoffRole,
  };

  if (spec.branch === 'main') {
    return { ...base, reason: 'This frame is the reference on `main`; nothing to merge.' };
  }

  if (!mayMerge(run, signedOff)) {
    const blockedBy =
      run.verdict === 'blocked' || run.verdict === 'escalated'
        ? 'BiosafetyGateAgent'
        : (run.steps.find((s) => s.status === 'fail')?.agent ?? 'VerifierAgent');
    const reason =
      run.verdict === 'blocked'
        ? `Merge refused: the biosafety gate returned ${run.screenResult.category}.`
        : run.verdict === 'escalated'
          ? 'Merge held: the gate escalated this edit and no human sign-off is recorded.'
          : `Merge refused: check ${blockedBy} failed. ` + run.verifierNotes.join(' ');
    return { ...base, blockedBy, reason };
  }

  const { repo, heads } = buildRepo(locus);
  const ours = heads.get('main');
  const theirs = heads.get(spec.branch);
  if (ours === undefined || theirs === undefined) {
    return { ...base, reason: 'Merge refused: branch head could not be resolved.' };
  }
  repo.checkout('main');
  const result = repo.merge(ours, theirs);
  if ('conflicts' in result) {
    return {
      ...base,
      blockedBy: 'merge',
      reason: 'Merge conflict: the genotype changed differently on both sides.',
      conflicts: result.conflicts.map((c) => ({
        gene: c.gene,
        ours: shortOid(c.ours),
        theirs: shortOid(c.theirs),
        base: c.base === null ? null : shortOid(c.base),
      })),
    };
  }

  return {
    ...base,
    ok: true,
    reason: `Merged into main as ${shortOid(result.oid)} after a passing check run.`,
    mergeOid: shortOid(result.oid),
  };
}
